# a to z

English | [한국어](README.ko.md)

`a to z` is an Obsidian plugin designed to streamline writing workflows, with particular support for Korean users.

It brings frequently used editing actions, source-linked Later notes, frontmatter and topic management, snippets, and symbol input together as commands and settings.

## Features

| Area | Main features |
| --- | --- |
| Editing | Copy or cut an entire document, copy or cut the current line, delete a paragraph, and focus the main editor |
| Note organization | Move selected text to source-specific Later notes, move content to a new note, move the current file, and clean up tabs |
| Property management | Edit and clean up `topics`, `date`, and other supported properties |
| Input assistance | Insert reusable snippets and symbols, and delete matching symbol pairs together |

The plugin automatically uses Korean UI text when Obsidian's interface language is Korean. All other interface languages use English.

## Installation

### Community plugins

Once the plugin is available in the Obsidian Community directory:

1. Open **Settings → Community plugins**.
2. Search for **a to z**.
3. Select **Install**, then enable the plugin.

### Manual installation

1. Download or clone this repository.
2. Install the dependencies.

```bash
npm install
```

3. Build the plugin.

```bash
npm run build
```

4. Create the following folder inside your vault:

```text
<your-vault>/.obsidian/plugins/atoz/
```

5. Copy these files into the folder:

```text
manifest.json
main.js
styles.css
```

6. Reload Obsidian and enable **a to z** under **Settings → Community plugins**.

The minimum supported Obsidian version is `1.13.0`. The plugin supports both desktop and mobile.

### Optional CSS snippets

[`extras/delete_unnecessary_filemenues.css`](extras/delete_unnecessary_filemenues.css) is a personal CSS snippet that hides selected items from Obsidian file menus. It is not included in or loaded by the plugin.

[`extras/mobile_notice_bottom.css`](extras/mobile_notice_bottom.css) places notices at the bottom of the screen on phones. It uses `!important` because Obsidian's notice position otherwise takes precedence. This snippet is also optional and is not loaded by the plugin.

To use either snippet:

1. Copy the file to `<your-vault>/.obsidian/snippets/`.
2. Open **Settings → Appearance → CSS snippets**.
3. Reload snippets and enable the snippet you copied.

The snippet uses `:has()` selectors. This can affect menu rendering performance and may also hide menu items from other plugins that use the same icons. Enable it only if you want this behavior.

## Recommended initial settings

After enabling the plugin, open **Settings → a to z** and configure only the features you need.

| Setting | Default | Description |
| --- | --- | --- |
| Enable cursor centering | Off | Keeps the cursor near the center of the screen while editing. |
| Reading time basis | Without spaces | Character-count basis used to estimate reading time. |
| Reading speed | `500` | Personal reading speed in characters per minute. |
| Target presets | `1,000±50`, `1,500±75`, `2,000±100`, `3,000±150` | Writing targets and their allowed ranges. |
| Snippet trigger character | `@` | Opens snippet suggestions while typing. |
| Snippet suggestion limit | `5` | Maximum number of snippet suggestions shown. |
| Snippet list | Empty | Stores reusable text, one snippet per line. |
| Symbol trigger character | `~` | Opens symbol suggestions while typing. |
| Symbol suggestion limit | `5` | Maximum number of symbol suggestions shown. |
| Symbol list | Default symbol set | Configures each symbol's ID, displayed character, and optional closing character. |
| Work note path | `work.md` | File opened by the **Open work note** command. |

Use **Reset all settings** to restore these defaults.

## Common workflows

### Save text for Later

1. Select text in a regular note or `work.md`, or place the cursor on a line.
2. Run **Move selection or current line to Later**.
3. The content is saved in `<source-name>_later.md` and removed from the source note.
4. Select an entry in the later sidebar to move it back to the source note.

Each Later note is linked to its source by the `later: "[[Source note]]"` property.

### Clean up frontmatter

**Clean up properties** checks Markdown files in the vault against the supported property list:

```yaml
date:
topics:
title:
description:
cssclasses:
aliases:
tags:
later:
target-characters:
target-tolerance:
```

Unsupported empty properties are removed automatically. Files containing unsupported properties with values are opened in new tabs for review. `log.md` and the configured work note are excluded.

### Insert snippets and symbols

By default, type `@` followed by a search term to open snippet suggestions. Selecting an existing snippet replaces the typed range. A new snippet can be added directly from the suggestion list.

Type `~` followed by a symbol ID to open symbol suggestions. A symbol with a closing character wraps selected text, or inserts the pair and places the cursor between them. Pressing Backspace between a matching pair deletes both characters.

## Commands

| Command | Description |
| --- | --- |
| **Toggle cursor centering** | Keeps the cursor near the center of the screen while editing. |
| **Copy entire document** | Copies the entire current document to the clipboard. |
| **Cut entire document** | Copies the entire current document, then clears it. |
| **Copy** | Copies the selection, or the current line when nothing is selected. |
| **Cut** | Cuts the selection, or the current line when nothing is selected. |
| **Cut content to new note** | Moves the selected lines or entire document to a new note in the vault root. |
| **Delete paragraph** | Deletes the line containing the cursor. |
| **Focus main editor** | Returns focus to the main Markdown editor. |
| **Toggle mobile toolbar** | Shows or hides the bottom toolbar on mobile. |
| **Move current file** | Moves the current Markdown file to another folder in the vault. |
| **Edit topics** | Searches vault notes, headings, and existing block IDs to add, remove, or re-alias topic wikilinks. |
| **Insert today's date property** | Adds today's date only when the `date` property is absent. |
| **Update date property to today** | Replaces the `date` value with today's date. |
| **Clean up properties** | Removes unsupported empty properties and opens files that need review. |
| **View document info** | Shows character counts, reading time, and the writing target in the left sidebar. |
| **Set writing target for current document** | Assigns one of the configured target presets or clears the current target. |
| **Open work note** | Opens the configured work note. |
| **Close all tabs** | Closes unpinned tabs in the main workspace. |
| **Move selection or current line to later** | Moves the exact selection or current line into a source-linked later note. |
| **Open later sidebar** | Shows later entries linked to the current note. |
| **Select previous sidebar item** | Selects the previous entry in the later sidebar. |
| **Select next sidebar item** | Selects the next entry in the later sidebar. |
| **Take selected sidebar item** | Moves the selected later entry back into the source editor. |
| **Resolve later links** | Keeps one linked later note when multiple notes point to the same source. |

Ribbon icons provide quick access to the work note, mobile toolbar, Later sidebar, document info, and quick slots.

## Documentation

Detailed feature documentation is currently available in Korean:

| Document | Topic |
| --- | --- |
| [cursor-center.md](docs/cursor-center.md) | Cursor centering |
| [cut-copy.md](docs/cut-copy.md) | Copy and cut actions |
| [cut-create-new-md.md](docs/cut-create-new-md.md) | Move content to a new note |
| [delete-paragraph.md](docs/delete-paragraph.md) | Delete the current paragraph |
| [focus-root-leaf.md](docs/focus-root-leaf.md) | Focus the main editor |
| [move-current-file.md](docs/move-current-file.md) | Move the current file |
| [work.md](docs/work.md) | Work note and tab cleanup |
| [later-sidebar.md](docs/later-sidebar.md) | Source-specific Later notes and sidebar |
| [edit-topics.md](docs/edit-topics.md) | Topic editing |
| [date-property.md](docs/date-property.md) | Date properties |
| [lint-properties.md](docs/lint-properties.md) | Property cleanup |
| [document-info.md](docs/document-info.md) | Character counts, reading time, and writing targets |
| [mobile-toolbar.md](docs/mobile-toolbar.md) | Mobile toolbar visibility |
| [snippets.md](docs/snippets.md) | Snippet suggestions |
| [symbols.md](docs/symbols.md) | Symbol suggestions and paired deletion |

## Development

Source files are located in `src/`. The build output is generated as `main.js` in the repository root.

```bash
npm run dev
```

Starts esbuild in watch mode with `src/main.ts` as the entry point and generates a source-mapped `main.js`.

```bash
npm run build
```

Runs the TypeScript type check and creates a production bundle.

```bash
npm run lint
```

Checks the project with ESLint and the recommended Obsidian plugin rules.

```bash
npm run version
```

Runs `version-bump.mjs`, then stages `manifest.json` and `versions.json`.

## Project structure

```text
.
├── manifest.json        # Obsidian plugin metadata
├── main.js              # Bundle generated by esbuild
├── styles.css           # Plugin styles
├── extras/              # Optional CSS snippets not loaded by the plugin
├── src/
│   ├── locales/         # English and Korean UI text
│   ├── main.ts          # Plugin loading, commands, and events
│   ├── setting.ts       # Settings tab
│   ├── types.ts         # Settings types and defaults
│   ├── utils.ts         # Shared utilities
│   └── features/        # Feature implementations
└── docs/                # Korean feature documentation
```
