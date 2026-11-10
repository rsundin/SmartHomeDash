#!/usr/bin/env bash
# Runs every check: syntax, the backend tests and the browser tests.
# Needs Python 3.12+, Node 20+ and Playwright with Chromium:
#   npm install --no-save playwright && npx playwright install chromium
# Run one part with:  tests/run.sh backend   or   tests/run.sh browser
set -euo pipefail
cd "$(dirname "$0")/.."
part="${1:-all}"

if [[ "$part" == all || "$part" == backend ]]; then
  echo "== Syntax"
  python3 -m py_compile custom_components/smarthomedash/*.py
  # The dashboard is ES modules. A plain `node --check` on a .js file can pass a module
  # with a syntax error, so read each one as a module.
  for f in $(find custom_components/smarthomedash/frontend -name '*.js'); do
    node --input-type=module --check < "$f" || { echo "Syntax error in $f"; exit 1; }
  done
  for f in tests/browser/*.js tests/fixtures/*.js; do node --check "$f"; done
  for f in $(git ls-files '*.json'); do python3 -m json.tool "$f" >/dev/null || { echo "Invalid JSON: $f"; exit 1; }; done
  echo "== Backend tests"
  python3 -m unittest discover -s tests/backend -t tests/backend
fi

if [[ "$part" == all || "$part" == browser ]]; then
  echo "== Browser tests"
  # The performance budget runs last and on its own: run beside the other test files,
  # its timings would measure the competition for the CPU, not the dashboard.
  node --test $(ls tests/browser/*.test.js | grep -v '/perf\.test\.js$')
  node --test tests/browser/perf.test.js
fi
echo "All tests passed."
