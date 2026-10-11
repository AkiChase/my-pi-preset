#!/bin/sh
# Set up my pi packages on a machine. Safe to re-run.
#
# The packages are declared in pi-packages.json; this script only bootstraps
# and then hands over to scripts/sync.mjs, which reconciles the machine with
# the manifest by calling `pi install` / `pi update` / `pi remove`.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-extensions/main/install.sh | sh
#   ./install.sh --dry-run
#   ./install.sh --prune
#
# Options are passed through to sync.mjs: --dry-run, --prune.
set -eu

REPO="AkiChase/my-pi-extensions"
RAW="https://raw.githubusercontent.com/${REPO}/main"

log() {
  printf '\033[2m[install]\033[0m %s\n' "$*"
}

die() {
  printf '\033[31m[install]\033[0m %s\n' "$*" >&2
  exit 1
}

log "checking required commands"
command -v node >/dev/null 2>&1 || die "'node' is not on PATH; it is required to run the sync script."
command -v curl >/dev/null 2>&1 || die "'curl' is not on PATH."

# A terminal app's launcher can shadow pi on PATH. Prefer the managed install so
# this script drives the real pi, and pass the choice down to sync.mjs.
PI_BIN="${PI_BIN:-}"
if [ -z "$PI_BIN" ]; then
  agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  if [ -x "$agent_dir/bin/pi" ]; then
    PI_BIN="$agent_dir/bin/pi"
  elif command -v pi >/dev/null 2>&1; then
    PI_BIN=$(command -v pi)
  else
    die "'pi' is not on PATH. Install pi first: https://pi.dev"
  fi
fi
PI_BIN_DIR=$(dirname -- "$PI_BIN")
PATH="$PI_BIN_DIR:$PATH"
export PATH PI_BIN
log "using pi at $PI_BIN"
log "pi $("$PI_BIN" --version 2>/dev/null || echo '?'), node $(node --version)"

# Work from the local checkout when this script sits in one, otherwise fetch
# the two files it needs (the piped `curl | sh` case).
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || script_dir=""
if [ -n "$script_dir" ] && [ -f "$script_dir/scripts/sync.mjs" ] && [ -f "$script_dir/pi-packages.json" ]; then
  log "using local checkout at $script_dir"
  manifest="$script_dir/pi-packages.json"
  sync_script="$script_dir/scripts/sync.mjs"
  cleanup=""
else
  tmp_dir=$(mktemp -d)
  cleanup="$tmp_dir"
  manifest="$tmp_dir/pi-packages.json"
  sync_script="$tmp_dir/sync.mjs"
  log "downloading pi-packages.json and scripts/sync.mjs from $RAW"
  curl -fsSL "$RAW/pi-packages.json" -o "$manifest" || die "could not download pi-packages.json"
  curl -fsSL "$RAW/scripts/sync.mjs" -o "$sync_script" || die "could not download scripts/sync.mjs"
  log "downloaded to $tmp_dir"
fi

if [ -n "$cleanup" ]; then
  trap 'rm -rf "$cleanup"' EXIT INT TERM
fi

log "handing over to sync.mjs (it prints its own progress from here)"
echo
node "$sync_script" --manifest "$manifest" "$@"
