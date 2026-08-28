import { hash } from './StringUtils.js';

const WINDOWS_PATH_REGEXP = /^([a-zA-Z]:.*)$/;
const UNC_WINDOWS_PATH_REGEXP = /^\\\\(\.\\)?(.*)$/;

export function toPortablePath(filepath: string): string {
  if (process.platform !== `win32`) return filepath;

  if (WINDOWS_PATH_REGEXP.exec(filepath))
    filepath = filepath.replace(WINDOWS_PATH_REGEXP, `/$1`);
  else if (UNC_WINDOWS_PATH_REGEXP.exec(filepath))
    filepath = filepath.replace(
      UNC_WINDOWS_PATH_REGEXP,
      (_match, p1, p2) => `/unc/${p1 ? `.dot/` : ``}${p2}`
    );

  return filepath.replace(/\\/g, `/`);
}

/**
 * Create deterministic valid database name (class, database) of fixed length from any filepath. Equivalent paths for windows/posix systems should
 * be equivalent to enable portability
 */
export function filepathToName(filepath: string): string {
  const uniq = toPortablePath(filepath).toLowerCase();
  return hash(uniq, { length: 63 });
}

/**
 * Cross platform isAbsolute
 */
export function isAbsolute(filepath: string): boolean {
  return !!/^(?:[a-z]:|[\\]|[/])/i.exec(filepath);
}
