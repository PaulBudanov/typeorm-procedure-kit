# Bundled TypeORM fork provenance and maintenance

This repository vendors a TypeORM-compatible runtime under `src/typeorm`.
This document records what can and cannot be proven about its baseline, the
local patch families, and the required process for future upstream syncs.

## Provenance

- Local import commit:
  [`37fb510f1332381b5d767e11413bc4406a2283f6`](https://github.com/PaulBudanov/typeorm-procedure-kit/commit/37fb510f1332381b5d767e11413bc4406a2283f6)
  (`feat: added typeorm fork`, 2026-02-13).
- Inferred upstream release baseline: TypeORM `0.3.28`. The manifest immediately
  before the import pinned the TypeORM development dependency to `^0.3.28`, and
  the imported source is consistent with the 0.3 line.
- Exact upstream commit SHA: **unknown**. The import commit did not record an
  upstream Git SHA, source archive checksum, subtree reference, or vendor lock
  file. Therefore `0.3.28` is an evidence-based release baseline, not a claim
  that the tree is byte-identical to a particular upstream commit.

Do not invent an upstream SHA retroactively. A future maintainer may establish
one only by a documented source comparison and must document the method and
remaining differences.

## Vendored component record

The repository keeps the following provenance record for the bundled runtime.
The non-standard version suffix is deliberate: it prevents the inferred
baseline from being mistaken for a byte-identical copy of the upstream npm
package.

| Field                 | Value                                      |
| --------------------- | ------------------------------------------ |
| Component             | `typeorm`                                  |
| Component type        | `library`                                  |
| Version               | `0.3.28-inferred`                          |
| SPDX license          | `MIT`                                      |
| Vendored and modified | `true`                                     |
| Source path           | `src/typeorm`                              |
| Published paths       | `dist/{esm,cjs,types}/typeorm`             |
| Local import commit   | `37fb510f1332381b5d767e11413bc4406a2283f6` |
| Exact upstream commit | `unknown`                                  |
| Third-party notice    | `THIRD_PARTY_NOTICES.md`                   |
| Upstream repository   | `https://github.com/typeorm/typeorm`       |

`THIRD_PARTY_NOTICES.md` and this document are included in every npm package.
The package is built and packed directly from the tagged source, and npm trusted
publishing attaches provenance to the published version.

## Local patch log

The following is a category-level patch log. Git history and regression tests
remain the source of truth for individual changes.

| Patch family            | Local behavior maintained by this project                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packaging and runtime   | ESM/CJS dual output targeting ES2022 on Node.js 20+, no published source/declaration maps, package-owned TypeORM entry point, circular-import fixes.  |
| Oracle/PostgreSQL focus | Reduced driver surface focused on Oracle and PostgreSQL, custom pool/config wiring, optional `pg-native` handling, query-runner release fixes.        |
| Session isolation       | Validated per-connection `sessionTimeZone`, default UTC sessions, per-pool result parser/fetch-handler configuration.                                 |
| Query builders          | Configurable identifier quoting, database-column/property-path resolution, compound count fixes, Oracle/PostgreSQL `RETURNING`, safe SQL-tag helpers. |
| Metadata and typing     | Generic-aware entity metadata, relation-aware property maps, stricter repository/entity manager/query builder/find option types.                      |
| Naming and results      | Shared case strategy for ORM metadata and native rows, explicit custom database column maps, structured Oracle out-bind handling.                     |
| Logging and lifecycle   | ProcedureKit logger routing, slow-query reporting, connection cleanup, query runner and cache resource ownership.                                     |
| Security                | SHA-256 internal alias hashing, identifier validation, removal of callback-based raw SQL shortcuts in favor of explicit trusted fragments.            |

### Intentional identifier-quoting divergence

The official
[TypeORM 0.3.28 QueryBuilder](https://github.com/typeorm/typeorm/blob/0.3.28/src/query-builder/QueryBuilder.ts)
routes generated identifiers through its shared escaping switch. This fork
intentionally adds a more granular physical-identifier policy that is not an
upstream API: `identifierQuoting: 'disabled' | 'enabled'`, defaulting to
`disabled`. Physical database, schema, table, and column names follow that
policy; generated aliases, CTE names and outputs, constraints, indexes, and the
public explicit `escape(name)` path remain quoted. Unquoted names are validated
against the active Oracle or PostgreSQL reserved-word set and a Unicode-safe
identifier grammar.

The implementation keeps the upstream query-builder structure and changes only
the identifier-formatting decision points. The inferred `0.3.28` baseline and
unknown exact upstream SHA remain unchanged; this local policy must be reviewed
and re-applied deliberately during future upstream synchronization.

The upstream database-cache default `query-result-cache` requires quoted SQL.
Because this fork defaults physical quoting to `disabled`, its local default is
`query_result_cache`. Explicit legacy or otherwise unsafe cache-table names are
supported with `identifierQuoting: 'enabled'` and rejected early when quoting is
disabled. Cache read/write SQL follows the physical column policy while its
internal `cache` alias remains quoted.

### Security advisory coverage

- `GHSA-2rp8-mm9q-fp49` / `CVE-2026-73651` (TypeORM versions before `0.3.31`,
  migration-generation template-literal injection) was audited against this
  fork. The affected `src/commands/MigrationGenerateCommand.ts`, command/CLI
  tree, and `migration:generate` package entry point are not vendored, exported,
  or published here, so the vulnerable code-generation sink is not present.
  Reintroducing TypeORM CLI commands requires porting the upstream fixed
  implementation from `0.3.31` or later and regression tests covering backticks,
  backslashes, and `${...}` sequences in introspected SQL metadata.

Notable historical commits affecting the fork include `5b8932f` (ES2022/type
refactor), `034a18e` (case strategy and raw result mapping), `c8e84dc` (typed
metadata property maps), `f4235f7` (logging/circular/security work), `8ecde11`
(Oracle query and cursor handling), `feabb8d` (session time zones and database
column paths), `f6ea9fc` (count distinct quoting), and `b248b9c` (SHA-256 alias
hashing). This list is intentionally descriptive, not a substitute for the
complete Git log.

## Upstream synchronization policy

Every future sync must follow this process:

1. Select an upstream TypeORM release and record both its tag and exact Git
   commit SHA before changing vendored files. Record the source archive checksum
   as well when an archive is used.
2. Create a provenance note that names the previous local baseline, the new
   upstream SHA, and the exact directory/file selection imported from upstream.
3. Build two explicit diffs: upstream old-to-new changes and local changes since
   the last recorded baseline. Do not replace `src/typeorm` wholesale without
   classifying both diffs.
4. Port upstream changes in reviewable patch families. For each dropped or
   rewritten local patch, document the upstream replacement and retain a
   regression test proving the required behavior.
5. Resolve Oracle and PostgreSQL driver changes separately. Validate thin-mode
   Oracle, PostgreSQL, replication routing, query builders, serializers,
   `RETURNING`, migrations, listeners, cache cleanup, and connection lifecycle.
6. Run the complete release gates: source/test typecheck, lint, unit tests,
   PostgreSQL and Oracle integration tests with `RUN_INTEGRATION_TESTS=1`, ESM
   and CJS builds/imports, circular-dependency checks, strict tarball TypeScript
   consumer with `skipLibCheck: false`, and the Node.js 20/22/24 matrix.
7. Update this document with the new exact upstream SHA, sync commit, retained
   patch families, known divergences, and any deferred upstream changes.

If the exact source cannot be reproduced or the database integration gates are
not available, the synchronization is incomplete and must not be described as
an upstream rebase.
