# Tely's DND Importer 0.1.3

Fixes the repeated Manage Modules error saying the importer cannot be enabled because Midi-QOL is not enabled.

Midi-QOL is now optional. Enable the importer independently to read text/images, use Ollama, analyze, import native D&D5e documents, review and undo. The importer reports missing, disabled, incompatible or failed-startup Midi separately in its window, preview and batch history. It does not claim that Midi-only combat automation works without Midi.

For automatic attack/save chains, repeat saves and fixed Multiattack, enable the automation version matching your D&D5e system and analyze again before importing. D&D5e 6.0.6 uses Midi-QOL 14.6 with DAE 14.6 on Foundry 14.368+. The README includes the authors' direct manifests. Existing imports created without Midi may need reimporting to restore Midi schema fields.

Return to Foundry Setup → Add-on Modules, update the importer to **0.1.3**, then relaunch the world and enable it. Updating the installed package is necessary to remove 0.1.2's mandatory dependency. The permanent update manifest remains:

https://github.com/Telynor/telys-dnd-importer/releases/latest/download/module.json

Regression coverage includes importer boot, Analyze, Import and Undo without Midi-QOL. Live Foundry document creation and Midi-QOL combat workflows remain unverified; see VALIDATION.md for scope.
