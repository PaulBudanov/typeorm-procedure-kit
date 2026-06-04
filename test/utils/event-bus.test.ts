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
});
