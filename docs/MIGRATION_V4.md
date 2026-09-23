# Migrating to typeorm-procedure-kit v4

<!--
DRAFT. Written from the committed history of refactor/review-findings up to
1013920. Sections marked "PENDING" depend on work that is not committed yet;
fill them in, or delete them, before the release. Search for "PENDING".
-->

Version 4 makes Oracle and PostgreSQL behave the same way and replaces several
silent outcomes with errors: a result column that was dropped, a payload value
bound under the wrong key, an error row reported as success. This guide covers
the changes that require application updates when moving from v3. The NestJS
service and its injected providers call the same methods, so every section
also applies to Nest applications.

## Upgrade checklist

1. Give every result column a unique name. On PostgreSQL this applies to every
   query that runs through the kit's DataSource, including `SELECT 1, 2`,
   repeated aggregates such as `count(a), count(b)`, and `SELECT *` across
   tables that share column names. On Oracle, `SELECT a.ID, b.ID` no longer
   returns `id` and `id_1`.
2. Give every raw SQL placeholder a value. Write `value ?? null` for an
   optional filter, because a key set to `undefined` now counts as missing.
   Check SQL that puts a colon directly before a lower-case name for any
   purpose other than a placeholder.
3. Pass each procedure argument under one key only, `amount` or `p_amount`,
   even when one of the two values is `null`.
4. Copy class getters into own properties before you pass a class instance as a
   procedure payload.
5. Review statements whose first result row has a nonzero `error_code` and an
   `error_text`: they now throw for any number of rows. Opt such a statement
   out with `executionOptions.errorEnvelopeKeys`.
6. Raise notification `retryDelayMs` and `retryAfterMaxDelayMs` to at least
   `100`.
7. Review notification callbacks, which now also receive payloads that look
   like error envelopes. On PostgreSQL, review the package-change trigger:
   every payload that names a configured package now refreshes it.
8. On Oracle, check `outBinds` for scalar `OUT`/`INOUT` arguments whose type
   has a registered serializer, and check REF CURSOR keys if your case
   strategy is not idempotent.
9. Do not rely on `deleteSerializer()` to ignore an unknown type, register only
   function strategies, and do not mutate `databaseAdapter.serializerMapping`.
10. Remove imports of `AsyncUtils`, `TypeGuards`, `QueueManager`,
    `EventBusService`, `IEventBusService`, `ICollectionStrategy`, `TMapKey`,
    and `TQueueType`. Replace `ServerError.unsafeGetContextAs()` with
    `errorContext`.
11. If you read `databaseAdapter.makeSqlBindings()` on Oracle, read `bindings`
    as an object keyed by placeholder name.
12. If you branch on the error thrown when no pooled connection is available,
    read the driver error from `error.cause`.
13. If you construct `QueryTimer` yourself, call `start()`. If you alert on log
    text, review the changed messages.

## Result column names must be unique

Two columns with one output name are rejected on both databases. In v3 the
outcome depended on the database and on the code path:

| Where                                        | v3 outcome                                                                    | v4 outcome |
| -------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| PostgreSQL, the same name twice              | one key, holding the value of the last column                                 | error      |
| PostgreSQL, names equal after the case rules | error, but only when the result had rows                                      | error      |
| Oracle, direct queries and REF CURSOR rows   | the second column was renamed, for example `id_1`, or overwrote the first one | error      |

Before:

```sql
SELECT o.id, c.id, o.total
  FROM orders o
  JOIN customers c ON c.id = o.customer_id;
```

After:

```sql
SELECT o.id AS order_id, c.id AS customer_id, o.total
  FROM orders o
  JOIN customers c ON c.id = o.customer_id;
```

The error names both source columns and the shared output name:

```text
PostgreSQL result columns "id" and "id" have conflicting transformed name "id"
Oracle result columns "ID" and "ID" have conflicting transformed name "id"
```

On PostgreSQL, node-postgres builds each row object by column name, so the
first of two equally named columns was gone before the kit saw the row. v4
checks the row description once per statement, before the first row, and also
when the statement returns no rows. The check covers every query that runs
through the kit's DataSource: `call()` cursors, `callSqlTransaction()`,
`dataSource.query()`, repositories, query builders, and streams. Common
sources of duplicate names:

- constant columns: `SELECT 1, 2` names both columns `?column?`;
- repeated functions: `SELECT count(a), count(b)` names both columns `count`;
- `SELECT *` across joined tables that share a column such as `id` or
  `created_at`;
- `UPDATE ... FROM ... RETURNING *`, which returns the columns of every table in
  `FROM`.

The check runs after PostgreSQL has executed the statement. A data-changing
statement with duplicate `RETURNING` names that runs outside a transaction,
for example through `dataSource.query()`, is applied and then reported as
failed. Alias those columns before you upgrade. Called through the kit, the
error is a `ServerError`. Called through the DataSource, it is a
`QueryFailedError` that wraps it.

On Oracle, the check now also covers direct queries, not only REF CURSOR rows.
It relies on the rowset metadata that node-oracledb 7 passes to the fetch type
handler. A driver that does not pass that metadata skips the direct-query
check.

## Procedure payload keys

An object payload is matched to procedure arguments by name. Each argument
reads the key equal to its lowercase argument name (`p_amount`) or the same
name without a leading `p_` (`amount`). v4 applies one rule to both databases:

- Supplying both keys for one argument is rejected for scalar, cursor, and
  structured arguments alike. In v3, Oracle silently preferred the key without
  `p_`, and PostgreSQL rejected the pair only for composite arguments.
- A key set to `null` counts as supplied and binds SQL `NULL`. A key set to
  `undefined` counts as absent, so spreading an object with unset optional
  properties does not cause a conflict. In v3, an explicit `null` lost to the
  other key.
- Only the payload's own properties are read. A key that the payload inherits
  from a prototype other than `Object.prototype`, such as a getter, method, or
  prototype property of a class, is rejected with a `ServerError` that names
  the key and the argument. In v3 that value was read and bound.
  `Object.prototype` members such as `toString`, and the implicit
  `constructor` of a class, are ignored.
- Keys that match no argument are still ignored, so a misspelt key leaves its
  argument `NULL`. Argument names are matched in lower case and do not pass
  through the case strategy: `customerId` does not match `p_customer_id`.
- An array payload still binds its elements by argument position; a missing,
  `null`, or `undefined` element binds `NULL`.

Before:

```ts
// v3 bound 1 on both databases: the key without p_ won.
await db.call('billing.create_invoice', { amount: 1, p_amount: 2 });

// v3 bound 5: the explicit null lost to the other key.
await db.call('billing.set_flag', { flag: null, p_flag: 5 });
```

After:

```ts
await db.call('billing.create_invoice', { amount: 1 });
await db.call('billing.set_flag', { flag: null });
```

Class instances as payloads:

```ts
class InvoiceInput {
  public constructor(private readonly cents: number) {}

  public get amount(): number {
    return this.cents / 100;
  }
}

const input = new InvoiceInput(1000);

// v3 bound 10. v4 throws:
// Inherited PostgreSQL procedure payload key "amount" for argument "p_amount": ...
await db.call('billing.create_invoice', input);

// Spreading does not help, because a spread does not copy getters.
// Copy the value into an own property instead:
await db.call('billing.create_invoice', { amount: input.amount });
```

The procedure log now pairs every value with its own argument on PostgreSQL. In
v3, from the first composite `OUT` argument onwards, values were logged under
the name of the next argument, which also bypassed `redact-by-name` redaction.

## Error envelopes in multi-row results

The error-envelope check still inspects only the top level of a result: the
first row and the `outBinds` object. In v3 it skipped a result with more than
one row. v4 inspects the first row whatever the number of rows, so a procedure
that returns an error row followed by other rows now throws instead of
reporting success.

The check applies to `call()` rows (the concatenated REF CURSOR rows),
`call()` output bindings, and `callSqlTransaction()` results. Only own
properties count.

A statement whose business rows have columns named like an envelope, with a
nonzero code in the first row, now throws for any number of rows. In v3 that
happened only when exactly one row came back. Opt such a statement out:

```ts
await db.callSqlTransaction<ImportLogRow>(
  'SELECT ERROR_CODE, ERROR_TEXT, CREATED_AT FROM BILLING.IMPORT_LOG',
  undefined,
  { errorEnvelopeKeys: { errorCodeKeys: [] } }
);
```

`errorEnvelopeKeys` has two lists:

- `errorCodeKeys`, default `['error_code', 'err_code', 'errorCode', 'errCode']`;
- `errorTextKeys`, default `['error_text', 'err_text', 'errorText', 'errText']`.

A list you leave out keeps its default. An empty list switches the check off for
that call, for rows and output bindings alike. To use your own envelope, pass
both lists, for example
`{ errorCodeKeys: ['status_code'], errorTextKeys: ['status_text'] }`.

Notification payloads are no longer passed through this check; see the next
section.

## Notifications

### Restore delays

`retryDelayMs` and `retryAfterMaxDelayMs` must be integers in
`100..2_147_483_647` milliseconds. v3 accepted `0..2_147_483_647`. A smaller
value is rejected with a `RangeError` when `makeNotify()` registers the
subscription:

```text
RangeError: retryDelayMs must be an integer between 100 and 2147483647
```

The restore loop restarts its attempt counter after `maxRetries`, so a zero
delay reconnected to a failing database without a pause, forever. Test suites
that used a very short delay to make restores fast should use `100`.

### Callbacks receive every payload

PostgreSQL NOTIFY payloads and Oracle CQN refetched rows reach the callback as
they arrived. In v3, a payload or first row that looked like a procedure error
envelope was logged as an error and never reached the callback. A watched table
with `error_code`/`error_text` columns is table data, not a procedure result.

### PostgreSQL package-change payloads

Dynamic package metadata refresh no longer reads the `event` field on
PostgreSQL. Every NOTIFY payload that is a JSON object with a string `object`
field naming a configured package refreshes that package. In v3, only `CREATE`
and `DROP` events refreshed, so `CREATE OR REPLACE` refreshed on Oracle but not
on PostgreSQL.

```sql
SELECT pg_notify(
  'db_object_event',
  json_build_object('event', 'ALTER', 'object', 'billing')::text
);
```

If your trigger sends a notification for every DDL statement in a configured
schema, expect more refreshes than before. Limit the trigger to changes that
can alter procedure signatures, such as creating, replacing, altering, or
dropping a procedure or a composite type. A payload without a string `object`
field is now logged as a warning and skipped. v3 skipped it without a log.

### Shutdown and restore

- `destroy()` no longer waits without limit for a driver unsubscribe that does
  not settle. Each unsubscribe is bounded like restores and pending
  registrations, and a shutdown task that fails is logged.
- PostgreSQL now stops a channel's health check before it drains the callback
  queue, and clears the restore state when the channel closes, as Oracle
  already did.
- A failed Oracle restore re-registers under the channel name that
  `makeNotify()` returned. In v3 it could switch to a new name, so
  `unlistenNotify()` could no longer find the subscription.

<!-- PENDING (package-change notification handling moves into each vendor
notifier; Oracle callback errors isolated per event chunk; default Oracle CQN
query ACTION values): not started or not decided. Describe any observable
change here. -->

## Oracle serializers and REF CURSOR rows

A registered serializer now runs on every Oracle scalar `OUT` and `INOUT`
binding whose type it covers, not only on the temporal ones. v3 already did
this for the same types inside a PL/SQL `RECORD`.

| Oracle argument type               | Serializer that now runs |
| ---------------------------------- | ------------------------ |
| `BOOLEAN`                          | `BOOLEAN`                |
| `CHAR`, `NCHAR`                    | `CHAR`                   |
| `VARCHAR`, `VARCHAR2`, `NVARCHAR2` | `VARCHAR`                |
| `JSON`                             | `JSON`                   |
| `RAW`                              | `BINARY`                 |
| `XMLTYPE`                          | `XML`                    |

The value reaches the strategy with `context.source: 'scalar-out'`. If you
registered one of these serializers, the matching `outBinds` values now hold
what the strategy returns.

REF CURSOR columns are named and serialized once, by the fetch type handler,
exactly like the columns of a plain query. In v3 the case strategy and the
temporal serializers ran a second time on cursor rows. That second pass
changed nothing for the built-in strategies on most names. It did change names
that the strategy does not map onto themselves: under `camelCase`, `A_B_C` now
becomes `aBC` in a cursor row, as in a plain query, not `aBc`. A custom temporal
strategy is no longer handed a value it has already produced.

A REF CURSOR that comes back without a usable column description is returned
as the driver produced it, and a warning names the cursor. LOB handles inside
REF CURSOR rows are now released with the rest of the call's resources when a
row fails part-way through.

## Serializer registration

- `setSerializer()` rejects a strategy that is not a function when you
  register it. In v3 it was stored and failed later, once per value.
- `deleteSerializer()` throws for a type that is not a supported serializer
  key. In v3 that call did nothing. Deleting a supported key that has no
  registered strategy still does nothing.
- Both methods throw for a non-object argument and for names that exist only
  on `Object.prototype`, such as `toString`.
- `serializerReadOnlyMapping` returns the same frozen object until the registry
  changes. `databaseAdapter.serializerMapping` returns that same object, so its
  `set`, `delete`, and `clear` now throw. In v3 the adapter getter returned a
  new mutable copy.

```text
Unknown serializer type: INTERVAL
Serializer strategy for DATE must be a function
Serializer options must be an object
Read-only map: cannot modify
```

## Raw SQL placeholders

Placeholders in `callSqlTransaction()` follow these rules on both databases:

- Every placeholder needs a value: an own key of `params`, matched without
  regard to letter case. `null` binds SQL `NULL`. A key set to `undefined`, an
  inherited key, or no key at all is rejected with a `ServerError` before the
  statement runs. In v3 the placeholder was bound as `NULL`, so a misspelt key
  ran the statement with `NULL`.
- The error names the placeholder and the keys you supplied, never their
  values.
- Keys that match no placeholder are still ignored.
- Placeholders are recognized in any letter case: `:userId`, `:USERID`, and
  `:UserId` all read the `userId` key. v3 recognized only upper-case
  placeholders and left the others in the SQL text, where Oracle reported an
  unbound variable and PostgreSQL a syntax error.
- Outside string literals, quoted identifiers, and comments, a colon directly
  followed by a name is always a placeholder. A name that starts with a digit,
  as in `tags[1:2]`, or that contains a dot, as in `:new.id`, stays in the SQL
  text. Write `tags[1: n]` for a PostgreSQL array slice bounded by a column,
  and `JSON_OBJECT('id' : id)` on Oracle.

Before:

```ts
// v3 bound NULL when fromDate was undefined, and also when the key was misspelt.
await db.callSqlTransaction(
  'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)',
  { FROM_DATE: filters.fromDate }
);
```

After:

```ts
await db.callSqlTransaction(
  'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)',
  { FROM_DATE: filters.fromDate ?? null }
);
```

```text
Raw SQL placeholder :FROM_DATE has no value in params: key "FROM_DATE" is undefined, which counts as absent; pass null to bind SQL NULL
Raw SQL placeholder :USER_ID has no value in params; supplied keys: "USERID"
```

### Oracle bindings by name

Oracle raw SQL is bound by name. `databaseAdapter.makeSqlBindings()` returns
`bindings` as an object keyed by placeholder name, and the driver sends each
value to every occurrence of that name. In v3 it returned an array with one
value per occurrence.

Before:

```ts
const { bindings } = db.databaseAdapter.makeSqlBindings(
  'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)',
  { FROM_DATE: '2024-01-01' }
);
// ['2024-01-01', '2024-01-01']
```

After:

```ts
// { FROM_DATE: '2024-01-01' }
```

`ISqlBindingsObjectReturn['bindings']` is now
`Array<unknown> | Record<string, unknown>`. PostgreSQL still returns an array.
A PL/SQL block that repeats a placeholder, which failed in v3, now works.
Calls to `callSqlTransaction()` need no change for this.

## Errors and logs

When no pooled connection can be obtained, `call()` and
`callSqlTransaction()` now reject with a `ServerError` that carries the query
id. The original error, which can be an `AggregateError` when cleanup also
failed, is in `error.cause`. In v3 the driver error was thrown as it was.

```ts
import { ServerError } from 'typeorm-procedure-kit';

try {
  await db.call('billing.find_invoices', { customer_id: 42 });
} catch (error) {
  const driverError = error instanceof ServerError ? error.cause : error;
  // inspect driverError.code and similar driver fields here
}
```

`ServerError.unsafeGetContextAs()` was removed. Read the public
`error.errorContext` field instead.

A statement whose driver result is not a row array no longer risks being
reported as failed after it has run: in v3 a `null` result raised a
`TypeError` that was rethrown as a `ServerError`. The log line reports a row
count only for row arrays.

`QueryTimer` no longer logs from its constructor. Code that creates a
`QueryTimer` directly must call `start()` when the statement is sent to the
database. The kit now logs the start of a query after it has a connection, so
a pool failure produces a failure line and no start line.

Log messages that changed:

- Notification close, both databases: the warning for a channel without a
  connection is now `No active notification connection for channel`. It was
  `No listener found for channel` on PostgreSQL and
  `No active subscription for channel` on Oracle.
- PostgreSQL notification close: `Successfully unregistered listener for
channel` is now `Unsubscribed from channel`, and the error line now names the
  channel.
- The Oracle restore warning `Channel name for subscription ... change to ...`
  is now `Could not close lost subscription ... before restoring it: ...`.
- `Unknown database type!` now also names the value it received and the
  supported types.

<!-- PENDING (log wording and remaining log-text fixes): not started. Add any
further changed messages here. -->

## Removed exports

`AsyncUtils`, `TypeGuards`, `QueueManager`, and `EventBusService` are no longer
exported, together with the `IEventBusService`, `ICollectionStrategy`,
`TMapKey`, and `TQueueType` types. The kit did not use them. Copy the code you
need from the v3 sources, or use a dedicated library.

<!-- PENDING (public export narrowing, awaiting an owner decision): if the
explicit export list and the Postgre -> Postgres type renames ship in v4,
list every removed or renamed export here with its replacement. -->

## New in v4

These changes need no action:

- Oracle scalar procedure arguments accept the same types as `RECORD` fields,
  including `CHAR`, `NCHAR`, `VARCHAR`, `NVARCHAR2`, `BOOLEAN`, `PLS_INTEGER`,
  `BINARY_INTEGER`, `BINARY_FLOAT`, `BINARY_DOUBLE`, and the `NUMBER` subtypes.
  `OUT` bindings of variable-length types get an explicit `maxSize`. `NCLOB`,
  `BFILE`, `LONG`, `ROWID`, `JSON`, `VECTOR`, `XMLTYPE`, `INTERVAL` types,
  collections, and object types are still rejected with
  `Invalid data type: <TYPE>`.
- `IExecutionOptions.errorEnvelopeKeys`, described above.
- `NO_ARGUMENT_SENTINEL` is exported. A custom `procedureMetadataSql` must
  return this value as the argument name of a procedure without arguments.
- A PostgreSQL composite payload key set to `undefined` no longer conflicts
  with the same argument under its other key.

Unchanged, and now documented: Oracle `NUMBER` values, including the
`INTEGER`, `DECIMAL`, `NUMERIC`, `FLOAT`, `REAL`, and `DOUBLE PRECISION`
subtypes, arrive as JavaScript numbers in scalar `OUT`/`INOUT` values, `RECORD`
fields, and REF CURSOR rows. Integers beyond `Number.MAX_SAFE_INTEGER` and
values with more than 15 significant digits are rounded. Return such values as
`VARCHAR2`, for example with `TO_CHAR`, when exact digits matter, and pass
exact integer inputs as `bigint`.

## Verification

After updating application code:

```bash
npm install typeorm-procedure-kit@4.0.0
npx tsc --noEmit
npm test
```

Most v4 changes are runtime checks that the compiler cannot see: duplicate
result columns, payload keys, error envelopes, and retry delays. Run the
application's database tests against a real Oracle or PostgreSQL instance
before deployment.
