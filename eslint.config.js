import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.api-check/**',
      '.test-check/**',
      '.tmp/**',
      'coverage/**',
      'deliveries/**',
      'outputs/**',
      'notion-audit/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    rules: {
      // Existing security validation deliberately uses control-character
      // expressions, while several older modules retain intentional empty
      // catches and non-breaking UI spacing. Keep these visible without
      // blocking adoption of the new lint command.
      'no-control-regex': 'warn',
      'no-empty': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  prettierConfig,
);
