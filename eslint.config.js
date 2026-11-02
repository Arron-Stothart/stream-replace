import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/', 'node_modules/']
  },
  { files: ['test/**/*.mjs'], languageOptions: { globals: { ReadableStream: 'readonly' } } },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['../*'] }],
    },
  },
];

