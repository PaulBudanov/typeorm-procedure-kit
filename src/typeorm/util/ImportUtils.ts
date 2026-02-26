import fs from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';

export async function importOrRequireFile(
  filePath: string
): Promise<[unknown, 'esm' | 'commonjs']> {
  const tryToImport = async (): Promise<[unknown, 'esm']> => {
    // Use dynamic import with proper URL formatting
    const url = filePath.startsWith('file://')
      ? filePath
      : pathToFileURL(filePath).toString();
    return [await import(url), 'esm'];
  };

  const tryToRequire = (): [unknown, 'commonjs'] => {
    const require = createRequire(import.meta.url);
    return [require(filePath), 'commonjs'];
  };

  const extension = filePath.substring(filePath.lastIndexOf('.') + 1);

  if (extension === 'mjs' || extension === 'mts') return tryToImport();
  if (extension === 'cjs' || extension === 'cts') return tryToRequire();
  if (extension === 'js' || extension === 'ts') {
    const packageJson = await getNearestPackageJson(filePath);

    if (packageJson !== null) {
      const isModule =
        (packageJson as Record<string, unknown>)?.type === 'module';
      return isModule ? tryToImport() : tryToRequire();
    }
    return tryToRequire();
  }

  return tryToRequire();
}

const packageJsonCache = new Map<string, object | null>();
const MAX_CACHE_SIZE = 1000;

function setPackageJsonCache(
  paths: ReadonlyArray<string>,
  packageJson: object | null
): void {
  for (const path of paths) {
    // Simple LRU-like behavior: if we're at capacity, remove oldest entry
    if (
      packageJsonCache.size >= MAX_CACHE_SIZE &&
      !packageJsonCache.has(path)
    ) {
      const firstKey = packageJsonCache.keys().next().value;
      if (firstKey !== undefined) packageJsonCache.delete(firstKey);
    }
    packageJsonCache.set(path, packageJson);
  }
}

async function getNearestPackageJson(filePath: string): Promise<object | null> {
  let currentPath = filePath;
  const paths: Array<string> = [];

  while (currentPath !== path.dirname(currentPath)) {
    currentPath = path.dirname(currentPath);

    // Check if we have already cached the package.json for this path
    const cachedPackageJson = packageJsonCache.get(currentPath);
    if (cachedPackageJson !== undefined) {
      setPackageJsonCache(paths, cachedPackageJson);
      return cachedPackageJson;
    }

    // Add the current path to the list of paths to cache
    paths.push(currentPath);

    const potentialPackageJson = path.join(currentPath, 'package.json');

    try {
      const stats = await fs.stat(potentialPackageJson);
      if (!stats.isFile()) continue;

      const parsedPackage = JSON.parse(
        await fs.readFile(potentialPackageJson, 'utf8')
      ) as object | null;
      // Cache the parsed package.json object and return it
      setPackageJsonCache(paths, parsedPackage);
      return parsedPackage;
    } catch {
      // If file doesn't exist or parsing fails, cache null to avoid repeated attempts
      setPackageJsonCache(paths, null);
      return null;
    }
  }

  // the top of the file tree is reached
  setPackageJsonCache(paths, null);
  return null;
}
