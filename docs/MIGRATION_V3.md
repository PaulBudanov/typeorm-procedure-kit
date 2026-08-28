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
6. Replace the removed boolean quoting switch with `identifierQuoting` and
   verify identifiers that require explicit quoting.
7. Replace persistent or arbitrary `optionsCommands` with the supported
   transaction-local PostgreSQL or restored Oracle NLS forms.
8. Run the application on Node.js 20, 22, or 24 and compile its ES2022 package
   consumption with `skipLibCheck: false` before deployment.

## Runtime and published output

Version 3 requires Node.js 20 or newer, and both published ESM and CJS builds
target ES2022. Source maps and declaration maps are intentionally excluded from
the npm package.

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

PostgreSQL cursor handling is also stricter. Missing `IN`/`INOUT refcursor`
names are generated automatically. A pure `OUT refcursor` must be named by the
stored procedure itself; every `<unnamed portal ...>` result is rejected.
Explicit portal names are limited to 63 UTF-8 bytes so that `FETCH` and `CLOSE`
cannot refer to a server-truncated SQL identifier.

Procedure results are still materialized, but bounded by `resourceLimits`.
PostgreSQL cursors are fetched in batches of at most 1,000 rows so row and byte
limits are enforced incrementally. Review the 100,000-row, 64 MiB total-result,
10,000-row procedure-metadata, 16 MiB per-LOB, 1,000-event queue, and 10,000
Oracle-CQN-ROWID defaults before deploying workloads that intentionally exceed
them. Byte accounting is an approximate logical payload estimate, not an exact
measurement of heap use, wire size, or database-driver allocations.

Oracle CQN refetch now preserves the configured projection and predicate rather
than issuing `SELECT *`. Custom Oracle CQN SQL must therefore be a simple
single-table `SELECT` with an optional alias and `WHERE` clause. Joins, set
operations, grouping, ordering, and nested queries fail before subscription
registration; split those cases into separate simple subscriptions.

For `packagesSettings.metadataNotificationSql`, an absent, empty, or
whitespace-only value now selects the adapter default SQL. Non-empty custom SQL
is trimmed before it is registered.

## Manual performance check

`npm run benchmark:postgre-materialization` is a manual diagnostic and remains
outside CI. It reports the median, raw samples, nanoseconds per row, Node.js
version, platform, and architecture. It has no built-in baseline. To compare a
run, pass both positive non-zero values explicitly:

```bash
npm run benchmark:postgre-materialization -- \
  --baseline-ns 20000 \
  --max-regression-percent 10
```

The command fails when the measured median exceeds the permitted regression.

## Logging and identifier safety

Binding values are no longer logged wholesale. The secure default
`logger.bindingLogMode: 'metadata-only'` hides every value. The less strict
`redact-by-name` compatibility mode exposes named values not recognized by its
sensitive-name heuristic. The `unsafe-values` mode restores all value logging
only as an explicit opt-in.

The bundled TypeORM runtime now uses `identifierQuoting: 'disabled'` by default
for physical database, schema, table, and column names. Generated table,
subquery, select-output, CTE, and internal aliases remain quoted. Unquoted
physical names are validated and reserved or unsafe identifiers fail with an
instruction to enable quoting.

The former boolean quoting switch has been removed without a compatibility
alias. Replace the old `false` value with:

```ts
new DataSource({ type: 'postgres', identifierQuoting: 'enabled' });
```

Use `setIdentifierQuoting('enabled')` for a single builder. Clone and subquery
builders inherit that override. Public `escape(name)` always quotes explicitly
and no longer reads the builder policy. Raw SQL strings remain unchanged.

The database query-cache default table was renamed from `query-result-cache` to
the unquoted-safe `query_result_cache`. Rename the existing table before the
upgrade, allow synchronization to create the new table, or retain the legacy
name explicitly with quoting enabled:

```ts
new DataSource({
  type: 'postgres',
  identifierQuoting: 'enabled',
  cache: { type: 'database', tableName: 'query-result-cache' },
});
```

Unsafe configured cache-table names are rejected while identifier quoting is
disabled. This keeps cache synchronization, reads, inserts, updates, and
deletes on the same physical-identifier policy.

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
@nestjs/common ^10.4.16 || ^11.0.16
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
