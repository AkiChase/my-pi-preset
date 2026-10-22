#!/bin/sh
# Bootstrap the interactive Node installer. Reconciliation belongs to sync.mjs.
# Usage: curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-preset/main/install.sh | sh
set -eu

RAW="https://raw.githubusercontent.com/AkiChase/my-pi-preset/main"
log() { printf '[install] %s\n' "$*"; }
die() { printf '[install] %s\n' "$*" >&2; exit 1; }

[ "$#" -eq 0 ] || die "This installer is interactive and takes no arguments. Run ./install.sh or curl | sh."
# Never consume the shell source pipe as keyboard input.
if ! ( : < /dev/tty > /dev/tty ) 2>/dev/null; then
  die "Interactive installation needs a terminal. Run this command in an interactive shell."
fi
command -v node >/dev/null 2>&1 || die "'node' is not on PATH."
command -v curl >/dev/null 2>&1 || die "'curl' is not on PATH."

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P) || script_dir=""
local_checkout=false
if [ -f "$0" ] && [ -n "$script_dir" ] && [ -f "$script_dir/scripts/install.mjs" ] && [ -f "$script_dir/scripts/sync.mjs" ] && [ -f "$script_dir/pi-preset.json" ]; then
  local_checkout=true
fi

PI_BIN="${PI_BIN:-}"
if [ -z "$PI_BIN" ]; then
  agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  if [ -x "$agent_dir/bin/pi" ]; then
    PI_BIN="$agent_dir/bin/pi"
  elif command -v pi >/dev/null 2>&1; then
    PI_BIN=$(command -v pi)
  else
    die "'pi' is not on PATH. Install Pi first: https://pi.dev"
  fi
fi
PI_BIN_DIR=$(dirname -- "$PI_BIN")
PATH="$PI_BIN_DIR:$PATH"
export PATH PI_BIN
log "using pi at $PI_BIN"

cleanup=""
cleanup_run() { if [ -n "$cleanup" ]; then rm -rf "$cleanup"; fi; }
trap cleanup_run EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$local_checkout" = true ]; then
  manifest="$script_dir/pi-preset.json"
  installer="$script_dir/scripts/install.mjs"
else
  cleanup=$(mktemp -d)
  # macOS temporary roots can be symlinked; Node resolves module URLs physically.
  cleanup=$(CDPATH= cd -- "$cleanup" && pwd -P)
  manifest="$cleanup/pi-preset.json"
  installer="$cleanup/install.mjs"
  log "downloading installer and preset"
  curl -fsSL "$RAW/pi-preset.json" -o "$manifest" || die "could not download pi-preset.json"
  curl -fsSL "$RAW/scripts/sync.mjs" -o "$cleanup/sync.mjs" || die "could not download scripts/sync.mjs"
  curl -fsSL "$RAW/scripts/install.mjs" -o "$installer" || die "could not download scripts/install.mjs"
fi

node "$installer" --manifest "$manifest" < /dev/tty > /dev/tty 2>&1
