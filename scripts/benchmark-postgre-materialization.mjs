/**
 * Manual microbenchmark for PostgreSQL refcursor materialization.
 *
 * Build ESM first, warm 1,000 procedure executions, then measure 11 samples
 * of 2,000 executions. Each execution materializes 100 flat rows through one
 * in-memory FETCH and one CLOSE. The median reduces scheduler noise. This
 * deliberately excludes real database/network latency and is not a CI gate.
 */
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HELP = `Usage:
  npm run benchmark:postgre-materialization
  npm run benchmark:postgre-materialization -- \\
    --baseline-ns <positive-number> \\
    --max-regression-percent <positive-number>

Options:
  --baseline-ns              Median nanoseconds per materialization to compare.
  --max-regression-percent   Maximum permitted regression from the baseline.
  --help                     Show this help.

Comparison is enabled only when both comparison options are provided.`;

function readOptionValue(args, index, optionName) {
  const argument = args[index];
  const inlinePrefix = `${optionName}=`;
  if (argument.startsWith(inlinePrefix)) {
    return { value: argument.slice(inlinePrefix.length), nextIndex: index };
  }
  if (argument !== optionName) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new TypeError(`${optionName} requires a value`);
  }
  return { value, nextIndex: index + 1 };
}

function parsePositiveNumber(value, optionName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${optionName} must be a positive non-zero number`);
  }
  return parsed;
}

function parseArguments(args) {
  if (args.includes('--help')) return { help: true };

  let baselineNs;
  let maxRegressionPercent;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const baselineOption = readOptionValue(args, index, '--baseline-ns');
    if (baselineOption) {
      if (baselineNs !== undefined) {
        throw new TypeError('--baseline-ns may be provided only once');
      }
      baselineNs = parsePositiveNumber(baselineOption.value, '--baseline-ns');
      index = baselineOption.nextIndex;
      continue;
    }

    const regressionOption = readOptionValue(
      args,
      index,
      '--max-regression-percent'
    );
    if (regressionOption) {
      if (maxRegressionPercent !== undefined) {
        throw new TypeError(
          '--max-regression-percent may be provided only once'
        );
      }
      maxRegressionPercent = parsePositiveNumber(
        regressionOption.value,
        '--max-regression-percent'
      );
      index = regressionOption.nextIndex;
      continue;
    }

    throw new TypeError(`Unknown argument: ${argument}`);
  }

  if ((baselineNs === undefined) !== (maxRegressionPercent === undefined)) {
    throw new TypeError(
      '--baseline-ns and --max-regression-percent must be provided together'
    );
  }

  return {
    help: false,
    comparison:
      baselineNs === undefined
        ? undefined
        : { baselineNs, maxRegressionPercent },
  };
}

async function runBenchmark(comparison) {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const { PostgreAdapter } = await import(
    pathToFileURL(
      `${projectRoot}/dist/esm/adapters/postgres/postgre-adapter.js`
    ).href
  );

  const logger = {
    debug() {},
    log() {},
    error() {},
    warn() {},
    verbose() {},
  };
  const adapter = new PostgreAdapter(
    { options: { replication: { master: {} } } },
    logger,
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: { transformColumnName: (value) => value },
    }
  );
  const cursorRows = Array.from({ length: 100 }, (_, id) => ({
    id,
    status: id % 3,
    label: `row-${id}`,
  }));
  const manager = {
    async query(sql) {
      if (sql.startsWith('CALL')) return [{ out_cursor: 'out_cursor' }];
      if (sql.startsWith('FETCH')) return cursorRows;
      return [];
    },
    async transaction(run) {
      return run(manager);
    },
  };
  const execute = () =>
    adapter.executeProcedure(
      'CALL "pkg"."run"($1)',
      manager,
      [],
      [null],
      ['out_cursor'],
      [{ name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' }]
    );

  const warmupExecutions = 1_000;
  for (let index = 0; index < warmupExecutions; index += 1) await execute();

  const rawSamplesNs = [];
  const iterationsPerSample = 2_000;
  const sampleCount = 11;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    for (let index = 0; index < iterationsPerSample; index += 1) {
      await execute();
    }
    rawSamplesNs.push(
      ((performance.now() - started) * 1_000_000) / iterationsPerSample
    );
  }
  const sortedSamplesNs = [...rawSamplesNs].sort((left, right) => left - right);
  const medianNs = sortedSamplesNs[Math.floor(sortedSamplesNs.length / 2)];
  const result = {
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    rowsPerExecution: cursorRows.length,
    warmupExecutions,
    sampleCount,
    iterationsPerSample,
    medianNsPerMaterialization: medianNs,
    medianNsPerRow: medianNs / cursorRows.length,
    rawSamplesNs,
  };

  if (comparison) {
    const regressionPercent =
      ((medianNs - comparison.baselineNs) / comparison.baselineNs) * 100;
    result.comparison = {
      ...comparison,
      regressionPercent,
      passed: regressionPercent <= comparison.maxRegressionPercent,
    };
  }

  console.log(JSON.stringify(result, undefined, 2));
  if (result.comparison && !result.comparison.passed) {
    console.error(
      `Benchmark regression ${result.comparison.regressionPercent.toFixed(2)}% exceeds ${result.comparison.maxRegressionPercent}%`
    );
    process.exitCode = 1;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  await runBenchmark(options.comparison);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
