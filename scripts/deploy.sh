#!/usr/bin/env bash
# Copy SmartHomeDash to a Home Assistant host over SSH.
#
#   scripts/deploy.sh user@homeassistant.local               the integration only
#   scripts/deploy.sh user@homeassistant.local home          plus any new files of a site
#   scripts/deploy.sh user@homeassistant.local home --site   and overwrite its site.json
#
# - The integration goes to <config>/custom_components/smarthomedash (replaced).
# - The site goes to <config>/smarthomedash/sites/<site>. Existing files are kept,
#   so a site.json saved from the dashboard's placement mode is not overwritten,
#   unless --site is given (the old one is kept as site.json.bak).
# - Works with SSH add-ons that lack SFTP; uses sudo when the SSH user is not root.
#   Set CONFIG_DIR if your add-on mounts the config elsewhere (e.g. /homeassistant).
set -euo pipefail

HOST=${1:?usage: deploy.sh user@host [site [--site]]}
SITE=${2:-}
FORCE_SITE=${3:-}
CONFIG=${CONFIG_DIR:-/config}
cd "$(dirname "$0")/.."

PARTS=(custom_components/smarthomedash)
if [ -n "$SITE" ]; then
  [ -f "sites/$SITE/site.json" ] || { echo "sites/$SITE/site.json not found" >&2; exit 1; }
  PARTS+=("sites/$SITE")
fi

tar --exclude '__pycache__' -czf - "${PARTS[@]}" | ssh "$HOST" "
  set -e
  SUDO=''; [ \"\$(id -u)\" = 0 ] || SUDO=sudo
  TMP=\$(mktemp -d)
  tar -C \"\$TMP\" -xzf -
  \$SUDO mkdir -p '$CONFIG/custom_components'
  \$SUDO rm -rf '$CONFIG/custom_components/smarthomedash'
  \$SUDO cp -r \"\$TMP/custom_components/smarthomedash\" '$CONFIG/custom_components/'
  if [ -z '$SITE' ]; then
    :
  elif [ '$FORCE_SITE' = '--site' ] && [ -f '$CONFIG/smarthomedash/sites/$SITE/site.json' ]; then
    \$SUDO cp '$CONFIG/smarthomedash/sites/$SITE/site.json' '$CONFIG/smarthomedash/sites/$SITE/site.json.bak'
    \$SUDO cp -r \"\$TMP/sites/$SITE/.\" '$CONFIG/smarthomedash/sites/$SITE/'
  else
    \$SUDO mkdir -p '$CONFIG/smarthomedash/sites/$SITE'
    # add files that are missing, keep everything already there
    (cd \"\$TMP/sites/$SITE\" && find . -type f) | while read -r f; do
      [ -e '$CONFIG/smarthomedash/sites/$SITE/'\"\$f\" ] || \$SUDO cp \"\$TMP/sites/$SITE/\$f\" '$CONFIG/smarthomedash/sites/$SITE/'\"\$f\"
    done
  fi
  rm -rf \"\$TMP\"
  echo 'Installed. Restart Home Assistant if this is the first install or the integration code changed.'
"
