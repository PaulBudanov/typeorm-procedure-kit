/**
 * Container to be used for dependency injection.
 */
export interface IContainerInterface {
  get<T>(someClass: (new (...args: Array<unknown>) => T) | { prototype: T }): T;
}

/**
 * Container instance used for dependency injection.
 */
let containerInstance: IContainerInterface | null = null;

/**
 * Sets container to be used for dependency injection.
 */
export function useContainer(container: IContainerInterface): void {
  containerInstance = container;
}

/**
 * Gets the container instance.
 */
export function getContainer(): IContainerInterface | null {
  return containerInstance;
}

/**
 * Gets an instance of the given class from the container.
 * If container is not set, creates a new instance of the class.
 */
export function getFromContainer<T>(
  someClass: (new (...args: Array<unknown>) => T) | { prototype: T }
): T {
  if (containerInstance) {
    return containerInstance.get<T>(someClass);
  }
  // If container is not set, create a new instance
  if (typeof someClass === 'function') {
    return new (someClass as new (...args: Array<unknown>) => T)();
  }
  throw new Error(
    'Cannot instantiate class from prototype. Container is required.'
  );
}
