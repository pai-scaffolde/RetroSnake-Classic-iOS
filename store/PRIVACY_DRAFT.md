# RetroSnake Classic privacy review

RetroSnake Classic is an offline game. It does not require an account and does not include ads, analytics, or tracking. Scores and game settings are stored on your device so the game can remember them. The app does not send those values to a RetroSnake server.

The host-ready policy is in `site/privacy.html`, with contact details in `site/support.html`. Copies are staged in the Scaffolde Website support-pages worktree for `https://scaffolde.ai/retrosnake-classic/privacy.html` and `https://scaffolde.ai/retrosnake-classic/support.html`. These URLs are not claimed live until the site change is deployed and read back. The current source contains local asset fetches and local storage; the iOS wrapper allows navigation only to the bundled app origin. Verify the final signed build and any future integrations before publishing the policy and answering App Store Connect's data-collection questionnaire.
