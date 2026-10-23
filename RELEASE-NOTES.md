# Tely's DND Importer 0.1.2

Compatibility fix for Foundry v14 with D&D5e 6.0.6. The importer previously blocked system 6 in both its package manifest and runtime checks.

- Added version 6 output for persisted AC, movement, roll bonuses, passive effects, rarities and class advancements.
- Fixed preflight validation of class-feature UUIDs under the version 6 schema, with additional guards against stripped advancements and changed actor fields.
- Allows Midi-QOL 14.6; explains incompatible automation release lines. D&D5e 5.3.3–5.x remains supported with its previous automation line.
- Keeps the independent 2014/2024 rules selector. 2014 rules work with D&D5e 6 software.
- Built-in image reading and optional Ollama extraction remain available.

**For D&D5e 6.0.6:** install Midi-QOL 14.6 and DAE 14.6 using their authors' explicit manifests, then enable their dependencies and the importer. Regular package-directory updates may still offer the older 14.0 line. The README includes the exact links and steps.

Update the importer through Foundry Setup → Add-on Modules → Check for Update → Update. Its permanent manifest remains:

https://github.com/Telynor/telys-dnd-importer/releases/latest/download/module.json

94 JavaScript and 11 Python companion tests passed. Reviewed the official D&D5e 6.0.6 models and Midi-QOL 14.6.0 source. Live Foundry document creation and Midi-QOL combat workflows remain unverified; try the supplied example in a test world first. See VALIDATION.md for the precise scope.
