import { access, readFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
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

const markerText = await readFile(markerPath, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return undefined;
  throw error;
});

if (markerText === undefined) {
  if (await pathExists(backupPath)) {
    throw new Error(
      'Package README backup exists without its marker; refusing unsafe cleanup.'
    );
  }
} else {
  const marker =
    markerText === projectRoot
      ? { projectRoot, mode: 'remove' }
      : JSON.parse(markerText);
  if (marker.projectRoot !== projectRoot) {
    throw new Error('Package README marker belongs to a different project.');
  }

  if (marker.mode === 'restore') {
    if (!(await pathExists(backupPath))) {
      throw new Error(
        'Existing root README backup is missing; refusing cleanup.'
      );
    }
    await rm(targetPath, { force: true });
    await rename(backupPath, targetPath);
  } else if (marker.mode === 'remove') {
    await rm(targetPath, { force: true });
  } else {
    throw new Error(`Unknown package README cleanup mode: ${marker.mode}`);
  }
  await rm(markerPath, { force: true });
}
