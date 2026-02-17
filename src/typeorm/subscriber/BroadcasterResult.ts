/**
 * Broadcaster execution result - promises executed by operations and number of executed listeners and subscribers.
 */
export class BroadcasterResult {
  /**
   * Number of executed listeners and subscribers.
   */
  count = 0;

  /**
   * Promises returned by listeners and subscribers which needs to be awaited.
   */
  promises: Array<Promise<any>> = [];

  /**
   * Wait for all promises to settle
   */
  async wait(): Promise<BroadcasterResult> {
    if (this.promises.length > 0) {
      await Promise.all(this.promises);
    }

    return this;
  }
}
