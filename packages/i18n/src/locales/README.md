# Locales

## File Structure

Each locale lives in a directory named `language_REGION`:

- `language` — two-letter [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) code, lowercase;
- `REGION` — two-letter [ISO 3166-1](https://en.wikipedia.org/wiki/ISO_3166-1) code, uppercase.

Examples: `en_US`, `ru_RU`, `pt_BR`.

`en_US` is the main and reference locale: it is the default and the fallback, and every other locale must have the same files and the same keys.

### Files

- **ui.json** — interface strings of the showcase and the control panel. Its keys are available without a prefix: `t('search.title')`.

Add `messages.json` (dialogs, errors, notifications) or `preferences.json` (settings) when the first such string appears, and wire the new file in `../index.ts`.

## Key Structure in ui.json

```
common.*   — shared labels (back, close, ...)
search.*   — search screen
title.*    — title page: actions, kinds, meta line
state.*    — screen states shared by screens: empty, not connected, errors
connect.*  — showcase: connecting a device with a code
profiles.* — showcase: who's watching, profile PIN
panel.*    — control panel: navigation, sections, dialogs
shell.*    — TV app wrapper: server address screen
```

Group keys by screen or entity, keep nesting shallow, and reuse `common.*` instead of duplicating labels.

## Adding Keys

1. Add the key to `en_US`.
2. Add it to every other locale.
3. Run `pnpm i18n:check` from the repository root — it fails on missing, extra or empty keys.

## Adding a Language

1. Copy the `en_US` directory and rename it to the new `language_REGION` code.
2. Translate every value.
3. Add the language to `../language.ts` and its messages to `../index.ts`.
4. Run `pnpm i18n:check`.

Pull requests to this repository are not accepted. To contribute a translation, open an issue and attach the translated files.

## Translation Guidelines

1. Keep placeholders such as `{count}` and `{name}` unchanged.
2. Plural strings list their forms separated by `|`: two for English (`{n} season | {n} seasons`), as many as the language needs otherwise (Russian has three). A language with more than two forms needs a rule in `../plural.ts`.
3. Mind the context: the same English word may need different translations on different screens.
4. Keep labels short: the interface is read from a couch, on a TV.
5. Keep terminology consistent across files.
