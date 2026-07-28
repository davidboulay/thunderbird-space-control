#!/usr/bin/env bash
# Build space-control@davidboulay.xpi.
#
# First install MUST go through the Add-ons Manager (gear -> Install Add-on From
# File). Dropping the XPI into the profile's extensions/ directory looks like it
# works, but Thunderbird treats it as a side-load: it re-applies
# extensions.autoDisableScopes on every start and keeps switching the add-on
# back off, leaving a half-registered entry with no options panel.
#
# --update copies over an already-properly-installed copy, which is fine.
set -euo pipefail

cd "$(dirname "$0")"

ID="space-control@davidboulay"
XPI="dist/$ID.xpi"

# Where the add-on is installed. Override for a different profile or a plain
# Thunderbird install:  PROFILE=/path/to/profile ./build.sh --update
find_profile() {
  if [[ -n "${PROFILE:-}" ]]; then
    printf '%s' "$PROFILE"
    return
  fi
  local root
  for root in "$HOME/.var/app/eu.betterbird.Betterbird/.thunderbird" \
              "$HOME/.thunderbird" \
              "$HOME/.var/app/org.mozilla.Thunderbird/.thunderbird"; do
    [[ -d "$root" ]] || continue
    # The add-on lives in whichever profile already has it.
    local candidate
    for candidate in "$root"/*/extensions/"$ID".xpi; do
      [[ -f "$candidate" ]] && printf '%s' "${candidate%/extensions/*}" && return
    done
  done
}

mkdir -p dist
rm -f "$XPI"
zip -qr -FS "$XPI" manifest.json background.js api options icons -x '*/.*'
echo "built $(pwd)/$XPI"

if [[ "${1:-}" == "--update" ]]; then
  profile="$(find_profile)"
  if [[ -z "$profile" ]]; then
    echo "no profile with $ID installed - use Install Add-on From File first" >&2
    exit 1
  fi
  cp "$XPI" "$profile/extensions/$ID.xpi"
  echo "replaced the copy in $profile"
  echo "restart Thunderbird to pick it up"
else
  echo
  echo "To install: Betterbird -> Add-ons and Themes -> gear -> Install Add-on"
  echo "From File, and pick the file above. The options panel opens by itself."
fi
