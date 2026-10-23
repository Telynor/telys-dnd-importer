# Changelog

## 0.1.1

- First GitHub publication with a permanent Foundry installation/update manifest and versioned download ZIP.
- Added a reproducible OCR-asset restore script and an automated validation/package/release workflow.
- Includes the runtime and importer fixes from 0.1.0-alpha.2. Live Foundry/Midi-QOL combat acceptance remains pending.

## 0.1.0-alpha.2

- Recovered the saved importer project and preserved its original module identity.
- Added bundled English OCR with local worker, WASM and language data. Clear screenshots can be read without a model, API key, companion or runtime download. Added recognized-text review and conversion into editable source text.
- Added an Ollama setup guide and Test model connection button. Improved provider error reporting for missing models and image support, with session credentials redacted.
- Fixed Character input to parse creature-style statistics and actions correctly.
- Scoped granted-feature duplicates to their parent and level, including legacy class-feature matching; added importer metadata to compendium indexes.
- Shared the write lock between importer windows and API operations, expanded preview-integrity checks, and preserved dependencies used by later import batches during undo.
- Kept review JSON corrections across rerenders and made file intake atomic. Invalid embedded actions now block their actor, daily charges use day recovery, and same-named effects keep individual save behavior.
- Added regression tests and vendored-asset integrity checks. Live Foundry/Midi-QOL combat acceptance remains outstanding.

## 0.1.0-alpha.1

- Initial Foundry v14 ApplicationV2 importer with text, image, web link, and normalized JSON input paths.
- Native text parser and optional configurable chat-completions/vision extraction.
- Broad D&D5e content builders, class/subclass feature grants, advancement, race/background fields, and Midi-QOL activity/effect compilation.
- Duplicate resolution, exact-edition compendium references, world/pack destinations, import review, JSON corrections, and batch history/undo.
- Python local companion for public-page extraction and model CORS forwarding.
- Automated parsing, compilation, provider, transaction, and companion tests. Browser workflow checked against a Foundry mock. Live Foundry/Midi-QOL acceptance testing remains outstanding.
