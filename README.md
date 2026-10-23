# Tely's DND Importer

**0.1.1 — an installable development build for Foundry v14, D&D5e 5.3.3–5.x, and Midi-QOL 14.0.x.**

Import D&D content from pasted text, image attachments, and public web links. A bundled English OCR reader reads clear screenshots locally without an account, model, companion, API key, or runtime download. Optional Ollama or compatible vision extraction handles more complex layouts. The importer extracts a reviewable intermediate format and compiles supported mechanics into native D&D5e activities, Active Effects, advancement, and Midi-QOL data. Original source text accompanies the imported document.

This build has automated parser/compiler/transaction tests and browser tests using a Foundry mock. **It has not been run in a licensed Foundry world, and live Midi-QOL combat execution has not been verified.** Treat it as an alpha; use the included original training examples in a test world first.

## Install

1. In Foundry Setup, open **Add-on Modules → Install Module**.
2. Paste this into **Manifest URL** and choose **Install**:

   `https://github.com/Telynor/telys-dnd-importer/releases/latest/download/module.json`

3. Open a D&D5e world using system version 5.3.3–5.x, enable Midi-QOL 14 and its required dependencies, then enable **Tely's DND Importer** in Manage Modules.
4. Click **DND Importer** in the Actors, Items, or Compendium sidebar, or open **Configure Settings → Tely's DND Importer → Open DND Importer**.

For future published releases, use Foundry's **Check for Update / Update** controls. The manifest URL stays the same. If you previously installed the development ZIP, stop Foundry and remove the old `Data/modules/telys-dnd-importer` folder before installing through the manifest, so the installed copy has its update information. World documents already imported remain in the world.

For manual installation, extract the release ZIP and put its `telys-dnd-importer` directory in `Data/modules/`, then restart Foundry.

This is an early development release. Do not use it with D&D5e 6; that system version needs a separate adapter. The `2014/2024` selector controls the content's rules edition, independently of the installed system's software version.

## First import

1. Choose **Load example** to load the original Copperwork Watcher statblock.
2. Leave **Extraction → Built-in text & image reader** selected and choose **Analyze source**.
3. Review the actor, generated data, activities, effects, and warnings. The watcher has a fixed Multiattack sequence, a melee attack, a spell attack with a linked repeat-save condition, and a recharge cone.
4. Choose **Import selected**. Open the created actor from **History → Documents**.
5. Use **Undo batch** to remove the test content. Documents edited since import and dependencies needed by an edited parent are retained.

For screenshots, choose the built-in reader and **Analyze source**. On the Source tab, **Text read from images → Use as editable source text** lets you correct OCR or separate entries before reanalyzing. Clear, cropped, single-column English statblocks work best. Ornate fonts, multiple columns, diagrams and poor scans may need a vision model. Always check extracted scores, dice and saving throw DCs.

For multiple plain-text entries, separate them with a line containing `---`. If detection cannot identify the type, select it explicitly. Native parsing expects readable line breaks; use model extraction or the JSON editor for complex layouts.

## Inputs

| Input | Behavior |
| --- | --- |
| Pasted text / TXT / Markdown | Standard creature blocks, spells, common equipment, explicit class feature headings, and supported other types can use the local parser. No model is required. |
| PNG, JPEG, WebP | Attach, drag in, or paste up to eight images totaling 20 MB. The built-in English OCR reader runs in a browser worker using bundled assets. Alternatively choose a configured vision model. |
| Web links | Enter one public HTTP(S) page per line. Direct browser fetch works when the site permits it; otherwise use the companion or paste the visible text. |
| Import JSON | Reimport normalized exported JSON, or correct it in Review and choose Validate & rebuild JSON. |

Images are source references for text recognition or model extraction; they are **not** automatically used as actor/token artwork. `img` can refer to a source-provided public image URL or an existing Foundry image path. There is no artwork search, image generation, PDF parser, account login, paywall bypass, or JavaScript-site renderer in this build.

## Content types

The pipeline supports creature/NPC actors and character actors; spells; weapons, equipment, consumables, tools, loot, and containers; feats/features; backgrounds; races/species; classes and subclasses; facilities; journals; and roll tables.

Creation and complete mechanical coverage are separate. A journal or a purely descriptive trait can be faithfully imported without an activity. A custom ability with unusual timing must be reviewed; unsupported logic is reported rather than silently presented as automated. Character actors built from NPC-style numbers do not automatically acquire player class levels and advancement choices.

## Automation in this build

| Mechanic | Generated implementation |
| --- | --- |
| Attacks | D&D5e Attack activities; printed creature attack bonuses use flat totals to avoid double proficiency/ability bonuses. |
| Damage / healing / temporary HP | Typed native damage parts or Heal activities. Uniform supported slot scaling is stored on damage parts. |
| Saving throws | Native Save activities with fixed or owner-derived DCs and none/half/full damage on a successful save. |
| Attack followed by a save | Midi-QOL `otherActivityId` links to an automation-only Save activity; rider effects attach to the save. The rider does not consume another action, item use, or spell slot. |
| Conditions | Non-transfer Active Effects associated with the relevant activity; supported save conditions apply on failure. |
| Repeat saves / ongoing damage | Midi-QOL `flags.midi-qol.OverTime` effect changes when the required data is known. A repeat-save source DC is never guessed from the target's statistics. |
| Passive/equipped bonuses | Reviewed, supported effect changes using v14 `system.changes` and string change types. |
| Magic Resistance | A recognized Magic Resistance trait can generate the documented Midi-QOL magic-resistance flag. |
| Uses / recharge | Native spent/max/recovery fields and consumption targets. Legendary-action costs use native activity activation handling. |
| Areas | Native cone, line, sphere, cube, or cylinder targeting data when dimensions are recognized. |
| Fixed Multiattack | A trusted module handler on `midi-qol.RollComplete` calls Midi-QOL's current `completeItemUse(item, usage, dialog, message)` API in sequence, with explicit targets and a confirmation. Choice-based sequences remain manual. |
| Creature spell lists | Exact name/type/rules matches from accessible installed content are copied onto the actor. Missing/ambiguous spells are reported; their definitions are not invented. |
| Class / subclass progression | Hit-point advancement, explicit feature levels with ItemGrant UUIDs, proficiencies/choices, ASI levels, custom ScaleValue data, and spellcasting progression. |
| Races / backgrounds | Granted feature items, explicit proficiency advancement, race movement/senses/size, and fixed or chosen ability-score increases when supplied. |

Automation respects your Midi-QOL world settings. It does not force global auto-roll, auto-target, concentration, or damage-application preferences. It does not import model-written JavaScript or arbitrary macro/effect keys. Existing installed content may retain its own trusted automation when used as a base template.

Complex choices, auras, positioning, polymorph/summon behavior, reactive damage, arbitrary conditional bonuses, custom resource economies, special class tables, and unusual timing require additional recipes or manual configuration. Native parsing extracts the first distinct saving throw in a complex feature and reports multiple different saves for review. Conditional damage resistances are preserved as custom text when they cannot be represented faithfully. Cantrip and unusual scaling need an installed match or explicit formula. Source material remains available in each document for comparison.

## Model and vision setup

Open **Model & connection** and supply:

- **Endpoint base URL:** a compatible chat-completions base, such as a local server's `http://127.0.0.1:11434/v1`. A full URL ending in `/chat/completions` also works.
- **Model name:** the exact installed/offered model identifier. Use a vision-capable model for screenshots. No model is bundled or downloaded automatically.
- **API key:** if your provider requires one. Local servers may not require a key. Provider usage charges, if any, come from your provider.
- **Maximum output tokens:** increase this or reduce the source batch if extraction is truncated.
- **JSON response format:** disable this if your endpoint does not accept `response_format`.

The selected source text and image data are sent to the configured endpoint only when you choose model extraction. Endpoint/model preferences are client settings. API keys and companion tokens entered in their dedicated fields are held only in the current importer window's memory, excluded from import JSON and history, and cleared on close.

The module accepts declarative extraction results, validates them, and compiles the data locally. Model confidence is advisory, so compare the review with the source. A model API response is never executed as code.

## Connect Ollama for image extraction

1. Keep your existing Ollama installation or portable server running on the same computer as the browser displaying Foundry.
2. Install a vision model, for example `ollama pull gemma3:4b`. If you use a portable executable outside PATH, run `.\ollama.exe pull gemma3:4b` from that executable's folder.
3. In **Model & connection**, set the endpoint to `http://127.0.0.1:11434/v1` and the model to the exact installed name, such as `gemma3:4b`. Leave the API key blank for the normal local Ollama server.
4. Choose **Test model connection**, then **Save connection settings**. The connection test runs a short text request; it confirms connectivity, not vision accuracy.
5. On **Source**, choose **Model extraction (Ollama / compatible provider)**, attach the screenshot and choose **Analyze source**.
6. Review and correct the extracted document, then choose **Import selected**.

The browser sends image data to your local Ollama API using `/v1/chat/completions`. Ollama returns declarative JSON; the importer validates it and builds the Foundry document and supported automation. With a locally downloaded model, inference stays on that computer. This module does not download or start Ollama/models automatically.

If direct requests are blocked, run the included companion on the browser's computer, allow the exact Foundry origin, and enter its URL and token. The companion relays the same model request to local Ollama. It does not require exposing Ollama on your network. A missing model or a model without image support must be corrected in Ollama; a text-only model cannot directly read a screenshot.

Long sources plus the extraction schema and output need a sufficiently large model context. Ollama's OpenAI-compatible endpoint uses the model's configured context; see [Ollama's context-size instructions](https://docs.ollama.com/api/openai-compatibility). Use smaller batches or configure a larger context when needed. If generation is cut off, increase the importer's maximum output tokens within the model's context budget.

The built-in reader remains available without Ollama or model setup. Clear OCR text can also be moved into the editable source box and then analyzed with a text model.

## Optional companion for web links and CORS

The companion uses Python 3.10+ and only the standard library. Run it on the same computer as your Foundry browser.

- Windows: double-click `companion/start-windows.bat`.
- macOS/Linux: run `sh companion/start.sh`.

Enter the exact Foundry **origin** from your browser: protocol + hostname + port, without `/game` or another path. For example: `http://localhost:30000` or `https://my-foundry.example`.

Then copy the printed **Bridge URL** and **Bridge token** into **Model & connection**, save the settings, and leave the companion running. The token is entered separately from its URL. After restarting the companion, enter its new token.

Alternatively:

```sh
python3 companion/bridge.py --allow-origin http://localhost:30000
```

The companion binds only to `127.0.0.1`. Web-source fetching validates and pins public IP addresses on every redirect, applies response limits, and extracts readable HTML without executing scripts. It does not fetch private-network web sources or bypass login/captcha pages. The configured model endpoint can still be a local model service. Browser private-network or HTTPS policies may require allowing local connections; if that setup is unsuitable, use pasted text and direct model access where permitted.

## Review, duplicates, destinations, and undo

- **Needs correction:** required values are missing or Foundry's live document schema rejects the data. Correct the JSON/source and rebuild.
- **Review:** unsupported, ambiguous, or conditional behavior is reported with the original text.
- **Existing content:** the same name, document/item type, and explicit rules edition already exist. Default behavior reuses that document. Unknown-edition content is not silently substituted.
- **Ready:** the generated fields passed the available validation and have no current warnings. This is not a claim that a live combat scenario has been tested.

The duplicate check indexes installed compendiums without loading every complete document, then reads only chosen references. Granted features also match their parent and level, so two classes do not accidentally share different versions of Spellcasting, and two races do not accidentally share same-named traits. Ambiguous matches block default reuse. Choose **Create new copies** when intentional. Existing documents are not overwritten.

World imports use an optional folder. Under **Choose destination compendiums**, choose an unlocked pack of the appropriate document type for actors, items, journals, and tables. All selected parents bring their required child features. An existing/reused class does not create orphan feature copies.

Import history keeps the most recent 25 batches. Each write records its session and created document identifiers. Creation failures trigger best-effort rollback. Undo checks document content, preserves edited documents and their dependencies, and reports deletion failures. Imports and undo operations share one lock across the API and importer windows in the same browser. Features referenced by a later retained import batch are kept during undo. This alpha does not implement a cross-client distributed transaction lock. If a browser/server process crashes mid-write, inspect documents carrying the batch's `flags.telys-dnd-importer.sessionId` before retrying.

## Developer API

```js
const importer = game.modules.get("telys-dnd-importer").api;
importer.open();

const bundle = importer.parseText(sourceText, {kind: "creature", rules: "2014"});
const plan = await importer.prepare(bundle, {includePacks: true});
// Inspect plan.nodes[*].errors / warnings / data before importing.
const batch = await importer.import(plan, {
  selected: plan.roots,
  duplicates: "skip",
  folderName: "Tely's DND Imports",
  packs: {} // e.g. {Item: "world.my-items"}
});
// Later, explicitly undo this batch:
await importer.undo(batch.id);
```

`parseText`, `normalizeBundle`, and `compileBundle` can run independently of Foundry. `prepare`, import, and undo require a GM in a compatible world. Normalized JSON is an importer format, not arbitrary Foundry JSON. See `scripts/prompt.mjs` for the declarative fields and `examples/` for original test content.

## Validate and package

```sh
node tools/check.mjs
node --test tests/*.test.mjs
python3 -m unittest discover -s companion -p 'test_*.py' -v
python3 tools/package.py
```

No build or npm install is needed to use the installed Foundry module. For a source checkout, first run `python3 tools/fetch-vendor.py` to restore and verify the pinned OCR distribution files before running checks or packaging. The ZIP includes the third-party image reader and English language data; see THIRD-PARTY-NOTICES.md. Tests use Node 20+ and Python 3.10+. Browser QA uses a separate scratch-only Foundry mock, not a bundled licensed Foundry runtime.

For live acceptance, import the watcher, place it and a target on a test scene, and verify its Claw attack, Spark Bolt linked condition/save, repeat-save expiry, Steam Cone template/recharge, and fixed Multiattack sequence under your Midi-QOL settings. Import `training-spells.txt` and `training-class.txt`; verify the spell activities and class advancement on a test character. Finally undo each batch, including a batch with an edited document. These live checks remain outstanding in this alpha.

## Implementation references

- [Foundry v14 applications and ApplicationV2](https://foundryvtt.com/api/modules/foundry.applications.html)
- [Foundry v14 ActiveEffect schema](https://foundryvtt.com/api/classes/foundry.documents.BaseActiveEffect.html)
- [Foundry v14 effect duration data](https://foundryvtt.com/api/interfaces/foundry.documents.types.EffectDurationData.html)
- [Foundry v14 TableResult schema](https://foundryvtt.com/api/classes/foundry.documents.BaseTableResult.html)
- [D&D5e 5.3.3 activity data models](https://github.com/foundryvtt/dnd5e/tree/release-5.3.3/module/data/activity)
- [D&D5e 5.3.3 item and advancement data models](https://github.com/foundryvtt/dnd5e/tree/release-5.3.3/module/data)
- [Midi-QOL v14 activity mixin](https://gitlab.com/tposney/midi-qol/-/blob/v14/src/module/activities/MidiActivityMixin.ts)
- [Midi-QOL v14 handlers and OverTime implementation](https://gitlab.com/tposney/midi-qol/-/blob/v14/src/module/utils.ts)
- [Midi-QOL v14 documentation](https://gitlab.com/tposney/midi-qol/-/blob/v14/README.md)

The module's implementation is MIT licensed. Source game content supplied by users or read from installed compendiums retains its own licensing. The bundled training examples are original test content.

## Publishing updates

The source repository stores code, licenses and a pinned SHA-256 asset inventory. Large OCR distributions are restored by `tools/fetch-vendor.py`; their original verified files are included in the installable release ZIP.

Bump the matching versions in `module.json`, `package.json` and `scripts/constants.mjs`, set the manifest download URL to that version's release ZIP, and push to `main`. The Publish Foundry module workflow restores OCR assets, runs all tests and integrity checks, creates the installable ZIP, and publishes it together with `module.json` in a versioned GitHub release. A stable `releases/latest/download/module.json` URL lets installed copies discover those updates. The workflow can also be run manually from Actions. Published tags are immutable; use a new version for each changed release.
