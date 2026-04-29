import EventEmitter from 'events';

import type { IEventBusService } from '../types/utility.types.js';

export class EventBusService implements IEventBusService {
  private eventEmitter: EventEmitter;

  private constructor(maxListeners?: number) {
    this.eventEmitter = new EventEmitter();
    this.eventEmitter.setMaxListeners(maxListeners ?? 100);
  }

  public emit<T>(event: string | symbol, data?: T): void {
    this.eventEmitter.emit(event, data);
  }

  public registerListener<T, U extends string | symbol>(
    event: string | symbol,
    callback: (data: T) => U | Promise<U> | void | Promise<void>
  ): void {
    this.eventEmitter.on<U>(event, callback);
  }

  public registerOnce<T, U extends string | symbol>(
    event: string | symbol,
    callback: (data: T) => U | Promise<U> | void | Promise<void>
  ): { unsubscribe: () => void } {
    this.eventEmitter.once<U>(event, callback);
    return {
      unsubscribe: (): void => {
        return this.eventUnsubscribe<T, U>(event, callback);
      },
    };
  }

  public getListenedEvents(): Array<string> {
    return this.eventEmitter.eventNames() as Array<string>;
  }

  public removeListener<T, U>(
    event: string | symbol,
    callback: (data: T) => U | Promise<U> | void | Promise<void>
  ): void {
    this.eventEmitter.removeListener(event, callback);
    return;
  }

  public removeAllListeners(event: string | symbol): void {
    this.eventEmitter.removeAllListeners(event);
    return;
  }

  public getListenerCount(event: string | symbol): number {
    return this.eventEmitter.listenerCount(event);
  }

  public getMaxListeners(): number {
    return this.eventEmitter.getMaxListeners();
  }

  public setMaxListeners(maxListeners: number): void {
    this.eventEmitter.setMaxListeners(maxListeners);
  }
  private eventUnsubscribe<T, U>(
    eventName: string | symbol,
    callback: (data: T) => U | Promise<U> | void | Promise<void>
  ): void {
    this.eventEmitter.off(eventName, callback);
    return;
  }

  public static getNewInstance(maxListeners?: number): EventBusService {
    return new EventBusService(maxListeners);
  }
}
export const eventBusService = EventBusService.getNewInstance();

export default eventBusService;
