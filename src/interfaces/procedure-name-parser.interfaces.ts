export interface IProcedureNameParser extends Record<string, unknown> {
  processName: Lowercase<string>;
  packageName: Lowercase<string>;
}
