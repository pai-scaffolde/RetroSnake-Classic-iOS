# Voxel Snake for iPhone

Voxel Snake is a separate, offline iPhone app built from RetroSnake's original TypeScript 3D game source. It opens into Classic Snake on the LCD of the 3D phone, matching the experience shown at `scaffolde.ai/snake` in T3 Code Nightly. Touch swipes steer, the phone menu exposes the classic level and maze options, and the native shell adds light haptic feedback. The website game is a separate project and is not built or modified here.

## Project layout

- `web/` — editable Three.js game source, copied from the local RetroSnake source archive and specialized for this app.
- `web/public/assets/` — self-contained game assets copied from the RetroSnake website checkout on 2026-09-24.
- `ios/` — XcodeGen specification and SwiftUI/WebKit iPhone target.
- `ios/RetroSnakeClassic/GameAssets/` — generated offline web bundle. Regenerate with the packaging script.
- `ios/ci_scripts/ci_pre_xcodebuild.sh` — Xcode Cloud setup that installs locked web dependencies and creates the offline bundle in a fresh checkout.
- `design/AppIcon.svg` — editable app icon source.
- `store/` — draft listing and privacy text for review before publishing.

## Build

Requires Bun, XcodeGen, and full Xcode with an iOS SDK. All are installed on this Mac.

```sh
cd '/Users/gary/Projects/RetroSnake Classic iOS'
cd web && bun install --frozen-lockfile && cd ..
bash scripts/package-ios.sh
open ios/RetroSnakeClassic.xcodeproj
```

In Xcode, sign in with the Apple developer account associated with `garynoonan@me.com`, select its team under **Signing & Capabilities**, and verify the provisional bundle ID `ai.scaffolde.retrosnakeclassic` is available for that team. Do this before the first App Store Connect upload; Apple does not allow changing the bundle ID of an uploaded app record. The email is an account hint, not a signing credential or proof of team membership.

The app target supports iPhone portrait on iOS 17 or later. Its custom `retrosnake://app/` scheme serves the entire game from the app bundle. It requests no network entitlements and rejects navigation outside that local origin. Scores and settings use local web storage.

## Checks run on 2026-09-24

- `bun run test`: 51 game and touch-input tests passed.
- `bun run build`: TypeScript and Vite production build passed.
- Earlier browser QA exercised the voxel arena before the principal clarified the intended Classic LCD experience. It does not verify the current app flow.
- The current app was built with Xcode and launched on an iPhone 17 Pro iOS 26.5 Simulator. A simulator screenshot showed the textured desk, modeled phone, glowing key labels, and Classic LCD board. The first simulator run used fallback meshes because WebKit reported status `0` for the bundled asset manifest; `Assets.load` now accepts that valid local response.
- Phone-sized Chrome play showed the Classic LCD game, its phone menu and maze selection, Game Over after a bounded-maze wall collision, and the retry transition into another LCD run.
- Independent review found an arena-only VIEW setting still visible in the phone menu. It was removed; Chrome then showed only SOUND, GFX, SCREEN, and BACK in settings.
- Independent review found a multi-finger steering interruption; the app copy now keeps the active swipe until its own pointer ends. It also reloads after WebKit evicts the content process.
- `xcodegen generate`, `plutil -lint`, and the iOS Simulator build passed.
- Every path in the asset manifest exists in the packaged game directory.

The simulator launch does not prove physical iPhone graphics/audio/haptics, TestFlight installation, or App Store acceptance. The principal waived the physical device playtest on 2026-09-24 and chose TestFlight for the release path.

## App Store route

1. Build from the committed Xcode project. Xcode Cloud's pre-build script installs locked Bun dependencies and packages the offline game assets before Xcode copies resources. The Xcode Cloud workflow remains uncreated because Apple rejects the linked repository account's Admin permission despite the GitHub app being installed for this repository only. Local Apple Distribution signing is the fallback.
2. Run the app in Simulator and TestFlight. Check launch, LCD rendering and phone appearance, swipes, menu, Game Over, retry, audio, airplane mode, and returning from the background. Haptics need a device-based TestFlight report; the principal waived a local physical device playtest.
3. App Store Connect record `6815825906` has the saved name **Voxel Snake**, description, review contact, age rating, Free price, worldwide availability, copyright `2026 Scaffolde`, and two genuine RGB iPhone Simulator screenshots. The [support](https://scaffolde.ai/retrosnake-classic/support.html) and [privacy](https://scaffolde.ai/retrosnake-classic/privacy.html) pages are live and visually checked; the production site's `/api/site-release` revision matched merged [website PR #18](https://github.com/Scaffolde/scaffolde-website/pull/18). The public privacy URL is saved in App Store Connect. The user directed us to ignore the website CI job that could not start because of GitHub billing.
4. An Apple Distribution certificate and `Voxel Snake App Store` provisioning profile for `ai.scaffolde.retrosnakeclassic` are installed on this Mac. The arm64 iPhone archive passed strict code-signature verification, exported to a valid IPA, and uploaded successfully. App Store Connect completed processing version 1.0 (build 1) on 2026-09-24; it appears in TestFlight as **Ready to Submit** and is attached to the 1.0 App Store version. The TestFlight "What to Test" instructions are saved. No tester group or TestFlight installation has been verified.
5. The account's EU Digital Services Act declaration is saved as non-trader, per the principal's classification; App Store Connect shows DSA compliance Active. The Free Apps Agreement is active; the Paid Apps Agreement is unnecessary for this free app.
6. Test the distributed build through TestFlight, then submit the reviewed build and metadata to App Review.

Apple's [distribution preparation](https://developer.apple.com/documentation/Xcode/preparing-your-app-for-distribution), [build upload](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds), [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), and [review submission](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app) guides govern those steps.
