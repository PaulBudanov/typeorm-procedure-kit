import { describe, expect, it, vi } from 'vitest';

import { EventBusService } from '../../src/utils/event-bus.js';

describe('EventBusService', (): void => {
  it('registers regular listeners and emits payloads', (): void => {
    const eventBus = EventBusService.getNewInstance();
    const listener = vi.fn<(data: { value: number }) => void>();

    eventBus.registerListener('changed', listener);
    eventBus.emit('changed', { value: 1 });

    expect(listener).toHaveBeenCalledWith({ value: 1 });
    expect(eventBus.getListenerCount('changed')).toBe(1);
    expect(eventBus.getListenedEvents()).toContain('changed');
  });

  it('registers once listeners and allows unsubscribe', (): void => {
    const eventBus = EventBusService.getNewInstance();
    const listener = vi.fn<(data: string) => void>();
    const subscription = eventBus.registerOnce('changed', listener);

    eventBus.emit('changed', 'first');
    eventBus.emit('changed', 'second');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');

    const secondListener = vi.fn<(data: string) => void>();
    const secondSubscription = eventBus.registerOnce('changed', secondListener);
    secondSubscription.unsubscribe();
    eventBus.emit('changed', 'third');

    expect(secondListener).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('awaits async listeners without breaking once listener semantics', async (): Promise<void> => {
    const eventBus = EventBusService.getNewInstance();
    const listener = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    eventBus.registerOnce('changed', listener);

    await eventBus.emitAsync('changed');
    await eventBus.emitAsync('changed');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(eventBus.getListenerCount('changed')).toBe(0);
  });

  it('removes listeners and updates max listeners', (): void => {
    const eventBus = EventBusService.getNewInstance(2);
    const listener = vi.fn<(data: string) => void>();

    expect(eventBus.getMaxListeners()).toBe(2);
    eventBus.setMaxListeners(5);
    expect(eventBus.getMaxListeners()).toBe(5);

    eventBus.registerListener('changed', listener);
    eventBus.removeListener('changed', listener);
    eventBus.emit('changed', 'payload');

    expect(listener).not.toHaveBeenCalled();
    eventBus.registerListener('changed', listener);
    eventBus.removeAllListeners('changed');
    expect(eventBus.getListenerCount('changed')).toBe(0);
  });

  it('collects async and sync listener failures without skipping later listeners', async (): Promise<void> => {
    const eventBus = EventBusService.getNewInstance();
    const starts: Array<string> = [];
    const asyncFailure = new Error('async listener failed');
    const syncFailure = new Error('sync listener failed');
    const receivers: Array<unknown> = [];

    eventBus.registerListener(
      'changed',
      function (this: unknown): Promise<void> {
        receivers.push(this);
        starts.push('async');
        return Promise.reject(asyncFailure);
      }
    );
    eventBus.registerOnce('changed', (): void => {
      starts.push('sync');
      throw syncFailure;
    });
    eventBus.registerListener('changed', function (this: unknown): void {
      receivers.push(this);
      starts.push('last');
    });

    await expect(eventBus.emitAsync('changed')).rejects.toBeInstanceOf(Error);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(starts).toEqual(['async', 'sync', 'last']);
    expect(receivers[0]).toBeDefined();
    expect(receivers[1]).toBe(receivers[0]);
    expect(eventBus.getListenerCount('changed')).toBe(2);
  });
});
