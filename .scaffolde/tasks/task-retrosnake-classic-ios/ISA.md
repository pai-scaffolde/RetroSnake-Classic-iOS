---
artifact: isa
task: "Standalone Voxel Snake Classic LCD iPhone app"
slug: retrosnake-classic-ios
principal_stated_goal: "Can I get the voxel experience Classic Snake game in RetroSnake created as it's own discrete experience. I want to leave the existing experience intact, i just think the voxel experience is something that we can create as a distinct iphone app! What skills do we have that can help us publish this to the app store? My apple developer account is under garynoonan@me.com"
phase: build
progress: 3/7
started: 2026-09-24T19:12:48Z
updated: 2026-09-24T22:31:16Z
sources:
  - /private/tmp/retrosnake-web-source.zip
  - /Users/gary/.t3/worktrees/Scaffolde Website/snake-scene-choice/public/snake/assets
---

## Problem

RetroSnake currently delivers Classic Snake on a 3D phone LCD inside a multi-scene website game. It has no separate iPhone app target.

## Vision

The app launches directly into the Classic Snake game on the 3D phone LCD shown in T3 Code Nightly, plays offline with touch controls, and retains the original phone menu and score loop. It feels like a complete focused game on iPhone.

The installed game should render the authored phone and LCD at Retina clarity rather than stretching a low-resolution frame across the iPhone screen.

## Out of Scope

- Changing or deploying the existing website game.
- Submitting the app to App Review before a signed build and store materials are reviewable.

## Constraints

- The standalone game owns its source and bundled assets independently of the website.
- iOS signing uses the developer team associated with garynoonan@me.com, once verified in Xcode or App Store Connect. The email alone does not prove team membership.

## Goal

Create a distinct iPhone app for RetroSnake's Classic LCD Snake experience while preserving the existing website game, and identify the skills and steps that can take it to the App Store.

## Criteria

- [x] ISC-1: A separate iOS app project and bundle identity exist — probe: inspect project configuration and source tree.
- [ ] ISC-2: The bundled game launches into playable Classic Snake on the 3D phone LCD, with touch steering, phone menu, Game Over, and a new run — probe: browser, Simulator, and TestFlight playtest.
- [x] ISC-3: The existing RetroSnake website experience remains intact from this task — probe: confirm the app lives in a separate project and website worktrees are clean.
- [x] ISC-4: An evidence-based App Store path names available skills, build and signing prerequisites, and submission gates — probe: inspect skill catalog and current Apple documentation.
- [ ] ISC-5: The release gates are completed or named with their concrete external blocker — probe: reread the request against ISC-1 through ISC-4.
- [ ] ISC-6: The standalone iPhone app renders the authored phone scene at the device's native pixel ratio and retains the source models and textures — probe: inspect the bundled asset hashes, WebKit canvas dimensions, and a viewed iPhone-sized screenshot.
- [ ] ISC-7: Anti: A blurry or unverified build replaces the reviewed version or reaches public release — probe: inspect TestFlight build assignment, App Review version, and device screenshot before release.

Anti-claim: a local Simulator build or the earlier voxel-arena playtest does not prove a clean Xcode Cloud build, signed TestFlight distribution, or App Store readiness. The principal waived the local physical iPhone playtest.

## Test Strategy

| ISC | Type | Check | Threshold | Tool |
| --- | --- | --- | --- | --- |
| ISC-1 | static | Read iOS project and bundle identity | Separate target present | rg / read |
| ISC-2 | behavior | Unit tests, web build, browser gameplay, iPhone build and runtime | Pass, with any missing iPhone probe explicitly open | bun / browser / xcodebuild |
| ISC-3 | source | Compare website status and hashes | No changes caused by this task | git / shasum |
| ISC-4 | research | Read installed skills and Apple primary docs | Route and prerequisites named | SkillSearch / web |
| ISC-5 | completeness | Check each original deliverable against evidence | All addressed or explicit blocker | read |
| ISC-6 | visual | Hash assets, measure WebKit drawing buffer, view phone-sized pixels | Source assets match; full Retina canvas; model and LCD detail visibly crisp | shasum / WebKit / screenshot |
| ISC-7 | release | Read TestFlight and App Review state before moving the build | No unverified replacement or public release | App Store Connect |

## Features

| Feature | Description | Satisfies | Depends On | Parallelizable |
| --- | --- | --- | --- | --- |
| game | Isolated offline Classic LCD game build | ISC-2 | source and assets | false |
| ios | iPhone app target serving the local game | ISC-1, ISC-2 | game build | false |
| release | App Store handoff and verification gates | ISC-4 | app target | false |

## Decisions

- 2026-09-24: The principal initially selected the 3D voxel arena, then explicitly corrected the requested standalone experience to the Classic game visible in T3 Code Nightly's browser. The later clarification controls: Classic Snake on the 3D phone LCD.
- 2026-09-24: The project is a separate directory; the website's compiled game and deployment are source evidence, not the app's mutable runtime.
- 2026-09-24: The principal waived the local physical device test after creating an Xcode Cloud environment. Simulator and TestFlight are the remaining runtime routes.
- 2026-09-24: The principal confirmed the Classic Snake game on the 3D phone LCD and chose **Voxel Snake** as the App Store title. The Xcode target and bundle ID retain their internal RetroSnake Classic identity.
- 2026-09-24: After installing build 1 through TestFlight, the principal reported severe blur and poor visual fidelity. A clarified preference between sharper Classic LCD presentation and the full voxel arena was requested; the Retina-resolution fix is proceeding independently.

## Verification

- ISC-1: `ios/RetroSnakeClassic.xcodeproj/project.pbxproj` names a separate iPhone target with provisional bundle ID `ai.scaffolde.retrosnakeclassic`. The offline `GameAssets` folder reference is in Resources. Xcode 27 builds and launches the app in an iPhone 17 Pro iOS 26.5 Simulator.
- ISC-2: `bun run test` passed 51 tests and `bun run build` passed. The simulator displays the original textured desk, modeled phone, glowing key labels, and Classic Snake LCD board. The first simulator run used fallback models because WebKit exposes the custom-scheme manifest as status `0`; accepting and parsing that response restored the assets. Chrome rendered the phone scene at phone width, entered LCD Snake, opened the phone menu, selected the Box maze, reached Game Over on a wall collision, and showed a new LCD run on retry. Simulator touch input, audio, haptics, and a physical iPhone run are still open. The earlier arena playtest does not count for this revised criterion.
- ISC-3: The app resides under `/Users/gary/Projects/RetroSnake Classic iOS`. The website checkout and its scene-choice worktree are clean after this task. The scene-choice worktree advanced to commit `23632a1` concurrently during this task; this project did not edit or deploy it, so its independently changed live behavior is not claimed here.
- ISC-4: `store/APP_STORE_DRAFT.md` maps the available skills. Current Apple documentation confirms app record, build upload, TestFlight, privacy URL, screenshots, and review gates. Website PR #18 stages the support/privacy pages without changing `/snake`; local Chrome navigation between them passed. The PR is a draft, not a live public URL. Its GitHub build job ended before any steps and Vercel reported “Deployment was blocked.”
- ISC-5: App Store Connect has a Voxel Snake iOS record (Apple ID `6815825906`) on Gary Noonan's active team and registered bundle ID `ai.scaffolde.retrosnakeclassic`. A fresh checkout ran the Xcode Cloud pre-build hook, generated the 43 MB offline GameAssets bundle, and passed an iPhone 17 Pro Simulator Release build with that bundle in the app. An independent review found the missing shared scheme; it is now generated from `ios/project.yml` and committed. GitHub main contains those changes. The Xcode Cloud GitHub app is installed on `pai-scaffolde` with access only to this repository. The initial Xcode workflow attempt used a Gary GitHub session without repository admin permission; continuing in the pai browser requires Apple sign-in. Public support/privacy URLs, signed Cloud build, and TestFlight remain open. The physical iPhone probe is waived by the principal.
- ISC-6 partial: All 155 shared app and website assets have matching hashes; the sole differing file is a font license text file. WebKit at 428 CSS pixels and device ratio 3 measured a 642-pixel-wide canvas at MED and 1284 pixels at EPIC after the renderer change; both screenshots were viewed. The Simulator attract screen shows sharper phone and LCD detail. The native custom-scheme harness confirms the EPIC default and canvas ratio on Mac. Build 3 has not yet been installed or assessed on a physical iPhone, and the original Unreal project has not been located or compared.
- ISC-7 open: Build 1 is installed by the principal and is Waiting for Review. Build 2 was uploaded for TestFlight processing during fidelity work, but its quality migration would override a manually selected lower setting. Signed build 3 removes that migration, is processed by Apple, and is Testing in the Voxel Snake Internal group with one tester. The visual/performance comparison is in its "What to Test" notes. Build 1 remains attached to App Review; no public release has occurred.
