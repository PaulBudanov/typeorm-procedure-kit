import { access, copyFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = fileURLToPath(new URL('../docs/README.md', import.meta.url));
const targetPath = fileURLToPath(new URL('../README.md', import.meta.url));
const backupPath = fileURLToPath(
  new URL('../.package-readme.backup', import.meta.url)
);
const markerPath = fileURLToPath(
  new URL('../.package-readme-generated', import.meta.url)
);

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

if (await pathExists(markerPath)) {
  throw new Error(
    'A package README marker already exists; run the cleanup script before packing again.'
  );
}
if (await pathExists(backupPath)) {
  throw new Error(
    'A package README backup already exists; restore it before packing again.'
  );
}

const shouldRestoreExistingReadme = await pathExists(targetPath);
let backupCreated = false;

try {
  await writeFile(
    markerPath,
    `${JSON.stringify({
      projectRoot,
      mode: shouldRestoreExistingReadme ? 'restore' : 'remove',
    })}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  if (shouldRestoreExistingReadme) {
    await rename(targetPath, backupPath);
    backupCreated = true;
  }
  await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
} catch (error) {
  if (backupCreated || !shouldRestoreExistingReadme) {
    await rm(targetPath, { force: true });
  }
  if (backupCreated && (await pathExists(backupPath))) {
    await rename(backupPath, targetPath);
  }
  await rm(markerPath, { force: true });
  throw error;
}
