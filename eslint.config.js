// Lint for the JavaScript: `npx eslint .` (tests/run.sh lint, and the Lint job in CI).
// Only rules that find mistakes (undefined and unused names, unreachable code, wrong
// comparisons); none about layout. Nothing here is needed to run the dashboard.
const globals = require('globals');

const mistakes = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-const-assign': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-cond-assign': 'error',
  'no-constant-binary-expression': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unsafe-negation': 'error',
  'no-loss-of-precision': 'error',
  'no-import-assign': 'error',
  'no-func-assign': 'error',
  'no-redeclare': 'error',
  'no-shadow-restricted-names': 'error',
  'no-sparse-arrays': 'error',
  'no-template-curly-in-string': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'getter-return': 'error',
  'for-direction': 'error',
  'no-async-promise-executor': 'error',
  'no-unused-private-class-members': 'error',
  'no-useless-assignment': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  // The security rule in CLAUDE.md: no markup built from data.
  'no-restricted-properties': ['error',
    { property: 'innerHTML', message: 'Build elements with el() / sv() instead (no markup from data).' },
    { property: 'outerHTML', message: 'Build elements with el() / sv() instead (no markup from data).' },
    { property: 'insertAdjacentHTML', message: 'Build elements with el() / sv() instead (no markup from data).' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
};

module.exports = [
  { ignores: ['node_modules/**', '.venv*/**'] },
  // The dashboard: ES modules in the browser.
  {
    files: ['custom_components/smarthomedash/frontend/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    rules: mistakes,
  },
  // The browser tests and their fixtures: CommonJS under Node, with code handed to the page.
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: mistakes,
  },
];
