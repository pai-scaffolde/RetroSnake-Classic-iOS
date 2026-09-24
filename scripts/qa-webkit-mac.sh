#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
qa_root="$(mktemp -d /private/tmp/retrosnake-webkit-qa.XXXXXX)"
app_root="$qa_root/RetroSnakeWebKitHarness.app/Contents"
mkdir -p "$app_root/MacOS" "$app_root/Resources"
cat > "$app_root/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>ai.scaffolde.retrosnake.harness</string>
  <key>CFBundleName</key><string>RetroSnakeWebKitHarness</string>
  <key>CFBundleExecutable</key><string>probe</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST
ln -s "$project_root/ios/RetroSnakeClassic/GameAssets" "$app_root/Resources/GameAssets"
cp "$project_root/scripts/qa-webkit-mac.swift" "$qa_root/main.swift"
swiftc -o "$app_root/MacOS/probe" "$qa_root/main.swift" \
  "$project_root/ios/RetroSnakeClassic/GameAssetSchemeHandler.swift"
"$app_root/MacOS/probe"
