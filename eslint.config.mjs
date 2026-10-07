// Lint: catches the mistakes refactors cause (undefined / unused identifiers) without restyling the code.
import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'plugin/dev/**', 'plugin/dist/**', 'plugin/prod/**', 'plugin/src/lib/**', 'docs/**', 'site-src/**', 'plugin/tests/**', 'plugin/platforms/**'] },
  {
    files: ['plugin/src/**/*.js', 'plugin/scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker, ...globals.node, chrome: 'readonly', browser: 'readonly', d3: 'readonly', AishAudio: 'readonly' } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
