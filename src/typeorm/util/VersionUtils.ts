export class VersionUtils {
  public static isGreaterOrEqual(
    version: string | undefined,
    targetVersion: string
  ): boolean {
    if (!version) {
      return false;
    }

    const v1 = parseVersion(version);
    const v2 = parseVersion(targetVersion);

    for (let i = 0; i < v1.length && i < v2.length; i++) {
      if ((v1[i] as number) > (v2[i] as number)) {
        return true;
      } else if ((v1[i] as number) < (v2[i] as number)) {
        return false;
      }
    }

    return true;
  }
}

function parseVersion(version: string): Array<number> {
  return version.split('.').map((value) => parseInt(value, 10));
}
