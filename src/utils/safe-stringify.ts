const DEFAULT_REDACT_KEYS =
  /password|passwd|pwd|pass|secret|token|authorization|auth|cookie|credential|apikey|api_key|privatekey|private_key/i;

interface ISafeStringifyOptions {
  maxArrayLength?: number;
  maxDepth?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
  redactKeys?: RegExp;
}

const DEFAULT_OPTIONS: Required<ISafeStringifyOptions> = {
  maxArrayLength: 50,
  maxDepth: 5,
  maxObjectKeys: 50,
  maxStringLength: 256,
  redactKeys: DEFAULT_REDACT_KEYS,
};

function truncateString(value: string, maxStringLength: number): string {
  if (value.length <= maxStringLength) return value;
  return `${value.slice(0, maxStringLength)}...`;
}

function sanitizeForLog(
  value: unknown,
  options: Required<ISafeStringifyOptions>,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof value === 'string')
    return truncateString(value, options.maxStringLength);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (value === undefined) return '[undefined]';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer:${value.length}]`;

  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= options.maxDepth) return '[MaxDepth]';

  seen.add(value);

  if (Array.isArray(value)) {
    const values = value
      .slice(0, options.maxArrayLength)
      .map((item) => sanitizeForLog(item, options, depth + 1, seen));
    if (value.length > options.maxArrayLength)
      values.push(`[${value.length - options.maxArrayLength} more items]`);
    seen.delete(value);
    return values;
  }

  const result: Record<string, unknown> = {};
  let keyCount = 0;
  for (const entryKey in value) {
    if (!Object.prototype.hasOwnProperty.call(value, entryKey)) continue;
    if (keyCount >= options.maxObjectKeys) {
      result['[truncated]'] = 'additional keys omitted';
      break;
    }
    result[entryKey] = options.redactKeys.test(entryKey)
      ? '[REDACTED]'
      : sanitizeForLog(
          (value as Record<string, unknown>)[entryKey],
          options,
          depth + 1,
          seen
        );
    keyCount += 1;
  }

  seen.delete(value);
  return result;
}

export function safeStringify(
  value: unknown,
  options: ISafeStringifyOptions = {}
): string {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  try {
    return JSON.stringify(
      sanitizeForLog(value, mergedOptions, 0, new WeakSet<object>())
    );
  } catch {
    return '[Unserializable value]';
  }
}
