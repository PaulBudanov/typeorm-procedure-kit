export interface IProcedureArgumentBase {
  procedureName: string;
  argumentName: string;
  argumentType: string;
  order: number;
  mode: string;
}

export interface IProcedureArgumentOracle extends IProcedureArgumentBase {
  packageName: Lowercase<string>;
}

export type TProcedureArgumentList = Record<
  Lowercase<string>,
  Array<Omit<IProcedureArgumentOracle, 'packageName' | 'procedureName'>>
>;

export type TDBMapStructure = Map<Lowercase<string>, TProcedureArgumentList>;
