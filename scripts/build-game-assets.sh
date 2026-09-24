#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$project_root/web"
bun run build

game_assets="$project_root/ios/RetroSnakeClassic/GameAssets"
mkdir -p "$game_assets"
rsync -a --delete "$project_root/web/dist/" "$game_assets/"
test -s "$game_assets/index.html"
test -s "$game_assets/assets/manifest.json"
