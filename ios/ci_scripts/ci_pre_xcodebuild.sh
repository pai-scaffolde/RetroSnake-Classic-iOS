#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/../.." && pwd -P)"

if ! command -v bun >/dev/null 2>&1; then
  brew install bun
fi

cd "$project_root/web"
bun install --frozen-lockfile
bash "$project_root/scripts/build-game-assets.sh"
