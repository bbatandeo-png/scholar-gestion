const fs = require('fs');
const path = require('path');

// pkg's virtual snapshot filesystem does not reliably support nunjucks'
// FileSystemLoader (views render fine from real disk but fail with
// "template not found" when only bundled via pkg.assets) - so views/public
// must also exist as real, unpacked folders next to the produced exe,
// matching the highest-priority candidate in main.ts's viewsDir/publicDir
// resolution (path.join(runtimeRoot, 'views'|'public')).
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }

  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const projectRoot = process.cwd();
copyDir(
  path.join(projectRoot, 'dist', 'views'),
  path.join(projectRoot, 'release', 'views'),
);
copyDir(
  path.join(projectRoot, 'dist', 'public'),
  path.join(projectRoot, 'release', 'public'),
);
// init-replica-set.ps1 (and the other on-site maintenance scripts) must sit
// next to the exe: replica-set-setup.util.ts looks for it at
// <runtimeRoot>/deploy/init-replica-set.ps1 to run it automatically,
// elevated, the first time the app finds MongoDB isn't replicated yet.
copyDir(
  path.join(projectRoot, 'scripts', 'deploy'),
  path.join(projectRoot, 'release', 'deploy'),
);

console.log(
  'Assets copies a cote de release/Scolar-Gestion.exe : views + public + deploy',
);

// EcolesController's "Telecharger le pack d'installation" zips whatever
// sits in RELEASE_ASSETS_DIR (default: release-assets/, see
// getReleaseAssetsRoot()) - a DIFFERENT folder from release/, the one this
// script's other copyDir calls (and pkg's --output above) write into. On a
// genuine remote deployment RELEASE_ASSETS_DIR points at wherever the
// vendor manually uploads a build, so this script has no business writing
// there sight unseen. But left unset (the local/dev default), the two
// folders silently diverge: rebuilding release/ never updates what
// /platform/ecoles actually serves, so a fresh download keeps shipping a
// stale exe with no error or warning anywhere (see the "module toujours
// desactive apres reconstruction" investigation this comment resulted
// from). Mirroring release/ -> release-assets/ here, but ONLY when
// RELEASE_ASSETS_DIR isn't set, keeps the one-command local workflow
// actually doing what it looks like it does, without silently touching a
// real deployment's asset folder.
if (!process.env.RELEASE_ASSETS_DIR) {
  const releaseAssetsDir = path.join(projectRoot, 'release-assets');
  copyDir(path.join(projectRoot, 'release'), releaseAssetsDir);
  console.log(
    `RELEASE_ASSETS_DIR non defini - release/ egalement synchronise vers ${releaseAssetsDir} (ce que /platform/ecoles sert reellement).`,
  );
}
