# RetroSnake Classic for iPhone

A separate, offline iPhone app built from RetroSnake's original TypeScript 3D game source. It opens directly in the 2001 voxel arena with the overhead Classic camera. A loss shows the score and a **Play Again** button; another run begins in the same voxel world. Touch swipes steer, and the native shell adds light haptic feedback. The website game is a separate project and is not built or modified here.

## Project layout

- `web/` — editable Three.js game source, copied from the local RetroSnake source archive and specialized for this app.
- `web/public/assets/` — self-contained game assets copied from the RetroSnake website checkout on 2026-09-24.
- `ios/` — XcodeGen specification and SwiftUI/WebKit iPhone target.
- `ios/RetroSnakeClassic/GameAssets/` — generated offline web bundle. Regenerate with the packaging script.
- `design/AppIcon.svg` — editable app icon source.
- `store/` — draft listing and privacy text for review before publishing.

## Build

Requires Bun, XcodeGen, and full Xcode with an iOS SDK. On this Mac, Bun and XcodeGen are available; full Xcode is still missing.

```sh
cd '/Users/gary/Projects/RetroSnake Classic iOS'
cd web && bun install --frozen-lockfile && cd ..
bash scripts/package-ios.sh
open ios/RetroSnakeClassic.xcodeproj
```

In Xcode, sign in with the Apple developer account associated with `garynoonan@me.com`, select its team under **Signing & Capabilities**, and verify the provisional bundle ID `ai.scaffolde.retrosnakeclassic` is available for that team. Do this before the first App Store Connect upload; Apple does not allow changing the bundle ID of an uploaded app record. The email is an account hint, not a signing credential or proof of team membership.

The app target supports iPhone portrait on iOS 17 or later. Its custom `retrosnake://app/` scheme serves the entire game from the app bundle. It requests no network entitlements and rejects navigation outside that local origin. Scores and settings use local web storage.

## Checks run on 2026-09-24

- `bun run test`: 49 game tests passed.
- `bun run build`: TypeScript and Vite production build passed.
- `bun scripts/qa-mobile.mjs`: mobile WebKit browser displayed the voxel arena, reached Game Over, and started another voxel run with no page errors.
- A macOS WKWebView harness loaded the packaged game through the same custom URL scheme and found the arena without script errors.
- `xcodegen generate`, `plutil -lint`, Swift syntax parse, and a macOS typecheck of the scheme handler passed.
- Every path in the asset manifest exists in the packaged game directory.

These checks do not prove an iPhone build, on-device graphics/audio/haptics, code signing, TestFlight, or App Store acceptance. Those are the next gates after full Xcode is installed.

## App Store route

1. Build and play on a real iPhone. Check launch, WebGL rendering, swipes, camera, pause, Game Over, retry, haptics, audio, airplane mode, and returning from the background.
2. Capture actual iPhone screenshots and finalize the store name, description, category, age rating, support URL, and public privacy policy URL. Review the drafts in `store/`.
3. Create a distinct iOS app record in App Store Connect under the verified team and matching bundle ID.
4. Archive and upload with Xcode, test through TestFlight, then submit the reviewed build and metadata to App Review.

Apple's [distribution preparation](https://developer.apple.com/documentation/Xcode/preparing-your-app-for-distribution), [build upload](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds), [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), and [review submission](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app) guides govern those steps.
