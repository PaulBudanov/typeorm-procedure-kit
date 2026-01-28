import { DateTime } from 'luxon';

//TODO: In future this function should be use or move to utils class
export function sqlDateFormatting(
  inputData: string,
  outputFormat: string,
  isSetLocalZone = true,
): string {
  return DateTime.fromSQL(inputData, {
    setZone: isSetLocalZone,
  }).toFormat(outputFormat);
}
