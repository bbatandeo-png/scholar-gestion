const fs = require('fs');
const path = require('path');

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
copyDir(path.join(projectRoot, 'src', 'views'), path.join(projectRoot, 'dist', 'views'));
copyDir(path.join(projectRoot, 'public'), path.join(projectRoot, 'dist', 'public'));

console.log('Assets copied to dist: views + public');
