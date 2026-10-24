# Tely's DND Importer 0.1.4

Fixes the repeated `Cannot use 'in' operator to search for 'rules' in 1` error when analyzing content with installed-compendium matching enabled.

D&D5e already indexes the whole `system.source` object. The importer previously also requested `system.source.rules`, causing an overlapping field projection. It now checks each pack's existing/default index coverage and requests only missing metadata. Actor and Item requests use their appropriate system fields; journal and table requests use importer metadata.

2014/2024 matching, feature identity, duplicate reuse and selective document loading are retained. A genuinely unreadable pack is still reported while other packs remain usable. Midi-QOL remains optional.

Update **Tely's DND Importer to 0.1.4** from Foundry Setup → Add-on Modules, then relaunch the world. Leave **Match installed compendiums** enabled. The permanent update manifest remains:

https://github.com/Telynor/telys-dnd-importer/releases/latest/download/module.json

The new projection-boundary tests reproduce the reported error with the previous request and verify the fix. Browser QA exercises the actual entrypoint and Analyze/Import/Undo actions against mocked Foundry application/persistence/index boundaries. Live Foundry document creation and combat workflows remain unverified; see VALIDATION.md.
