#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
bash "$project_root/scripts/build-game-assets.sh"
cd "$project_root/ios"
xcodegen generate --spec project.yml
