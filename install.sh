#!/bin/sh
# Install my pi packages on a new machine. Safe to re-run.
# Usage: curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-extensions/main/install.sh | sh
set -eu

# My own extensions (this repo)
pi install git:github.com/AkiChase/my-pi-extensions

# Third-party packages
pi install npm:pi-session-name
