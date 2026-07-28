# Changelog

## 1.0.3 — 2026-07-28

- Compatibility widened to **140.0 – 153.\*** after verifying the add-on on
  Thunderbird 153.0.1: every referenced element ID, `item-id`, class, `<key>`
  and tab mode still exists, and a real run confirmed the spaces buttons get
  hidden, the shortcuts get disabled, the Tools menu entry appears and the prefs
  are applied. No code changes were needed.
- Documented the Experiment API deprecation on the Release channel
  (`extensions.experiments.suppressed`), currently targeting the 2027 ESR.

## 1.0.2 — 2026-07-28

First working release.

- Switch off the Address Book, Calendar, Tasks and Chat spaces individually.
  Mail and Settings always stay.
- **Tools → Space Control…** opens the settings panel.
- Pinned to Thunderbird/Betterbird 140 ESR (`strict_max_version: 140.*`). The
  element IDs it hides were read out of that version's `omni.ja`; they have to
  be re-verified before the range is widened.

### Fixed since 1.0.0

- The add-on installed and showed as enabled but did nothing at all, with no
  settings panel. The manifest declared `events: ["startup"]` for the experiment
  API without implementing `onStartup()`, and Thunderbird calls
  `api.onStartup()` unguarded (`SchemaAPIManager.onStartup` in
  `ExtensionCommon.sys.mjs`), so the call threw inside the startup promise chain
  and killed initialisation. Nothing was logged anywhere obvious.
- Settings were only reachable through the Add-ons Manager detail view's
  Preferences tab, which is easy to conclude does not exist. Hence the Tools
  menu entry.
- `build.sh` no longer drops the XPI into the profile's `extensions/` directory
  for a first install: Thunderbird treats that as a side-load and re-applies
  `extensions.autoDisableScopes` on every start, switching the add-on back off.

1.0.0 and 1.0.1 were never usable and were not released.
