# Migrating to typeorm-procedure-kit v3

Version 3 makes procedure outputs and database temporal values explicit. This
guide covers the changes that require application updates when moving from v2.

## Upgrade checklist

1. Replace every assumption that `call()` returns an array with the new
   `{ rows, outBinds }` result envelope.
2. Update custom serializer strategies to accept
   `{ serializerType, value, context }`.
3. Review the new temporal formats and enable the defaults explicitly only
   where string output is wanted.
4. Set `sessionTimeZone` when the application requires a zone other than the
   new `UTC` default.
5. Remove `@nestjs/core` if it was installed only to satisfy this package's
   peer dependencies.
6. Run the application on Node.js 20, 22, or 24 and compile its package
   consumption with `skipLibCheck: false` before deployment.

## Stored procedure result envelope

`call()` no longer returns only the flattened cursor rows.

Before:

```ts
const rows = await db.call<InvoiceRow>('billing.find_invoices', payload);
```

After:

```ts
type FindInvoicesOut = {
  outCursor: Array<InvoiceRow>;
  totalCount: number;
};

const result = await db.call<
  InvoiceRow,
  { customerId: number },
  FindInvoicesOut
>('billing.find_invoices', { customerId: 42 });

const rows = result.rows;
const totalCount = result.outBinds.totalCount;
```

The public shape is:

```ts
interface IProcedureResult<TRow, TOut extends Record<string, unknown>> {
  rows: Array<TRow>;
  outBinds: TOut;
}
```

- `rows` concatenates all REF CURSOR results in procedure metadata order.
- `outBinds` retains every cursor and scalar `OUT`/`INOUT` value.
- Output keys follow `outKeyTransformCase`.
- A scalar-only procedure returns `rows: []`.
- `callSqlTransaction()` is unchanged and still returns its row array.

This envelope is used by direct calls and Nest's `@InjectCallProcedure()`
provider type.

## Serializer strategy input

Custom strategies now receive a discriminated object instead of the raw value.

Before:

```ts
db.setSerializer({
  serializerType: 'JSON',
  strategy: (value) => JSON.parse(value.toString()),
});
```

After:

```ts
db.setSerializer({
  serializerType: 'JSON',
  strategy: ({ serializerType, value, context }) => {
    console.log(serializerType, context?.source, context?.databaseType);
    return typeof value === 'string' ? JSON.parse(value) : value;
  },
});
```

The contract is `{ serializerType, value, context? }`. `context` can include:

- `source`: `fetch`, `scalar-out`, or `manual`;
- `database`: `oracle` or `postgres`;
- `name`: result column or output-bind name;
- `databaseType`: native database type name/OID.

The `serializerType` discriminator narrows `value` to the native values valid
for that serializer. Nullish database values bypass custom code and normalize
to `null`.

## Temporal serialization

Default temporal serializers remain opt-in. Set
`isNeedRegisterDefaultSerializers: true` only when the application wants the
following string contract:

| Serializer      | v3 output                          | Precision |
| --------------- | ---------------------------------- | --------- |
| `DATE`          | `yyyy-MM-dd HH:mm:ss`              | seconds   |
| `TIMESTAMP`     | `yyyy-MM-dd HH:mm:ss.SSS`          | millis    |
| `TIMESTAMP_TZ`  | UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` | millis    |
| `TIMESTAMP_LTZ` | UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` | millis    |

Important changes:

- `DATE` preserves its time component instead of returning a calendar date
  only.
- `TIMESTAMP` preserves milliseconds but has no implicit offset suffix.
- zoned timestamp strings must end in `Z` or a numeric UTC offset;
- strict SQL/ISO input accepts fractional seconds up to nine digits, then
  normalizes JavaScript output to milliseconds;
- invalid dates, overflow dates, and invalid native `Date` objects throw;
- native driver `Date` objects are accepted directly without a string round
  trip.

If the flag remains `false`, the driver-native value is returned unchanged.

## Session time zone

`sessionTimeZone` now defaults to `UTC` and is validated as an IANA zone such as
`Europe/Moscow` or an offset such as `+03:00`.

```ts
const settings: IModuleConfig = {
  // ...
  config: {
    // ...
    sessionTimeZone: 'Europe/Moscow',
  },
};
```

The setting applies to every physical connection, not only the first one:

- PostgreSQL includes `-c timezone=...` in each pool connection's startup
  options.
- Oracle uses the pool session callback to run `ALTER SESSION SET TIME_ZONE`
  when each physical connection is created. Reused connections retain that
  state unless application SQL changes it. Per-call Oracle
  `optionsCommands` cannot override `TIME_ZONE`; use `sessionTimeZone` instead.

Set the old effective zone explicitly before rollout if existing code depends
on local-time-zone timestamp behavior.

## Oracle procedure temporal binds

Oracle procedure metadata now binds `DATE`, `TIMESTAMP`,
`TIMESTAMP WITH TIME ZONE`, and `TIMESTAMP WITH LOCAL TIME ZONE` with their
native node-oracledb types. `IN` and `INOUT` values accept a valid native `Date`
or a strict SQL/ISO string. Zoned strings require an offset. Temporal scalar
outputs pass through the matching serializer and appear in `outBinds`.

## NestJS peer dependency

The optional Nest peer is now only:

```text
@nestjs/common ^10 || ^11
```

`@nestjs/core` is no longer required by this package. Keep it when the host
application needs the Nest runtime, but it does not need to be installed for a
non-Nest consumer or merely to satisfy `typeorm-procedure-kit`.

## Database error envelopes

Database errors are recognized only in the expected top-level envelope. The
object must contain both a code key (`error_code`, `err_code`, `errorCode`, or
`errCode`) and a text key (`error_text`, `err_text`, `errorText`, or `errText`),
and its code must be nonzero. The camel-case forms cover output keys transformed
by the configured case strategy. Business rows, arrays, and nested objects are
not recursively scanned.

## Verification

After updating application code:

```bash
npm install typeorm-procedure-kit@3.0.0
npx tsc --noEmit
npm test
```

For the strongest declaration check, keep `skipLibCheck: false` in at least one
consumer CI job.
