#!/usr/bin/env bash
# Runs every check: syntax, the backend tests and the browser tests.
# Needs Python 3.12+, Node 20+ and Playwright with Chromium:
#   npm install --no-save playwright axe-core && npx playwright install chromium
# Two more parts run when their tools are installed, and are named if they are not:
#   lint     ruff (pip install ruff) and eslint (add `eslint globals` to the npm install
#            above: a later --no-save install removes the earlier one's packages)
#   webkit   a short run in WebKit, the engine of Safari (npx playwright install webkit)
# Run one part with:  tests/run.sh backend | browser | lint | webkit
# A part asked for by name fails if its tools are missing.
set -euo pipefail
cd "$(dirname "$0")/.."
part="${1:-all}"

if [[ "$part" == all || "$part" == backend ]]; then
  echo "== Syntax"
  python3 -m py_compile custom_components/planview_dash/*.py
  # The dashboard is ES modules. A plain `node --check` on a .js file can pass a module
  # with a syntax error, so read each one as a module.
  for f in $(find custom_components/planview_dash/frontend -name '*.js'); do
    node --input-type=module --check < "$f" || { echo "Syntax error in $f"; exit 1; }
  done
  for f in tests/browser/*.js tests/webkit/*.js tests/fixtures/*.js; do node --check "$f"; done
  for f in $(git ls-files '*.json'); do python3 -m json.tool "$f" >/dev/null || { echo "Invalid JSON: $f"; exit 1; }; done
  echo "== Backend tests"
  python3 -m unittest discover -s tests/backend -t tests/backend
fi

# Whether an optional part runs: always when asked for by name, otherwise only
# when its tools are there.
optional() {  # optional <part> <what is missing, or empty>
  [[ "$part" == all || "$part" == "$1" ]] || return 1
  [[ -z "$2" ]] && return 0
  if [[ "$part" == "$1" ]]; then echo "$1: $2"; exit 1; fi
  echo "== Skipped $1: $2"
  return 1
}

missing=""
command -v ruff >/dev/null || missing="ruff is not installed (pip install ruff)"
[[ -x node_modules/.bin/eslint ]] || missing="${missing:+$missing; }eslint is not installed (npm install --no-save axe-core eslint globals)"
if optional lint "$missing"; then
  echo "== Lint"
  ruff check .
  node_modules/.bin/eslint .
fi

if [[ "$part" == all || "$part" == browser ]]; then
  echo "== Browser tests"
  # The performance budget runs last and on its own: run beside the other test files,
  # its timings would measure the competition for the CPU, not the dashboard.
  node --test $(ls tests/browser/*.test.js | grep -v '/perf\.test\.js$')
  node --test tests/browser/perf.test.js
fi
missing=""
node -e "process.exit(require('fs').existsSync(require('playwright').webkit.executablePath()) ? 0 : 1)" 2>/dev/null \
  || missing="WebKit is not installed (npx playwright install webkit)"
if optional webkit "$missing"; then
  echo "== WebKit"
  node --test tests/webkit/*.test.js
fi
echo "All tests passed."
