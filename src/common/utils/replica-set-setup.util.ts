import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import { getRuntimeRoot, isPkgRuntime } from './runtime-paths.util';

const CHECK_INTERVAL_MS = 3000;
// ~5 minutes of patience for a slow-starting MongoDB service before giving
// up and letting Nest's own (near-infinite) Mongoose retry loop take over -
// this function's job is only the one-time replica-set setup, not general
// "wait for MongoDB" duty.
const MAX_ATTEMPTS = 100;

function stripReplicaSetParam(uri: string): string {
  return uri
    .replace(/([?&])replicaSet=[^&]+&?/, '$1')
    .replace(/[?&]$/, '');
}

function resolveSetupScriptPath(): string | null {
  const candidates = [
    // Shipped next to the exe (see scripts/copy-release-assets.cjs).
    path.join(getRuntimeRoot(), 'deploy', 'init-replica-set.ps1'),
    // `node dist/main` / ts-node dev, run from the repo root.
    path.join(process.cwd(), 'scripts', 'deploy', 'init-replica-set.ps1'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function probeReplicaSet(
  bareUri: string,
): Promise<'ready' | 'not-replicated' | 'unreachable'> {
  let connection: mongoose.Connection | undefined;
  try {
    connection = await mongoose
      .createConnection(bareUri, {
        serverSelectionTimeoutMS: 4000,
        directConnection: true,
      })
      .asPromise();
    const hello = await connection.db?.admin().command({ hello: 1 });
    return hello?.setName === 'rs0' ? 'ready' : 'not-replicated';
  } catch {
    return 'unreachable';
  } finally {
    await connection?.close().catch(() => {});
  }
}

// Relaunches the given script as a NEW, elevated PowerShell process (the one
// UAC prompt the client has to accept) and waits for it to finish, without
// the app's own long-running process ever needing to run elevated itself.
function runElevatedSetup(scriptPath: string): Promise<number> {
  return new Promise((resolve) => {
    const escapedPath = scriptPath.replace(/'/g, "''");
    const command =
      `$p = Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedPath}') ` +
      `-Verb RunAs -Wait -PassThru; exit $p.ExitCode`;

    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Windows native-exe deployments only (see readme.txt's "OPTION SANS
// DOCKER") - the Docker Compose path already self-initialises its single-
// node replica set via the mongo service's own healthcheck. On a school's
// Windows machine running MongoDB Community Server as a plain Windows
// service, replication is never enabled by the MSI installer - until now
// this required a technician (or the non-technical client, which is the
// problem being fixed here) to run init-replica-set.ps1 by hand once per
// machine. This runs that exact same script automatically the first time
// it's needed, elevated via a single UAC prompt - the client is never asked
// to open PowerShell themselves.
export async function ensureReplicaSetReady(mongoUri: string): Promise<void> {
  // Packaged exe only - never during `nest start`/`npm run start:dev` or
  // `node dist/main`. A dev's own MongoDB is theirs to manage (often not
  // even replicated, e.g. a plain standalone mongod), and this must never
  // silently probe/elevate/reconfigure a developer's machine on every
  // restart.
  if (
    !isPkgRuntime() ||
    process.platform !== 'win32' ||
    process.env.NODE_ENV === 'test'
  ) {
    return;
  }

  const bareUri = stripReplicaSetParam(mongoUri);
  let elevatedAttempted = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const status = await probeReplicaSet(bareUri);
    if (status === 'ready') {
      return;
    }

    if (status === 'unreachable') {
      // MongoDB service might just still be starting up after a cold boot -
      // keep waiting rather than assuming it needs the one-time setup. One
      // log line so the exe's console window doesn't look frozen during a
      // slow start.
      if (attempt === 0) {
        console.log(
          '[licence-mongo] En attente du demarrage de MongoDB...',
        );
      }
      await sleep(CHECK_INTERVAL_MS);
      continue;
    }

    // status === 'not-replicated'
    if (elevatedAttempted) {
      // Setup already ran once this run - give the freshly restarted
      // service a moment to come back up and elect a primary rather than
      // firing a second UAC prompt.
      await sleep(CHECK_INTERVAL_MS);
      continue;
    }

    const scriptPath = resolveSetupScriptPath();
    if (!scriptPath) {
      console.error(
        "[licence-mongo] Configuration de la base de donnees incomplete et script d'initialisation introuvable - contactez le support.",
      );
      return;
    }

    console.log(
      "[licence-mongo] Premiere configuration de la base de donnees sur ce poste - une fenetre Windows va demander une autorisation, merci de l'accepter.",
    );
    elevatedAttempted = true;
    const exitCode = await runElevatedSetup(scriptPath);
    if (exitCode !== 0) {
      console.error(
        "[licence-mongo] La configuration initiale de la base de donnees necessite une autorisation administrateur qui n'a pas ete accordee (ou a echoue) - relancez l'application et acceptez la fenetre Windows, ou contactez le support.",
      );
      return;
    }
    // Loop again to confirm the service came back up correctly.
  }

  console.error(
    '[licence-mongo] MongoDB ne repond toujours pas apres plusieurs tentatives - verifiez que le service MongoDB est installe et demarre, ou contactez le support.',
  );
}
