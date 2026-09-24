---
artifact: isa
task: "Standalone RetroSnake voxel iPhone app"
slug: retrosnake-classic-ios
principal_stated_goal: "Can I get the voxel experience Classic Snake game in RetroSnake created as it's own discrete experience. I want to leave the existing experience intact, i just think the voxel experience is something that we can create as a distinct iphone app! What skills do we have that can help us publish this to the app store? My apple developer account is under garynoonan@me.com"
phase: verify
progress: 3/5
started: 2026-09-24T19:12:48Z
updated: 2026-09-24T19:30:15Z
sources:
  - /private/tmp/retrosnake-web-source.zip
  - /Users/gary/.t3/worktrees/Scaffolde Website/snake-scene-choice/public/snake/assets
---

## Problem

RetroSnake currently delivers the voxel arena inside a multi-scene website game. It has no separate iPhone app target.

## Vision

The app launches directly into the voxel Snake arena, plays offline with touch controls, and starts another voxel run after a loss. It feels like a complete focused game on iPhone.

## Out of Scope

- Changing or deploying the existing website game.
- Creating an App Store Connect record or submitting a build before an iPhone build and store materials are reviewable.

## Constraints

- The standalone game owns its source and bundled assets independently of the website.
- iOS signing uses the developer team associated with garynoonan@me.com, once verified in Xcode or App Store Connect. The email alone does not prove team membership.

## Goal

Create a distinct iPhone app from RetroSnake's 3D voxel arena while preserving the existing experience, and identify the skills and steps that can take it to the App Store.

## Criteria

- [x] ISC-1: A separate iOS app project and bundle identity exist — probe: inspect project configuration and source tree.
- [ ] ISC-2: The bundled game launches into a playable voxel arena, remains in the voxel era, and starts another voxel run after a loss — probe: game logic tests and real browser play; iPhone runtime remains a later hardware probe.
- [x] ISC-3: The existing RetroSnake website experience remains intact from this task — probe: confirm the app lives in a separate project and website worktrees are clean.
- [x] ISC-4: An evidence-based App Store path names available skills, build and signing prerequisites, and submission gates — probe: inspect skill catalog and current Apple documentation.
- [ ] ISC-5: Anti: A deliverable named in the original request scope was left unaddressed — probe: reread the request against ISC-1 through ISC-4.

## Test Strategy

| ISC | Type | Check | Threshold | Tool |
| --- | --- | --- | --- | --- |
| ISC-1 | static | Read iOS project and bundle identity | Separate target present | rg / read |
| ISC-2 | behavior | Unit tests, web build, browser gameplay, iPhone build and runtime | Pass, with any missing iPhone probe explicitly open | bun / browser / xcodebuild |
| ISC-3 | source | Compare website status and hashes | No changes caused by this task | git / shasum |
| ISC-4 | research | Read installed skills and Apple primary docs | Route and prerequisites named | SkillSearch / web |
| ISC-5 | completeness | Check each original deliverable against evidence | All addressed or explicit blocker | read |

## Features

| Feature | Description | Satisfies | Depends On | Parallelizable |
| --- | --- | --- | --- | --- |
| game | Isolated offline voxel game build | ISC-2 | source and assets | false |
| ios | iPhone app target serving the local game | ISC-1, ISC-2 | game build | false |
| release | App Store handoff and verification gates | ISC-4 | app target | false |

## Decisions

- 2026-09-24: The principal selected the 3D voxel arena over the 2001 phone LCD game.
- 2026-09-24: The project is a separate directory; the website's compiled game and deployment are source evidence, not the app's mutable runtime.

## Verification

- ISC-1: `ios/RetroSnakeClassic.xcodeproj/project.pbxproj` passes `plutil -lint` and names a separate iPhone target with provisional bundle ID `ai.scaffolde.retrosnakeclassic`. The offline `GameAssets` folder reference is in Resources. Full Xcode is absent, so an iOS binary has not been built.
- ISC-2: `bun run test` passed 51 tests, including the independent review's multi-finger steering regression, and `bun run build` passed. Mobile WebKit browser showed the 2001 voxel arena, Game Over, and retry into 2001 with no page errors. macOS WKWebView loaded the packaged custom scheme successfully. A signed iPhone run is open.
- ISC-3: The app resides under `/Users/gary/Projects/RetroSnake Classic iOS`. The website checkout and its scene-choice worktree are clean after this task. The scene-choice worktree advanced to commit `23632a1` concurrently during this task; this project did not edit or deploy it, so its independently changed live behavior is not claimed here.
- ISC-4: `store/APP_STORE_DRAFT.md` maps the available skills. Current Apple documentation confirms app record, build upload, TestFlight, privacy URL, screenshots, and review gates.
- ISC-5: Original deliverables are addressed, but iPhone runtime proof for ISC-2 and the final completeness close remain open.
