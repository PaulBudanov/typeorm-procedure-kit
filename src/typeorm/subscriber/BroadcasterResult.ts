/**
 * Broadcaster execution result - promises executed by operations and number of executed listeners and subscribers.
 */
export class BroadcasterResult {
  /**
   * Number of executed listeners and subscribers.
   */
  public count = 0;

  /**
   * Promises returned by listeners and subscribers which needs to be awaited.
   */
  public promises: Array<Promise<unknown>> = [];

  /**
   * Wait for all promises to settle
   */
  public async wait(): Promise<BroadcasterResult> {
    if (this.promises.length > 0) {
      await Promise.all(this.promises);
    }

    return this;
  }
}
