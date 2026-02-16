export class TypeORMError extends Error {
  public get name(): string {
    return this.constructor.name;
  }
  public constructor(message?: string) {
    super(message);

    // restore prototype chain because the base `Error` type
    // will break the prototype chain a little
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, new.target.prototype);
    } else {
      Reflect.setPrototypeOf(this, new.target.prototype);
    }
  }
}
