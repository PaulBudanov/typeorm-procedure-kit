import EventEmitter from 'events';

import type {
  IEventBusService,
  TEventBusListener,
} from '../types/utility.types.js';

export class EventBusService implements IEventBusService {
  private eventEmitter: EventEmitter;

  private constructor(maxListeners?: number) {
    this.eventEmitter = new EventEmitter();
    this.eventEmitter.setMaxListeners(maxListeners ?? 100);
  }

  public emit(event: string | symbol, data?: unknown): void {
    this.eventEmitter.emit(event, data);
  }

  public async emitAsync(
    event: string | symbol,
    data?: unknown
  ): Promise<void> {
    const listeners = this.eventEmitter.rawListeners(event) as Array<
      (data?: unknown) => unknown
    >;
    const results = listeners.map((listener) =>
      listener.call(this.eventEmitter, data)
    );
    await Promise.all(results);
  }

  public registerListener(
    event: string | symbol,
    callback: TEventBusListener
  ): void {
    this.eventEmitter.on(event, callback);
  }

  public registerOnce(
    event: string | symbol,
    callback: TEventBusListener
  ): { unsubscribe: () => void } {
    this.eventEmitter.once(event, callback);
    return {
      unsubscribe: (): void => {
        this.eventUnsubscribe(event, callback);
      },
    };
  }

  public getListenedEvents(): Array<string> {
    return this.eventEmitter.eventNames() as Array<string>;
  }

  public removeListener(
    event: string | symbol,
    callback: TEventBusListener
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
  private eventUnsubscribe(
    eventName: string | symbol,
    callback: TEventBusListener
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
