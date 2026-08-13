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
one only by a reproducible source comparison and must document the method and
remaining differences.

## Local patch log

The following is a category-level patch log. Git history and regression tests
remain the source of truth for individual changes.

| Patch family            | Local behavior maintained by this project                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packaging and runtime   | ESM/CJS dual output, Node.js 20+ and ES2022 migration, package-owned TypeORM entry point, circular-import fixes.                                      |
| Oracle/PostgreSQL focus | Reduced driver surface focused on Oracle and PostgreSQL, custom pool/config wiring, optional `pg-native` handling, query-runner release fixes.        |
| Session isolation       | Validated per-connection `sessionTimeZone`, default UTC sessions, per-pool result parser/fetch-handler configuration.                                 |
| Query builders          | Configurable identifier quoting, database-column/property-path resolution, compound count fixes, Oracle/PostgreSQL `RETURNING`, safe SQL-tag helpers. |
| Metadata and typing     | Generic-aware entity metadata, relation-aware property maps, stricter repository/entity manager/query builder/find option types.                      |
| Naming and results      | Shared case strategy for ORM metadata and native rows, explicit custom database column maps, structured Oracle out-bind handling.                     |
| Logging and lifecycle   | ProcedureKit logger routing, slow-query reporting, connection cleanup, query runner and cache resource ownership.                                     |
| Security                | SHA-256 internal alias hashing, identifier validation, removal of callback-based raw SQL shortcuts in favor of explicit trusted fragments.            |

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
