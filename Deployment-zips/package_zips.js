// ============================================================
// UNIVERSAL ZIP PACKAGER (Node.js version)
// Works with ANY project. Run from the project root
// (the folder that contains "frontend" and "backend"):
//   node package_zips.js
//
// Output: frontend-build.zip and backend-build.zip
// Requires: npm install archiver@7   (v7 = classic API, tested)
// ============================================================
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiver = require('archiver'); // works with every archiver version (CJS + ESM)

const rootDir = process.cwd();

// Change these two lines only if your folders have different names
const FRONTEND_DIR = 'frontend';
const BACKEND_DIR = 'backend';

async function createZip(sourceDir, outPath, excludedNames) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`[ZIP SUCCESS] ${path.basename(outPath)} created: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on('error', (err) => reject(err));
    archive.pipe(output);

    function addDir(currentDir, relativePath = '') {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (excludedNames.includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);
        const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          addDir(fullPath, entryRelPath);
        } else {
          archive.file(fullPath, { name: entryRelPath });
        }
      }
    }

    addDir(sourceDir);
    archive.finalize();
  });
}

async function run() {
  console.log('Generating production ZIP packages...');

  // 1. Frontend ZIP
  const frontendSource = path.join(rootDir, FRONTEND_DIR);
  const frontendZip = path.join(rootDir, 'frontend-build.zip');
  const frontendExcludes = ['node_modules', 'dist', '.env', '.git', '.DS_Store'];

  if (!fs.existsSync(frontendSource)) {
    throw new Error(`Frontend folder not found: ${frontendSource}`);
  }
  await createZip(frontendSource, frontendZip, frontendExcludes);

  // 2. Backend ZIP
  const backendSource = path.join(rootDir, BACKEND_DIR);
  const backendZip = path.join(rootDir, 'backend-build.zip');
  const backendExcludes = ['node_modules', '.env', '.git', '.DS_Store', 'uploads', 'logs'];

  if (!fs.existsSync(backendSource)) {
    throw new Error(`Backend folder not found: ${backendSource}`);
  }
  await createZip(backendSource, backendZip, backendExcludes);

  console.log('\nAll ZIP packages prepared successfully.');
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
