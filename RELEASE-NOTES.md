# Tely's DND Importer 0.1.1

First public development release for Foundry VTT v14, D&D5e 5.3.3–5.x and Midi-QOL 14.0–14.5.

- Import creatures, spells, equipment, classes, subclasses, features and other supported content from text, clear English screenshots or public web pages.
- Built-in English image reading runs locally with all assets included. Optional Ollama or compatible model extraction supports more complex layouts.
- Review native activities, effects, progression and automation warnings before creating documents. Unsupported mechanics remain flagged for review.
- Includes duplicate checks, world/compendium destinations, import history and guarded undo.
- Permanent installation/update manifest and versioned package downloads.

Install through Foundry Setup → Add-on Modules → Install Module using:

https://github.com/Telynor/telys-dnd-importer/releases/latest/download/module.json

79 JavaScript tests and 11 companion tests passed. Browser OCR and mocked model-request checks passed on the preceding development build. Live Foundry/Midi-QOL combat workflows remain unverified; start with the supplied examples in a test world. See README.md and VALIDATION.md for setup, supported mechanics and limits.
