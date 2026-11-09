// Lint: catches the mistakes refactors cause (undefined / unused identifiers) without restyling the code.
import globals from 'globals';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

// innerHTML / insertAdjacentHTML / document.write: a value must go through one of these. The escapers make text safe; the
// sanitizers clean untrusted HTML (model output, saved pages, backups); T/TN (our translation files), icon/emojiHtml/modelIcon
// (our own SVG and emoji markup) never carry page content. Anything else needs a reviewed `-- reason` disable comment.
const SAFE_HTML = { escape: { methods: ['escapeHtml', 'esc', 'escAttr', 'hlpEsc', 'sanitizeHtml', 'cleanUntrustedHtml', 'markdownToHtml', 'T', 'TN', 'icon', 'emojiHtml', 'modelIcon'] } };
export default [
  { ignores: ['node_modules/**', 'plugin/dev/**', 'plugin/dist/**', 'plugin/prod/**', 'plugin/src/lib/**', 'docs/**', 'site-src/**', 'plugin/tests/**', 'plugin/platforms/**'] },
  {
    files: ['plugin/src/**/*.js', 'plugin/scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker, ...globals.node, chrome: 'readonly', browser: 'readonly', d3: 'readonly', AishAudio: 'readonly', AishBuiltin: 'readonly' } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['plugin/src/**/*.js'],
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      'no-unsanitized/property': ['error', SAFE_HTML],
      'no-unsanitized/method': ['error', SAFE_HTML],
    },
  },
];
