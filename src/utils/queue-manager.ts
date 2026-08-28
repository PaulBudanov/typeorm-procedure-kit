import { EventBusService } from './event-bus.js';
import { ServerError } from './server-error.js';

import type { TMapKey, TQueueType } from '../types/utility.types.js';

export class QueueManager<TQueueItem> {
  private readonly eventBusService: EventBusService;
  private queue:
    | Array<TQueueItem>
    | Map<string | number | symbol, TQueueItem>
    | Set<TQueueItem>;

  public constructor(
    private queueName: string,
    private collectionType: TQueueType,
    eventBusService?: EventBusService
  ) {
    this.eventBusService =
      eventBusService ?? EventBusService.getNewInstance(20);

    switch (this.collectionType) {
      case 'array':
        this.queue = Array<TQueueItem>();
        break;
      case 'map':
        this.queue = new Map<string, TQueueItem>();
        break;
      case 'set':
        this.queue = new Set<TQueueItem>();
        break;
      default:
        throw new RangeError(`Unsupported collection type: ${collectionType}`);
    }
  }

  public enqueue(key: string | number | undefined, item: TQueueItem): boolean {
    const isNewItem = this.addItem(key, item);
    if (!isNewItem) return false;

    this.eventBusService.emit(`${this.queueName}:enqueue`, { key, item });
    return true;
  }

  public async enqueueAsync(
    key: string | number | undefined,
    item: TQueueItem
  ): Promise<boolean> {
    const isNewItem = this.addItem(key, item);
    if (!isNewItem) return false;

    await this.eventBusService.emitAsync(`${this.queueName}:enqueue`, {
      key,
      item,
    });
    return true;
  }

  private addItem(key: string | number | undefined, item: TQueueItem): boolean {
    if (this.queue instanceof Array) {
      this.queue.push(item);
      return true;
    } else if (this.queue instanceof Map) {
      if (key === undefined) {
        throw new ReferenceError('Key is required for Map collection');
      }
      const isNewItem =
        !this.queue.has(key) || !Object.is(this.queue.get(key), item);
      this.queue.set(key, item);
      return isNewItem;
    } else {
      const previousSize = this.queue.size;
      this.queue.add(item);
      return this.queue.size > previousSize;
    }
  }

  public dequeue(key?: TMapKey | TQueueItem): TQueueItem | undefined {
    let removedItem: TQueueItem | undefined;
    if (this.queue instanceof Array) {
      removedItem = this.dequeueFromArray(key);
    } else if (
      this.queue instanceof Map &&
      (typeof key === 'string' ||
        typeof key === 'number' ||
        typeof key === 'symbol')
    ) {
      removedItem = this.dequeueFromMap(key);
    } else {
      removedItem = this.dequeueFromSet(key as TQueueItem | undefined);
    }

    if (removedItem !== undefined) {
      this.eventBusService.emit(`${this.queueName}:dequeue`, {
        key,
        item: removedItem,
      });
    }

    return removedItem;
  }

  public clear(): void {
    if (this.queue instanceof Array) this.queue.length = 0;
    else this.queue.clear();
    return;
  }

  public size(): number {
    if (this.queue instanceof Set || this.queue instanceof Map)
      return this.queue.size;
    else if (this.queue instanceof Array) return this.queue.length;
    return 0;
  }

  public getQueue():
    | Array<TQueueItem>
    | Map<TMapKey, TQueueItem>
    | Set<TQueueItem> {
    if (this.queue instanceof Array) {
      return [...this.queue];
    } else if (this.queue instanceof Map) {
      return new Map(this.queue);
    } else if (this.queue instanceof Set) {
      return new Set(this.queue);
    }
    throw new ServerError('Unexpected collection type');
  }

  public getEventBusService(): EventBusService {
    return this.eventBusService;
  }

  public subscribeToEnqueue(
    callback: (data: {
      key: TMapKey | undefined;
      item: TQueueItem;
    }) => void | Promise<void>
  ): void {
    this.eventBusService.registerListener(
      `${this.queueName}:enqueue`,
      callback
    );
  }

  public subscribeToDequeue(
    callback: (data: {
      key: TMapKey | undefined;
      item: TQueueItem;
    }) => void | Promise<void>
  ): void {
    this.eventBusService.registerListener(
      `${this.queueName}:dequeue`,
      callback
    );
  }

  public unsubscribeFromEnqueue(
    callback: (data: {
      key: TMapKey | undefined;
      item: TQueueItem;
    }) => void | Promise<void>
  ): void {
    this.eventBusService.removeListener(`${this.queueName}:enqueue`, callback);
  }

  public unsubscribeFromDequeue(
    callback: (data: {
      key: string | number | undefined;
      item: TQueueItem;
    }) => void | Promise<void>
  ): void {
    this.eventBusService.removeListener(`${this.queueName}:dequeue`, callback);
  }

  private dequeueFromArray(key?: TMapKey | TQueueItem): TQueueItem | undefined {
    const array = this.queue as Array<TQueueItem>;
    if (key === undefined) {
      return array.shift();
    } else if (typeof key === 'number') {
      if (key < 0 || key >= array.length) {
        throw new ServerError(`Index out of bounds: ${key}`);
      }
      return array.splice(key, 1)[0];
    } else {
      const index = array.indexOf(key as unknown as TQueueItem);
      if (index === -1) {
        throw new ServerError(`Value not found in array: ${key?.toString()}`);
      }
      return array.splice(index, 1)[0];
    }
  }

  private dequeueFromMap(key: TMapKey): TQueueItem | undefined {
    const map = this.queue as Map<TMapKey, TQueueItem>;
    const item = map.get(key);
    map.delete(key);
    return item;
  }

  private dequeueFromSet(key?: TQueueItem): TQueueItem | undefined {
    const set = this.queue as Set<TQueueItem>;
    if (key === undefined) {
      const iterator = set.values();
      const firstItem = iterator.next().value as TQueueItem;
      if (firstItem !== undefined) {
        set.delete(firstItem);
        return firstItem;
      }
    } else {
      if (set.has(key)) {
        set.delete(key);
        return key;
      }
    }
    return undefined;
  }
}
