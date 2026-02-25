import * as glob from 'glob';

import type { TFunction } from '../../types/utility.types.js';
import type { Logger } from '../logger/Logger.js';
import { PlatformTools } from '../platform/PlatformTools.js';

import { importOrRequireFile } from './ImportUtils.js';
import { InstanceChecker } from './InstanceChecker.js';
import { ObjectUtils } from './ObjectUtils.js';

/**
 * Loads all exported classes from the given directory.
 */
export async function importClassesFromDirectories(
  logger: Logger,
  directories: Array<string>,
  formats = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']
): Promise<Array<TFunction>> {
  const logLevel = 'info';
  const classesNotFoundMessage =
    'No classes were found using the provided glob pattern: ';
  const classesFoundMessage = 'All classes found using provided glob pattern';
  function loadFileClasses(
    exported: unknown,
    allLoaded: Array<TFunction>
  ): Array<TFunction> {
    if (
      typeof exported === 'function' ||
      InstanceChecker.isEntitySchema(exported)
    ) {
      allLoaded.push(exported as TFunction);
    } else if (Array.isArray(exported)) {
      (exported as Array<TFunction>).forEach((value) =>
        loadFileClasses(value, allLoaded)
      );
    } else if (ObjectUtils.isObject(exported)) {
      Object.values(exported).forEach((value) =>
        loadFileClasses(value, allLoaded)
      );
    }
    return allLoaded;
  }

  const allFiles = directories.reduce((allDirs, dir) => {
    return allDirs.concat(glob.sync(PlatformTools.pathNormalize(dir)));
  }, [] as Array<string>);

  if (directories.length > 0 && allFiles.length === 0) {
    logger.log(logLevel, `${classesNotFoundMessage} "${directories}"`);
  } else if (allFiles.length > 0) {
    logger.log(
      logLevel,
      `${classesFoundMessage} "${directories}" : "${allFiles}"`
    );
  }
  const dirPromises = allFiles
    .filter((file) => {
      const dtsExtension = file.substring(file.length - 5, file.length);
      return (
        formats.indexOf(PlatformTools.pathExtname(file)) !== -1 &&
        dtsExtension !== '.d.ts'
      );
    })
    .map(async (file) => {
      const [importOrRequireResult] = await importOrRequireFile(
        PlatformTools.pathResolve(file)
      );
      return importOrRequireResult;
    });

  const dirs = await Promise.all(dirPromises);

  return loadFileClasses(dirs, []);
}

/**
 * Loads all json files from the given directory.
 */
export function importJsonsFromDirectories(
  directories: Array<string>,
  format = '.json'
): Array<unknown> {
  const allFiles = directories.reduce((allDirs, dir) => {
    return allDirs.concat(glob.sync(PlatformTools.pathNormalize(dir)));
  }, [] as Array<string>);

  return allFiles
    .filter((file) => PlatformTools.pathExtname(file) === format)
    .map((file) => import(PlatformTools.pathResolve(file)));
}
