import stylistic from '@stylistic/eslint-plugin'

export default [
  {
    files: ['**/*.js'],
    plugins: { '@stylistic': stylistic },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { browser: 'readonly', location: 'readonly', fetch: 'readonly', crypto: 'readonly', document: 'readonly', window: 'readonly', navigator: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Headers: 'readonly', Response: 'readonly', Request: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly', TextEncoder: 'readonly', globalThis: 'readonly', process: 'readonly' }
    },
    rules: {
      '@stylistic/indent': ['error', 2],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'never'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error'
    }
  },
  { ignores: ['src/vendor/**', 'dist/**', 'node_modules/**'] }
]
