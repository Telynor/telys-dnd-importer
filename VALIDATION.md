# Validation — 2026-10-23

Publication build: `0.1.1`. The 90 automated checks are rerun for this version. Browser OCR/model-request QA below was performed on `0.1.0-alpha.2`; publication changes add version/update metadata and release tooling without changing those runtime paths.

- **79 JavaScript tests passed** using Node's test runner. Coverage includes parsing, normalized data, activities/effects, class advancement, parent/level-specific duplicate matching, Character input, write locking across service instances, preview integrity, rollback, guarded undo across dependent batches, provider connections/errors and OCR worker cleanup/cancellation.
- **11 Python tests passed** for the included companion: readable HTML extraction, content-header preservation, public-address checks, origin/token enforcement, HTTP routing and credential/error handling.
- JavaScript syntax, Python compilation, manifest/runtime version agreement, referenced runtime files and SHA-256 integrity of vendored image-reader assets passed.
- Chromium browser workflows passed with a Foundry persistence mock: text import and undo, JSON corrections surviving rerenders, atomic rejection of a mixed invalid file batch, conversion of recognized text into editable source, Ollama-compatible connection testing, image request construction, and credential clearing on close.
- **Real bundled OCR executed in Chromium** on a rendered screenshot of the original Copperwork Watcher training statblock. It recovered AC 16, HP 45, all six ability scores and all five named traits/actions. The source was parsed and compiled through the importer UI. Remote requests were blocked during this test; worker, core and English recognition data loaded only from the local module directory.
- The browser test used a mocked chat-completions response for the model path and confirmed that the screenshot is sent as image data. No actual Ollama model inference was available in this workspace.
- Schema review checked the official D&D5e `release-5.3.3` Save/Attack activity, AppliedEffectField and ItemGrant configuration source. Foundry v14 application and effect references are linked in README.md. Earlier alpha validation also reviewed Midi-QOL v14 sources; no change to its fixed-Multiattack handler was made here.

## Outstanding live acceptance

No licensed Foundry runtime or active user world was available in this workspace. Real Foundry document creation and actual Midi-QOL attack/save/effect/concentration/combat workflows have **not** been executed. The browser mock substitutes document persistence/validation and does not establish live system compatibility.

No live vision provider was configured. The built-in OCR test establishes that the packaged reader runs and can read a clear English test screenshot; it does not establish accuracy on arbitrary scans, multiple columns or ornate fonts. Always compare extracted statistics and mechanics with the original image. Model extraction quality also depends on the configured model and context budget.

The alpha validates planned documents against the installed world's real schemas before writes and reports removed activities/effects. Use the original examples and live acceptance steps in README.md in a test world to finish integration validation.
