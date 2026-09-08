export interface IPackageFetchControl {
  rerunRequested: boolean;
}

export interface IPackageFetchState {
  control: IPackageFetchControl;
  promise: Promise<void>;
}
