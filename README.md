# Voxel Snake for iPhone

Voxel Snake is a separate, offline iPhone app built from RetroSnake's TypeScript 3D game source. It opens directly into the 3D voxel arena, where the playable world progresses from the 2001 grid through the present-day island to the neon future. Touch swipes steer the snake, and the native shell adds light haptic feedback. The website game is a separate project and is not built or modified here.

## Project layout

- `web/` — editable Three.js game source, copied from the local RetroSnake source archive and specialized for this app.
- `web/public/assets/` — self-contained game assets. Arena textures are full-resolution PNGs imported from the desktop Unreal project's `Art/Textures/Arena` folder on Plex; other assets retain their original web exports.
- `scripts/import-arena-source-textures.py` — validates and imports all 35 desktop arena textures, preserving source resolution and applying the required lossless DirectX-to-OpenGL normal-map green-channel conversion.
- `ios/` — XcodeGen specification and SwiftUI/WebKit iPhone target.
- `ios/RetroSnakeClassic/GameAssets/` — generated offline web bundle. Regenerate with the packaging script.
- `ios/ci_scripts/ci_pre_xcodebuild.sh` — Xcode Cloud setup that installs locked web dependencies and creates the offline bundle in a fresh checkout.
- `design/AppIconArena-source.png` — arena app icon artwork; `design/AppIcon.svg` and `design/AppIconClassic.png` retain the previous LCD icon.
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

## Arena fidelity work on 2026-09-24

- The native launch now enters the arena. EPIC requests the full authored meshes instead of the simplified L1 models; the authored island mesh has 315,690 triangles versus 89,996 in L1. The original era-transition progression was restored.
- A phone-sized WebKit preview rendered the arena at 1284 × 2778, verified the full-model selection, and displayed all three eras. Touch steering, pause, Game Over, and retry worked in a browser run. The native custom-scheme launch harness confirmed the arena HUD and EPIC resolution. These are development checks, not physical iPhone performance or visual acceptance.
- The 35 arena textures now come from the desktop project's original PNGs; 21 regain their 2048 × 2048 source resolution instead of the prior 1024 × 1024 WebP export. Four height maps retain their 16-bit PNG source data in the bundle. The seven DirectX normal maps are converted to full-resolution lossless PNGs with only the green channel inverted, matching the original web export's shader convention. The 29 textures preloaded at arena startup use substantially more GPU memory than the former exports; physical iPhone performance remains unverified.

## Earlier Classic LCD checks

- `bun run test`: 51 game and touch-input tests passed.
- `bun run build`: TypeScript and Vite production build passed.
- The Classic LCD build was verified before the principal changed the target to the voxel arena. It does not verify the arena app flow.
- The current app was built with Xcode and launched on an iPhone 17 Pro iOS 26.5 Simulator. A simulator screenshot showed the textured desk, modeled phone, glowing key labels, and Classic LCD board. The first simulator run used fallback meshes because WebKit reported status `0` for the bundled asset manifest; `Assets.load` now accepts that valid local response.
- Phone-sized Chrome play showed the Classic LCD game, its phone menu and maze selection, Game Over after a bounded-maze wall collision, and the retry transition into another LCD run.
- Independent review found an arena-only VIEW setting still visible in the phone menu. It was removed; Chrome then showed only SOUND, GFX, SCREEN, and BACK in settings.
- Independent review found a multi-finger steering interruption; the app copy now keeps the active swipe until its own pointer ends. It also reloads after WebKit evicts the content process.
- `xcodegen generate`, `plutil -lint`, and the iOS Simulator build passed.
- Every path in the asset manifest exists in the packaged game directory. All 155 shared game assets in the app and website checkout have matching hashes; only a font license text file differs.
- The Retina comparison measured a 428-point canvas at 642 pixels on MED and 1284 pixels on EPIC in WebKit. The native custom-scheme launch check passed, and the higher-resolution simulator capture was viewed. This does not establish frame rate or visual approval on the physical iPhone.

The principal installed build 1 on an iPhone 16 Pro through TestFlight and clarified that the expected app is the full 3D voxel arena. Build 3 is also a Classic LCD build and does not address that correction. The principal waived a local cable-based device playtest on 2026-09-24.

## App Store route

1. Build from the committed Xcode project. Xcode Cloud's pre-build script installs locked Bun dependencies and packages the offline game assets before Xcode copies resources. The Xcode Cloud workflow remains uncreated because Apple rejects the linked repository account's Admin permission despite the GitHub app being installed for this repository only. Local Apple Distribution signing is the fallback.
2. Install the full-resolution arena build 1.0 (4) from TestFlight and assess smoothness, heat, launch, swipes, era transitions, pause, Game Over, retry, audio, airplane mode, background recovery, and haptics on the iPhone 16 Pro. The desktop project on Plex is the source for future arena texture imports. Local packaging, browser, Simulator, and signing checks passed; device acceptance remains open.
3. App Store Connect record `6815825906` has the saved name **Voxel Snake**, description, review contact, age rating, Free price, worldwide availability, copyright `2026 Scaffolde`, and two genuine RGB iPhone Simulator screenshots. The [support](https://scaffolde.ai/retrosnake-classic/support.html) and [privacy](https://scaffolde.ai/retrosnake-classic/privacy.html) pages are live and visually checked; the production site's `/api/site-release` revision matched merged [website PR #18](https://github.com/Scaffolde/scaffolde-website/pull/18). The App Privacy **Data Not Collected** responses are published. The user directed us to ignore the website CI job that could not start because of GitHub billing.
4. An Apple Distribution certificate and `Voxel Snake App Store` provisioning profile for `ai.scaffolde.retrosnakeclassic` are installed on this Mac. The arm64 iPhone build 4 archive passed strict code-signature verification and uploaded successfully. App Store Connect completed processing version 1.0 (build 4); the **Voxel Snake Internal** group shows it **Testing** with arena-specific "What to Test" guidance. The group's one tester has build 3 installed on an iPhone 16 Pro and can update to build 4. Build 1 remains attached to the 1.0 App Store version pending review.
5. The account's EU Digital Services Act declaration is saved as non-trader, per the principal's classification; App Store Connect shows DSA compliance Active. The Free Apps Agreement is active; the Paid Apps Agreement is unnecessary for this free app.
6. App Store Connect shows iOS version 1.0 (build 1) **Waiting for Review**, submitted on 2026-09-24 at 3:22 PM (submission `bc7fde0c-c63c-471b-9437-f124de797094`). The version uses manual release after approval. That review build and the existing screenshots describe Classic LCD, so they must be replaced before public release of the corrected arena app.

Apple's [distribution preparation](https://developer.apple.com/documentation/Xcode/preparing-your-app-for-distribution), [build upload](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds), [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), and [review submission](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app) guides govern those steps.
