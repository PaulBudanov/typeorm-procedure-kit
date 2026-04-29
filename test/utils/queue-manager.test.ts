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
