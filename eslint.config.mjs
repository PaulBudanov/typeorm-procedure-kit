//@ts-check
import eslintJs from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import {
  plugin as tsEslintPlugin,
  configs as tsEslintConfigs,
} from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';
export default defineConfig(
  globalIgnores([
    'dist/',
    'node_modules/',
    'eslint.config.mjs',
    'package-lock.json',
  ]),

  // Base recommended eslint
  eslintJs.configs.recommended,

  ...tsEslintConfigs.recommended,
  ...tsEslintConfigs.stylistic,

  eslintPluginPrettierRecommended,

  {
    plugins: {
      // @ts-ignore
      'import-x': importPlugin,
      '@typescript-eslint': tsEslintPlugin,
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: './tsconfig.json',
          alwaysTryTypes: true,
        },
        node: {
          moduleDirectory: ['node_modules', '../node_modules'],
        },
      },
    },
    rules: {
      'import-x/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
    },
  },
  // Common language options
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        cacheLifetime: {
          glob: 5_000,
        },
      },
    },
  },

  // TypeScript options
  {
    rules: {
      // --- TypeScript ---
      '@typescript-eslint/no-explicit-any': 'error',

      // Banned all no misused promises
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: false, // allow async in void-context, if exists  try/catch
        },
      ],

      //
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Warning about explicit types
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'error',

      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit' },
      ],

      '@typescript-eslint/array-type': [
        'error',
        {
          default: 'generic',
        },
      ],

      // Block `require()` in TypeScript
      '@typescript-eslint/no-require-imports': 'error',

      // Disallows unused variables (but allows `_` as a prefix)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // --- Best Practices ---

      // Prevents direct use of `Object.prototype` methods
      'no-prototype-builtins': 'warn',

      // Запрещает пустые блоки
      'no-empty': 'error',

      // --- Node.js / Import ---
      'import-x/no-unresolved': 'error',
      'import-x/named': 'error',

      'no-console': 'warn',
    },
  },

  // Optionally: disable some rules for tests
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
    },
  }
);
