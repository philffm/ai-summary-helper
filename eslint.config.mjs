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
  // R2: storage goes through StorageManager (key routing local/sync, migrations, one place to change the schema).
  // A warning for now, to be cleared module by module; the storage layer itself and the classic scripts are exempt.
  {
    files: ['plugin/src/**/*.js'],
    ignores: ['plugin/src/modules/storageManager.js', 'plugin/src/modules/storageKeys.js', 'plugin/src/loader.js', 'plugin/src/background.js'],
    rules: {
      'no-restricted-syntax': ['warn', {
        selector: "MemberExpression[object.object.object.name=/^(chrome|browser)$/][object.object.property.name='storage'][object.property.name=/^(local|sync|session)$/][property.name=/^(get|set|remove|clear)$/]",
        message: 'Read and write storage through StorageManager (modules/storageManager.js), not chrome.storage directly.',
      }],
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
