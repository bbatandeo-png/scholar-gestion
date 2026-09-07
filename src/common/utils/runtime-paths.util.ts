import * as fs from 'fs';
import * as path from 'path';

// True when running as a pkg-packaged executable rather than plain node -
// see main.ts's viewsDir/publicDir resolution, which this mirrors so every
// runtime-path decision in the app (bundled assets, user-uploaded files)
// agrees on where "next to the exe" is.
export function isPkgRuntime(): boolean {
  return Boolean((process as unknown as { pkg?: unknown }).pkg);
}

export function getRuntimeRoot(): string {
  return isPkgRuntime() ? path.dirname(process.execPath) : process.cwd();
}

// Root folder for files written at runtime (uploaded logos...), as opposed
// to bundled assets (dist/public) which pkg embeds read-only in its
// snapshot filesystem - this one is always a real, writable directory on
// disk, created on first use.
export function getUploadsRoot(): string {
  return path.join(getRuntimeRoot(), 'uploads');
}

// Where a pre-built exe + views/public/deploy live for /platform/ecoles'
// "Telecharger le pack d'installation" button (EcolesController) to zip up -
// this is deliberately a folder the vendor uploads by hand after running
// `npm run build:exe:native` on their own machine, never something this
// running app builds itself (no Node/npm/pkg toolchain needed on whatever
// server hosts /platform/ecoles online, and no remote-build attack surface).
// Configurable so an online deployment can point it wherever the uploaded
// build actually sits; defaults to a folder next to the app for a local/dev
// check.
export function getReleaseAssetsRoot(): string {
  return (
    process.env.RELEASE_ASSETS_DIR ??
    path.join(getRuntimeRoot(), 'release-assets')
  );
}

// Resolves a bundled, read-only asset shipped with the app itself (e.g. the
// Togo flag used on printed documents) under public/<...segments> - tries
// every location the file could live in depending on how the app is
// currently running (packaged exe, `node dist/main`, ts-node dev), mirroring
// main.ts's own publicDir resolution. Returns null if the file isn't found
// anywhere, letting callers draw nothing rather than crash (same rule
// already applied to the ecole logo and student photo).
export function resolveStaticAssetPath(...segments: string[]): string | null {
  const runtimeRoot = getRuntimeRoot();
  const candidates = [
    path.join(runtimeRoot, 'public', ...segments),
    // This file compiles to dist/common/utils/runtime-paths.util.js, two
    // levels under dist/ - dist/public sits right next to it, both on real
    // disk (`node dist/main`) and inside a pkg exe's virtual snapshot.
    path.join(__dirname, '..', '..', 'public', ...segments),
    path.join(process.cwd(), 'dist', 'public', ...segments),
    path.join(process.cwd(), 'public', ...segments),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}
