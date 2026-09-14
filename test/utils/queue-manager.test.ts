import { describe, expect, it, vi } from 'vitest';

import { QueueManager } from '../../src/utils/queue-manager.js';

describe('QueueManager', (): void => {
  it('manages array queues and emits events', (): void => {
    const queue = new QueueManager<string>('items', 'array');
    const onEnqueue = vi.fn<(data: { item: string }) => void>();
    const onDequeue = vi.fn<(data: { item: string }) => void>();

    queue.subscribeToEnqueue(onEnqueue);
    queue.subscribeToDequeue(onDequeue);
    queue.enqueue(undefined, 'a');
    queue.enqueue(undefined, 'b');

    expect(queue.size()).toBe(2);
    expect(queue.dequeue()).toBe('a');
    expect(queue.dequeue(0)).toBe('b');
    expect(onEnqueue).toHaveBeenCalledTimes(2);
    expect(onDequeue).toHaveBeenCalledTimes(2);
  });

  it('manages map queues by key', (): void => {
    const queue = new QueueManager<number>('items', 'map');

    queue.enqueue('a', 1);
    queue.enqueue('b', 2);

    expect(queue.getQueue()).toEqual(
      new Map<string, number>([
        ['a', 1],
        ['b', 2],
      ])
    );
    expect(queue.dequeue('b')).toBe(2);
    expect(queue.size()).toBe(1);
    expect((): void => {
      queue.enqueue(undefined, 3);
    }).toThrow(ReferenceError);
  });

  it('manages set queues by value', (): void => {
    const queue = new QueueManager<string>('items', 'set');

    queue.enqueue(undefined, 'a');
    queue.enqueue(undefined, 'b');

    expect(queue.dequeue('b')).toBe('b');
    expect(queue.dequeue()).toBe('a');
    expect(queue.dequeue()).toBeUndefined();
  });

  it('dequeues Map entries in insertion order and emits the removed key', (): void => {
    const queue = new QueueManager<number>('items', 'map');
    const onDequeue = vi.fn();
    queue.subscribeToDequeue(onDequeue);
    queue.enqueue('first', 2);
    queue.enqueue(2, 3);

    expect(queue.dequeue()).toBe(2);
    expect(queue.getQueue()).toEqual(new Map([[2, 3]]));
    expect(onDequeue).toHaveBeenLastCalledWith({ key: 'first', item: 2 });
    expect(queue.dequeue()).toBe(3);
    expect(queue.size()).toBe(0);
    expect(onDequeue).toHaveBeenLastCalledWith({ key: 2, item: 3 });
    expect(queue.dequeue()).toBeUndefined();
    expect(onDequeue).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid Map key without mutating or notifying', (): void => {
    const item = { id: 1 };
    const queue = new QueueManager<typeof item>('items', 'map');
    const onDequeue = vi.fn();
    queue.subscribeToDequeue(onDequeue);
    queue.enqueue('first', item);

    expect(() => queue.dequeue(item)).toThrow('Invalid key for Map collection');
    expect(queue.getQueue()).toEqual(new Map([['first', item]]));
    expect(onDequeue).not.toHaveBeenCalled();
  });

  it('emits only for Map keys that exist, including undefined values', (): void => {
    const queue = new QueueManager<undefined>('items', 'map');
    const onDequeue = vi.fn();
    queue.subscribeToDequeue(onDequeue);
    queue.enqueue('first', undefined);
    queue.enqueue('second', undefined);

    expect(queue.dequeue('missing')).toBeUndefined();
    expect(onDequeue).not.toHaveBeenCalled();
    expect(queue.dequeue('second')).toBeUndefined();
    expect(onDequeue).toHaveBeenLastCalledWith({
      key: 'second',
      item: undefined,
    });
    expect(queue.dequeue()).toBeUndefined();
    expect(onDequeue).toHaveBeenLastCalledWith({
      key: 'first',
      item: undefined,
    });
    expect(queue.size()).toBe(0);
    expect(onDequeue).toHaveBeenCalledTimes(2);
  });

  it.each(['array', 'set'] as const)(
    'removes and emits undefined items from %s queues',
    (collection): void => {
      const queue = new QueueManager<undefined>('items', collection);
      const onDequeue = vi.fn();
      queue.subscribeToDequeue(onDequeue);
      queue.enqueue(undefined, undefined);

      expect(queue.dequeue()).toBeUndefined();
      expect(queue.size()).toBe(0);
      expect(onDequeue).toHaveBeenCalledExactlyOnceWith({
        key: undefined,
        item: undefined,
      });
      expect(queue.dequeue()).toBeUndefined();
      expect(onDequeue).toHaveBeenCalledOnce();
    }
  );

  it('returns false and suppresses enqueue events for Set duplicates', async (): Promise<void> => {
    const queue = new QueueManager<string>('items', 'set');
    const onEnqueue = vi.fn<(data: { item: string }) => void>();

    queue.subscribeToEnqueue(onEnqueue);

    expect(queue.enqueue(undefined, 'a')).toBe(true);
    await expect(queue.enqueueAsync(undefined, 'a')).resolves.toBe(false);
    expect(queue.size()).toBe(1);
    expect(onEnqueue).toHaveBeenCalledOnce();
  });

  it('emits for new or changed Map values but not exact duplicates', async (): Promise<void> => {
    const queue = new QueueManager<number>('items', 'map');
    const onEnqueue = vi.fn<(data: { item: number }) => void>();

    queue.subscribeToEnqueue(onEnqueue);

    expect(queue.enqueue('a', 1)).toBe(true);
    expect(queue.enqueue('a', 1)).toBe(false);
    await expect(queue.enqueueAsync('a', 2)).resolves.toBe(true);
    await expect(queue.enqueueAsync('a', 2)).resolves.toBe(false);
    expect(queue.getQueue()).toEqual(new Map<string, number>([['a', 2]]));
    expect(onEnqueue).toHaveBeenCalledTimes(2);
  });

  it('throws for invalid collection operations', (): void => {
    expect((): void => {
      new QueueManager<string>('items', 'wrong' as never);
    }).toThrow(RangeError);

    const queue = new QueueManager<string>('items', 'array');
    queue.enqueue(undefined, 'a');

    expect((): void => {
      queue.dequeue(2);
    }).toThrow('Index out of bounds');
    expect((): void => {
      queue.dequeue('missing');
    }).toThrow('Value not found');
  });
});
