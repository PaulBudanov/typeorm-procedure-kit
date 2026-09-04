import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const tempRoot = await mkdtemp(join(tmpdir(), 'typeorm-procedure-kit-'));
const maxPackedBytes = 1_500_000;
const maxUnpackedBytes = 7_000_000;
const maxEntryCount = 2_000;
const sourcePackageJson = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8')
);
const supportedScenarios = new Set([
  'combined',
  'vendor-neutral',
  'postgres',
  'oracle',
  'nest10',
  'nest11',
]);
const scenario =
  process.env.PROCEDURE_KIT_CONSUMER_SCENARIO ?? process.argv[2] ?? 'combined';

if (!supportedScenarios.has(scenario)) {
  throw new Error(
    `Unknown package consumer scenario "${scenario}". Expected one of: ${Array.from(supportedScenarios).join(', ')}`
  );
}

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} failed with exit code ${result.status}`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return result.stdout;
}

function parseJson(value, description) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${description} is not valid JSON`, { cause: error });
  }
}

function packProject() {
  const results = parseJson(
    run('npm', [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      tempRoot,
      '--cache',
      join(tempRoot, 'npm-cache'),
    ]),
    'npm pack output'
  );
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error('npm pack must return exactly one package result');
  }

  const packResult = results[0];
  if (
    !packResult ||
    typeof packResult !== 'object' ||
    typeof packResult.filename !== 'string' ||
    typeof packResult.size !== 'number' ||
    typeof packResult.unpackedSize !== 'number' ||
    typeof packResult.entryCount !== 'number' ||
    !Array.isArray(packResult.files)
  ) {
    throw new Error('npm pack returned an invalid package result');
  }
  if (
    packResult.size > maxPackedBytes ||
    packResult.unpackedSize > maxUnpackedBytes ||
    packResult.entryCount > maxEntryCount
  ) {
    throw new Error(
      `Package exceeds its size budget: ${packResult.size} packed bytes, ${packResult.unpackedSize} unpacked bytes, ${packResult.entryCount} entries`
    );
  }

  const entries = new Set(packResult.files.map((file) => file.path));
  for (const requiredPath of [
    'CHANGELOG.md',
    'LICENSE.md',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'dist/cjs/index.js',
    'dist/cjs/package.json',
    'dist/esm/index.js',
    'dist/types/index.d.ts',
    'docs/MIGRATION_V3.md',
    'docs/TYPEORM_FORK.md',
    'package.json',
  ]) {
    if (!entries.has(requiredPath)) {
      throw new Error(`Packed package is missing ${requiredPath}`);
    }
  }

  for (const entry of entries) {
    if (
      entry === 'SBOM.cdx.json' ||
      entry.startsWith('.github/') ||
      entry.startsWith('reports/') ||
      entry.startsWith('scripts/') ||
      entry.startsWith('src/') ||
      entry.endsWith('.map') ||
      (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) ||
      entry.toLowerCase().includes('tsbuildinfo') ||
      entry === '.env' ||
      entry.startsWith('.env.')
    ) {
      throw new Error(`Packed package contains forbidden path ${entry}`);
    }
  }

  return {
    filename: packResult.filename,
    tarballPath: join(tempRoot, packResult.filename),
  };
}

async function validateInstalledPackage(packageRoot) {
  for (const requiredPath of [
    'CHANGELOG.md',
    'LICENSE.md',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'dist/cjs/index.js',
    'dist/cjs/package.json',
    'dist/esm/index.js',
    'dist/types/index.d.ts',
    'docs/MIGRATION_V3.md',
    'docs/TYPEORM_FORK.md',
    'package.json',
  ]) {
    if (!(await pathExists(join(packageRoot, requiredPath)))) {
      throw new Error(`Installed package is missing ${requiredPath}`);
    }
  }
}

async function getInstalledVersion(packageName) {
  const packageJson = JSON.parse(
    await readFile(
      join(projectRoot, 'node_modules', packageName, 'package.json'),
      'utf8'
    )
  );
  return packageJson.version;
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function getScenarioDependencies() {
  const dependencies = {};

  if (scenario === 'combined' || scenario === 'postgres') {
    dependencies.pg = await getInstalledVersion('pg');
    dependencies['pg-query-stream'] =
      await getInstalledVersion('pg-query-stream');
  }
  if (scenario === 'combined' || scenario === 'oracle') {
    dependencies.oracledb = await getInstalledVersion('oracledb');
  }
  if (scenario === 'combined') {
    dependencies['@nestjs/common'] =
      await getInstalledVersion('@nestjs/common');
  } else if (scenario === 'nest10') {
    dependencies['@nestjs/common'] = '^10.4.16';
  } else if (scenario === 'nest11') {
    dependencies['@nestjs/common'] = '^11.0.16';
  }

  return dependencies;
}

function shouldImportNest() {
  return scenario === 'combined' || scenario.startsWith('nest');
}

function shouldLoadPostgres() {
  return scenario === 'combined' || scenario === 'postgres';
}

function shouldLoadOracle() {
  return scenario === 'combined' || scenario === 'oracle';
}

function expectedRuntimePeer(packageName) {
  if (packageName === 'pg') return shouldLoadPostgres();
  if (packageName === 'pg-query-stream') return shouldLoadPostgres();
  if (packageName === 'oracledb') return shouldLoadOracle();
  if (packageName === '@nestjs/common') return shouldImportNest();
  return false;
}

try {
  const { filename, tarballPath } = packProject();

  const consumerRoot = join(tempRoot, 'consumer');
  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: await getScenarioDependencies(),
        devDependencies: {
          '@types/node': await getInstalledVersion('@types/node'),
          typescript: await getInstalledVersion('typescript'),
        },
      },
      null,
      2
    )}\n`
  );
  const installArguments = [
    'install',
    tarballPath,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--logs-max=0',
    '--update-notifier=false',
    '--cache',
    join(tempRoot, 'npm-cache'),
  ];
  if (process.env.PROCEDURE_KIT_CONSUMER_OFFLINE === '1') {
    installArguments.push('--offline');
  }
  run('npm', installArguments, consumerRoot);

  const installedPackageJson = JSON.parse(
    await readFile(
      join(
        consumerRoot,
        'node_modules',
        'typeorm-procedure-kit',
        'package.json'
      ),
      'utf8'
    )
  );
  if (installedPackageJson.version !== sourcePackageJson.version) {
    throw new Error(
      `Expected package version ${sourcePackageJson.version}, received ${installedPackageJson.version}`
    );
  }
  if (installedPackageJson.private !== undefined) {
    throw new Error('Published package manifest must not contain private');
  }
  await validateInstalledPackage(
    join(consumerRoot, 'node_modules', 'typeorm-procedure-kit')
  );

  for (const runtimePeer of [
    'pg',
    'pg-query-stream',
    'oracledb',
    '@nestjs/common',
  ]) {
    const isInstalled = await pathExists(
      join(consumerRoot, 'node_modules', ...runtimePeer.split('/'))
    );
    if (isInstalled !== expectedRuntimePeer(runtimePeer)) {
      throw new Error(
        `${scenario} consumer ${
          isInstalled ? 'unexpectedly installed' : 'is missing'
        } runtime peer ${runtimePeer}`
      );
    }
  }

  const baseSubpaths = [
    'typeorm-procedure-kit',
    'typeorm-procedure-kit/typeorm',
    'typeorm-procedure-kit/typeorm-extend',
  ];
  for (const subpath of baseSubpaths) {
    run(
      'node',
      ['--input-type=module', '-e', `await import('${subpath}')`],
      consumerRoot
    );
    run('node', ['-e', `require('${subpath}')`], consumerRoot);
  }

  if (shouldImportNest()) {
    run(
      'node',
      [
        '--input-type=module',
        '-e',
        "await import('typeorm-procedure-kit/nestjs')",
      ],
      consumerRoot
    );
    run(
      'node',
      ['-e', "require('typeorm-procedure-kit/nestjs')"],
      consumerRoot
    );
  }

  if (shouldLoadPostgres()) {
    const esmPostgresSmoke = `
      const { DataSource } = await import('typeorm-procedure-kit/typeorm');
      const dataSource = new DataSource({ type: 'postgres' });
      if (dataSource.driver.postgres instanceof Promise) {
        throw new Error('PostgresDriver received a Promise instead of pg');
      }
      if (typeof dataSource.driver.postgres?.Pool !== 'function') {
        throw new Error('PostgresDriver did not receive the pg module');
      }
    `;
    const cjsPostgresSmoke = `
      const { DataSource } = require('typeorm-procedure-kit/typeorm');
      const dataSource = new DataSource({ type: 'postgres' });
      if (dataSource.driver.postgres instanceof Promise) {
        throw new Error('PostgresDriver received a Promise instead of pg');
      }
      if (typeof dataSource.driver.postgres?.Pool !== 'function') {
        throw new Error('PostgresDriver did not receive the pg module');
      }
    `;
    run('node', ['--input-type=module', '-e', esmPostgresSmoke], consumerRoot);
    run('node', ['-e', cjsPostgresSmoke], consumerRoot);

    const packageRoot = join(
      consumerRoot,
      'node_modules',
      'typeorm-procedure-kit'
    );
    const externalEsmEntry = join(tempRoot, 'external-postgres.mjs');
    const externalCjsEntry = join(tempRoot, 'external-postgres.cjs');
    await writeFile(
      externalEsmEntry,
      `const { DataSource } = await import(${JSON.stringify(
        join(packageRoot, 'dist/esm/typeorm/index.js')
      )});\nnew DataSource({ type: 'postgres' });\n`
    );
    await writeFile(
      externalCjsEntry,
      `const { DataSource } = require(${JSON.stringify(
        join(packageRoot, 'dist/cjs/typeorm/index.js')
      )});\nnew DataSource({ type: 'postgres' });\n`
    );
    run('node', [externalEsmEntry], tempRoot);
    run('node', [externalCjsEntry], tempRoot);
  }

  if (shouldLoadOracle()) {
    const esmOracleSmoke = `
      const { DataSource } = await import('typeorm-procedure-kit/typeorm');
      const dataSource = new DataSource({ type: 'oracle' });
      if (dataSource.driver.oracle instanceof Promise) {
        throw new Error('OracleDriver received a Promise instead of oracledb');
      }
      if (typeof dataSource.driver.oracle?.createPool !== 'function') {
        throw new Error('OracleDriver did not receive the oracledb module');
      }
    `;
    const cjsOracleSmoke = `
      const { DataSource } = require('typeorm-procedure-kit/typeorm');
      const dataSource = new DataSource({ type: 'oracle' });
      if (dataSource.driver.oracle instanceof Promise) {
        throw new Error('OracleDriver received a Promise instead of oracledb');
      }
      if (typeof dataSource.driver.oracle?.createPool !== 'function') {
        throw new Error('OracleDriver did not receive the oracledb module');
      }
    `;
    run('node', ['--input-type=module', '-e', esmOracleSmoke], consumerRoot);
    run('node', ['-e', cjsOracleSmoke], consumerRoot);
  }

  await writeFile(
    join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          skipLibCheck: false,
          types: ['node'],
          verbatimModuleSyntax: true,
        },
        include: ['consumer.ts', 'consumer.cts'],
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    join(consumerRoot, 'consumer.ts'),
    `import type {
  IModuleConfig,
  IProcedureResult,
  TSerializerInput,
} from 'typeorm-procedure-kit';
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { DataSource } from 'typeorm-procedure-kit/typeorm';

type ProcedureRow = { id: number };
type ProcedurePayload = { value: number };
type ProcedureOut = {
  outCursor: Array<ProcedureRow>;
  status: number;
};

export function callProcedure(
  kit: TypeOrmProcedureKit
): Promise<IProcedureResult<ProcedureRow, ProcedureOut>> {
  return kit.call<ProcedureRow, ProcedurePayload, ProcedureOut>(
    'pkg.run',
    { value: 1 }
  );
}

export function serializeDate(input: TSerializerInput<'DATE'>): string {
  return [
    input.serializerType,
    input.value instanceof Date ? input.value.toISOString() : input.value,
    input.context?.source ?? 'unknown',
  ].join(':');
}

export type ConsumerConfig = IModuleConfig;
export type ConsumerDataSource = DataSource;
${
  shouldImportNest()
    ? "export type { TCallProcedure } from 'typeorm-procedure-kit/nestjs';"
    : ''
}
`
  );
  await writeFile(
    join(consumerRoot, 'consumer.cts'),
    `import type {
  IModuleConfig,
  IProcedureResult,
} from 'typeorm-procedure-kit';
import type { DataSource } from 'typeorm-procedure-kit/typeorm';

const kitPackage: typeof import('typeorm-procedure-kit') = require('typeorm-procedure-kit');
const typeormPackage: typeof import('typeorm-procedure-kit/typeorm') = require('typeorm-procedure-kit/typeorm');

const TypeOrmProcedureKit = kitPackage.TypeOrmProcedureKit;
const BundledDataSource = typeormPackage.DataSource;
const acceptDeclarationTypes = (
  _config: IModuleConfig,
  _result: IProcedureResult<unknown>,
  _dataSource: DataSource
): void => {};

void [TypeOrmProcedureKit, BundledDataSource, acceptDeclarationTypes];
`
  );
  run(
    process.execPath,
    [
      join(consumerRoot, 'node_modules/typescript/bin/tsc'),
      '-p',
      'tsconfig.json',
      '--pretty',
      'false',
    ],
    consumerRoot
  );

  console.log(
    `Package consumer smoke passed for ${filename} (${scenario}): ESM, CJS, ESM/CJS strict TypeScript declarations, direct driver construction, peer isolation, README, and tarball hygiene.`
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
