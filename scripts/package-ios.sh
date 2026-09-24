#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$project_root/web"
bun run build
mkdir -p "$project_root/ios/RetroSnakeClassic/GameAssets"
rsync -a --delete "$project_root/web/dist/" "$project_root/ios/RetroSnakeClassic/GameAssets/"
cd "$project_root/ios"
xcodegen generate --spec project.yml
