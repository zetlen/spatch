import { defineConfig } from 'oxlint';

export default defineConfig({
  categories: {
    correctness: 'error',
    perf: 'error',
    style: 'error',
    suspicious: 'error',
  },
  env: {
    builtin: true,
  },
  globals: {},
  ignorePatterns: ['dist', '*.md'],
  plugins: undefined,
  rules: {
    'func-names': 'off',
    'func-style': 'off',
    'id-length': 'off',
    'init-declarations': 'off',
    'max-params': 'off',
    'max-statements': 'off',
    'no-await-in-loop': 'off',
    'no-continue': 'off',
    'no-magic-numbers': 'off',
    'no-nested-ternary': 'off',
    'no-ternary': 'off',
    'no-use-before-define': ['error', { functions: false }],
    'prefer-destructuring': 'off',
    'prefer-for-of': 'off',
    'prefer-template': 'off',
    'prefer-ternary': 'off',
    'sort-imports': 'off',
    'sort-keys': 'off',
    'unicorn/no-nested-ternary': 'off',
  },
});
