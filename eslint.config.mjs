//@ts-check
import eslintJs from '@eslint/js';
import importPlugin from 'eslint-plugin-import-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ownedFiles = ['src/**/*.ts'];
const typeormFiles = ['src/typeorm/**/*.ts'];
const testFiles = ['test/**/*.ts', 'vitest.config.ts'];
const typeormIgnores = ['src/typeorm/**/*.ts'];

function scopeConfigs(configs, files, ignores = []) {
  return configs.map((config) => ({
    ...config,
    files,
    ignores: [...(config.ignores ?? []), ...ignores],
  }));
}

const importRules = {
  'import-x/consistent-type-specifier-style': ['error', 'prefer-top-level'],
  'import-x/first': 'error',
  'import-x/newline-after-import': 'error',
  'import-x/no-cycle': ['error', { ignoreExternal: true, maxDepth: 1 }],
  'import-x/no-duplicates': 'error',
  'import-x/no-extraneous-dependencies': [
    'error',
    { packageDir: import.meta.dirname },
  ],
  'import-x/no-mutable-exports': 'error',
  'import-x/no-unresolved': 'error',
  'import-x/order': [
    'error',
    {
      groups: [
        'builtin',
        'external',
        'internal',
        'parent',
        'sibling',
        'index',
        'type',
      ],
      'newlines-between': 'always',
      alphabetize: { order: 'asc', caseInsensitive: true },
    },
  ],
};

const namingConventionRule = [
  'error',
  {
    selector: ['variable', 'parameter'],
    types: ['boolean'],
    format: ['PascalCase'],
    prefix: ['is', 'has', 'can', 'should', 'was', 'will'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'variable',
    modifiers: ['destructured'],
    format: null,
  },
  {
    selector: 'interface',
    format: ['PascalCase'],
    custom: { regex: '^I[A-Z]', match: true },
  },
  {
    selector: 'typeAlias',
    format: ['PascalCase'],
    custom: { regex: '^T[A-Z]', match: true },
  },
  {
    selector: 'enum',
    format: ['PascalCase'],
    custom: { regex: '^E[A-Z]', match: true },
  },
  {
    selector: 'enumMember',
    format: ['PascalCase'],
  },
  {
    selector: 'class',
    format: ['PascalCase'],
  },
  {
    selector: 'function',
    filter: { regex: '^Api[A-Z]', match: true },
    format: ['PascalCase'],
  },
  {
    selector: 'function',
    format: ['camelCase'],
  },
  {
    selector: 'accessor',
    format: ['camelCase'],
  },
  {
    selector: 'parameter',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'parameterProperty',
    format: ['camelCase'],
  },
  {
    selector: 'variable',
    modifiers: ['const'],
    filter: {
      regex: '^(IdempotencyKey|RateLimit)$',
      match: true,
    },
    format: ['PascalCase'],
  },
  {
    selector: 'variable',
    modifiers: ['const'],
    format: ['camelCase', 'UPPER_CASE'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'variable',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'classProperty',
    modifiers: ['static'],
    format: ['camelCase', 'UPPER_CASE'],
  },
  {
    selector: 'classProperty',
    format: ['camelCase'],
  },
  {
    selector: 'import',
    format: ['camelCase', 'PascalCase'],
  },
];

const compatibilityRules = {
  '@typescript-eslint/array-type': ['error', { default: 'generic' }],
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
  ],
  '@typescript-eslint/explicit-function-return-type': 'error',
  '@typescript-eslint/explicit-member-accessibility': 'error',
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': [
    'error',
    { checksVoidReturn: false },
  ],
  '@typescript-eslint/no-require-imports': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  '@typescript-eslint/prefer-nullish-coalescing': 'off',
  ...importRules,
};

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    'logs/**',
    'eslint.config.mjs',
    'package-lock.json',
  ]),

  ...scopeConfigs(
    [
      eslintJs.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      eslintPluginPrettierRecommended,
    ],
    ownedFiles,
    typeormIgnores
  ),

  ...scopeConfigs(
    [
      eslintJs.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      eslintPluginPrettierRecommended,
    ],
    typeormFiles
  ),

  ...scopeConfigs(
    [
      eslintJs.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      eslintPluginPrettierRecommended,
    ],
    testFiles
  ),

  {
    files: [...ownedFiles, ...typeormFiles, ...testFiles],
    plugins: {
      'import-x': importPlugin,
      '@typescript-eslint': tseslint.plugin,
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['./tsconfig.json', './tsconfig.test.json'],
        },
      },
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ownedFiles,
    ignores: typeormIgnores,
    rules: {
      ...compatibilityRules,
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/naming-convention': namingConventionRule,
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-extraneous-class': [
        'error',
        { allowWithDecorator: true },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: false,
          allowAny: false,
          allowNullish: true,
        },
      ],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: true,
          allowNumber: true,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: true,
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: typeormFiles,
    rules: {
      // TODO: Bring vendored TypeORM up to the OWNED lint profile while
      // preserving its upstream-compatible public and runtime contracts.
      ...compatibilityRules,
      'no-console': 'warn',
    },
  },

  {
    files: testFiles,
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TODO: Bring tests up to the OWNED lint profile as fixtures and mocks
      // are migrated to the same strict type-safety requirements.
      ...importRules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false },
      ],
      '@typescript-eslint/naming-convention': namingConventionRule,
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      'no-console': 'off',
    },
  },

  {
    files: [...ownedFiles, ...typeormFiles, ...testFiles],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Decorator > Identifier:not([name=/^[A-Z][A-Za-z0-9]*$/])',
          message: 'Decorator names must use PascalCase.',
        },
        {
          selector:
            'Decorator > CallExpression > Identifier.callee:not([name=/^[A-Z][A-Za-z0-9]*$/])',
          message: 'Decorator names must use PascalCase.',
        },
      ],
    },
  },

  {
    files: [
      'src/**/decorator/**/*.ts',
      'src/**/decorators/**/*.ts',
      'src/**/*.decorator.ts',
    ],
    ignores: typeormIgnores,
    rules: {
      '@typescript-eslint/naming-convention': [
        ...namingConventionRule,
        {
          selector: 'function',
          modifiers: ['exported'],
          format: ['PascalCase'],
        },
        {
          selector: 'variable',
          modifiers: ['exported', 'const'],
          types: ['function'],
          format: ['PascalCase'],
        },
      ],
    },
  },

  {
    files: ['src/index.ts'],
    rules: {
      'import-x/no-mutable-exports': 'off',
    },
  },

  {
    files: ownedFiles,
    ignores: [
      ...typeormIgnores,
      '**/*.d.ts',
      'src/interfaces/**/*.ts',
      'src/types/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSInterfaceDeclaration',
          message: 'Move interfaces to src/interfaces/*.interfaces.ts.',
        },
        {
          selector: 'TSTypeAliasDeclaration',
          message: 'Move type aliases to src/types/*.types.ts.',
        },
      ],
    },
  },

  {
    files: ['src/interfaces/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeAliasDeclaration',
          message: 'Type aliases belong in src/types/*.types.ts.',
        },
      ],
    },
  },

  {
    files: ['src/types/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSInterfaceDeclaration',
          message: 'Interfaces belong in src/interfaces/*.interfaces.ts.',
        },
      ],
    },
  }
);
