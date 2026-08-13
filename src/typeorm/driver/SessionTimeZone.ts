import { TypeORMError } from '../error/TypeORMError.js';

const OFFSET_TIME_ZONE = /^([+-])(\d{2}):(\d{2})$/;
const NAMED_TIME_ZONE = /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/;

/** Normalizes and validates a database session time zone. */
export function normalizeSessionTimeZone(value?: string): string {
  const timeZone = value?.trim() || 'UTC';
  const offset = OFFSET_TIME_ZONE.exec(timeZone);

  if (offset) {
    const hours = Number(offset[2]);
    const minutes = Number(offset[3]);
    if (hours <= 14 && minutes < 60 && (hours < 14 || minutes === 0)) {
      return timeZone;
    }
    throw new TypeORMError(`Invalid session time zone: ${timeZone}`);
  }

  if (!NAMED_TIME_ZONE.test(timeZone)) {
    throw new TypeORMError(`Invalid session time zone: ${timeZone}`);
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new TypeORMError(`Invalid session time zone: ${timeZone}`);
  }

  return timeZone;
}
