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
