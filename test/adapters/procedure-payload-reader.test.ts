import { describe, expect, it } from 'vitest';

import { readPayloadValue } from '../../src/adapters/abstract/procedure-payload-reader.js';
import { ServerError } from '../../src/utils/server-error.js';

import type { TProcedurePayload } from '../../src/types/procedure.types.js';

/**
 * The payload reader shared by the Oracle and PostgreSQL bindings, called
 * directly. The vendor cases driven through each adapter's `makeBindings` live
 * in `oracle-payload-reader.test.ts` and `postgre-payload-reader.test.ts`; this
 * file pins the module itself, once per vendor name it accepts.
 */

type TVendorName = 'Oracle' | 'PostgreSQL';

const VENDOR_NAMES = [
  'Oracle',
  'PostgreSQL',
] as const satisfies ReadonlyArray<TVendorName>;

function thrownBy(read: () => unknown): unknown {
  try {
    read();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the payload reader to throw');
}

function conflictMessage(
  vendorName: TVendorName,
  aliasName: string,
  argumentName: string
): string {
  return `Conflicting ${vendorName} procedure payload keys: "${aliasName}" and "${argumentName}"`;
}

function inheritedMessage(
  vendorName: TVendorName,
  key: string,
  argumentName: string
): string {
  return `Inherited ${vendorName} procedure payload key "${key}" for argument "${argumentName}": only own properties are read, so pass it as an own property, for example by copying it into a plain object`;
}

describe.each(VENDOR_NAMES)(
  'procedure payload reader (%s)',
  (vendorName): void => {
    function read(
      payload: TProcedurePayload | null | undefined,
      argumentName: string,
      index = 0
    ): unknown {
      return readPayloadValue(payload, index, argumentName, vendorName);
    }

    describe('own keys', (): void => {
      it('reads a value under the p_-stripped alias', (): void => {
        expect(read({ flag: 5 }, 'p_flag')).toBe(5);
      });

      it('reads a value under the declared argument name', (): void => {
        expect(read({ p_flag: 6 }, 'p_flag')).toBe(6);
      });

      it('reads an unprefixed argument under its own name only', (): void => {
        expect(read({ flag: 7 }, 'flag')).toBe(7);
      });

      it('returns the value itself, not a copy', (): void => {
        const ship = { name: 'Endurance' };
        expect(read({ ship }, 'p_ship')).toBe(ship);
      });

      it('returns null when neither key is present', (): void => {
        expect(read({ other: 1 }, 'p_flag')).toBeNull();
      });

      it('returns null for a null or undefined payload', (): void => {
        expect(read(null, 'p_flag')).toBeNull();
        expect(read(undefined, 'p_flag')).toBeNull();
      });
    });

    describe('explicit null', (): void => {
      it('returns an explicit null under the alias', (): void => {
        expect(read({ flag: null }, 'p_flag')).toBeNull();
      });

      it('returns an explicit null under the argument name', (): void => {
        expect(read({ p_flag: null }, 'p_flag')).toBeNull();
      });

      it('counts an explicit null alias as supplied next to the argument name', (): void => {
        const error = thrownBy(() => read({ flag: null, p_flag: 5 }, 'p_flag'));
        expect(error).toBeInstanceOf(ServerError);
        expect((error as Error).message).toBe(
          conflictMessage(vendorName, 'flag', 'p_flag')
        );
      });
    });

    describe('undefined', (): void => {
      it('returns null for an own key set to undefined', (): void => {
        expect(read({ flag: undefined }, 'p_flag')).toBeNull();
        expect(read({ p_flag: undefined }, 'p_flag')).toBeNull();
      });

      it('treats an undefined alias as absent next to the argument name', (): void => {
        expect(read({ flag: undefined, p_flag: 5 }, 'p_flag')).toBe(5);
      });

      it('treats an undefined argument name as absent next to the alias', (): void => {
        expect(read({ flag: 5, p_flag: undefined }, 'p_flag')).toBe(5);
      });

      it('binds null, without a conflict, when both keys are undefined', (): void => {
        expect(
          read({ flag: undefined, p_flag: undefined }, 'p_flag')
        ).toBeNull();
      });

      it('reads a spread object whose optional field is undefined', (): void => {
        const base = { id: 1 };
        const payload = { ...base, status: undefined };
        expect(read(payload, 'p_id')).toBe(1);
        expect(read(payload, 'p_status', 1)).toBeNull();
      });

      it('does not count an undefined optional field of a spread object as a conflict', (): void => {
        const base = { p_status: 'active' };
        const payload = { ...base, status: undefined };
        expect(read(payload, 'p_status')).toBe('active');
      });
    });

    describe('alias conflict', (): void => {
      it('rejects x and p_x supplied together', (): void => {
        const error = thrownBy(() => read({ x: 1, p_x: 2 }, 'p_x'));
        expect(error).toBeInstanceOf(ServerError);
        expect((error as Error).message).toBe(
          conflictMessage(vendorName, 'x', 'p_x')
        );
      });

      it('rejects x and p_x supplied together as own fields of a class instance', (): void => {
        class Payload {
          public x = 1;
        }
        const payload = Object.assign(new Payload(), { p_x: 2 });
        const error = thrownBy(() => read(payload, 'p_x'));
        expect(error).toBeInstanceOf(ServerError);
        expect((error as Error).message).toBe(
          conflictMessage(vendorName, 'x', 'p_x')
        );
      });
    });

    describe('class instances', (): void => {
      it('rejects a key supplied by a prototype getter, with a hint to copy the value', (): void => {
        class FlagPayload {
          public get flag(): number {
            return 1;
          }
        }
        const error = thrownBy(() => read(new FlagPayload(), 'p_flag'));
        expect(error).toBeInstanceOf(ServerError);
        expect((error as Error).message).toBe(
          inheritedMessage(vendorName, 'flag', 'p_flag')
        );
        expect((error as Error).message).toContain(
          'for example by copying it into a plain object'
        );
      });

      it('rejects a getter under the argument name, naming that key', (): void => {
        class FlagPayload {
          public get flag(): number {
            return 1;
          }
        }
        const error = thrownBy(() => read(new FlagPayload(), 'flag'));
        expect(error).toBeInstanceOf(ServerError);
        expect((error as Error).message).toBe(
          inheritedMessage(vendorName, 'flag', 'flag')
        );
      });

      it('reads the own fields of a DTO instance', (): void => {
        class ShipmentDto {
          public id = 0;
          public note: string | null = null;
          public status?: string;

          public summary(): string {
            return `${this.id}`;
          }
        }
        const dto = Object.assign(new ShipmentDto(), {
          id: 7,
          note: 'fragile',
        });
        expect(read(dto, 'p_id')).toBe(7);
        expect(read(dto, 'id')).toBe(7);
        expect(read(dto, 'p_note')).toBe('fragile');
        expect(read(dto, 'p_status')).toBeNull();
      });

      it('reads own fields assigned in a constructor', (): void => {
        class ShipmentDto {
          public readonly id: number;

          public constructor(id: number) {
            this.id = id;
          }
        }
        expect(read(new ShipmentDto(9), 'p_id')).toBe(9);
      });

      it('reads a class getter value copied into a plain object', (): void => {
        class FlagPayload {
          public get flag(): number {
            return 5;
          }
        }
        const dto = new FlagPayload();
        expect(read({ flag: dto.flag }, 'p_flag')).toBe(5);
      });

      it('ignores the constructor back-reference of a class prototype', (): void => {
        class EmptyPayload {}
        expect(read(new EmptyPayload(), 'constructor')).toBeNull();
        expect(read(new EmptyPayload(), 'p_constructor')).toBeNull();
      });
    });

    describe('null-prototype payloads', (): void => {
      function nullPrototypePayload(values: Record<string, unknown>): object {
        return Object.assign(Object.create(null) as object, values);
      }

      it('reads a null-prototype payload under the alias and the argument name', (): void => {
        expect(read(nullPrototypePayload({ flag: 5 }), 'p_flag')).toBe(5);
        expect(read(nullPrototypePayload({ p_flag: 6 }), 'p_flag')).toBe(6);
      });

      it('returns null for a key a null-prototype payload does not carry', (): void => {
        expect(read(nullPrototypePayload({}), 'p_flag')).toBeNull();
      });

      it('rejects a null-prototype payload that carries both keys', (): void => {
        const error = thrownBy(() =>
          read(nullPrototypePayload({ flag: 5, p_flag: 6 }), 'p_flag')
        );
        expect(error).toBeInstanceOf(ServerError);
        expect((error as Error).message).toBe(
          conflictMessage(vendorName, 'flag', 'p_flag')
        );
      });
    });

    describe('positional payloads', (): void => {
      it('reads an array element by argument position', (): void => {
        const payload = [5, 'note'];
        expect(read(payload, 'p_flag', 0)).toBe(5);
        expect(read(payload, 'p_note', 1)).toBe('note');
      });

      it('returns null for a missing, null or undefined element', (): void => {
        const payload = [null, undefined];
        expect(read(payload, 'p_flag', 0)).toBeNull();
        expect(read(payload, 'p_flag', 1)).toBeNull();
        expect(read(payload, 'p_flag', 2)).toBeNull();
      });

      it('ignores named properties on an array payload', (): void => {
        const payload = Object.assign([7], { flag: 1, p_flag: 2 });
        expect(read(payload, 'p_flag', 0)).toBe(7);
      });
    });
  }
);
