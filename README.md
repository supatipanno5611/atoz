# a to z

English | [한국어](README.ko.md)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/supatipanno5611)

`a to z` is an Obsidian plugin designed to streamline writing workflows, with particular support for Korean users.

It brings frequently used editing actions, source-linked Later notes, note versions, frontmatter and topic management, note info, snippets, symbol input, and a sleep log together as commands and settings.

## Features

| Area | Main features |
| --- | --- |
| Editing | Copy or cut an entire note, copy or cut the selection or current line, delete the current line, and focus the main editor |
| Note organization | Move selected text to source-specific Later notes, move the current file, clean up tabs, and keep auto-generated note lists |
| Versions | Save numbered versions of a note, revert to one, and see what changed between two versions |
| Property management | Edit and clean up `topics`, `date`, and other supported properties |
| Note info | Character counts for the note or selection, reading time, and per-note writing targets |
| Input assistance | Insert reusable snippets and symbols, and delete matching symbol pairs together |
| Navigation | Quick slots for files, command slots, and cycling through sidebar tabs |
| Sleep log | Record sleep and wake times with one button and view them as a 24-hour chart in the Daynight sidebar |

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

## Recommended initial settings

After enabling the plugin, open **Settings → a to z** and configure only the features you need.

| Setting | Default | Description |
| --- | --- | --- |
| Enable cursor centering | Off | Keeps the cursor near the center of the screen while editing. |
| Enable standalone sidebar ribbon | Off | Pins the ribbon to the left edge when the left sidebar is closed. Mobile and tablet only. |
| Reading time basis | Without spaces | Character-count basis used to estimate reading time. |
| Reading speed | `500` | Personal reading speed in characters per minute. |
| Target presets | `1,000±50`, `1,500±75`, `2,000±100`, `3,000±150` | Writing targets. Each preset is a target ± tolerance, a range (minimum to maximum), a minimum, or a maximum. |
| Snippet trigger character | `@` | Opens snippet suggestions while typing. |
| Snippet suggestion limit | `5` | Maximum number of snippet suggestions shown. |
| Snippet list | Empty | Stores reusable text, one snippet per line. |
| Symbol trigger character | `~` | Opens symbol suggestions while typing. |
| Symbol suggestion limit | `5` | Maximum number of symbol suggestions shown. |
| Symbol list | Default symbol set | Configures each symbol's ID, displayed character, and optional closing character. |
| Work note path | `work.md` | File opened by the **Open work note** command. |
| Later note folder | Empty (vault root) | Folder where source-specific Later notes are created. |
| Version note folder | Empty (next to the source note) | Folder where version notes are created. |
| Sleep record folder | Empty (`sleep`) | Folder where monthly sleep records are saved. |
| Number of slots | `4` | Number of slots shown in command slot modals. |

Use **Reset all settings** to restore these defaults.

## Common workflows

### Save text for Later

1. Select text in a regular note or `work.md`, or place the cursor on a line.
2. Run **Later: Send selection or current line**.
3. The content is saved in `<source-name>_later.md` and removed from the source note.
4. Select an entry in the later sidebar to move it back to the source note.

Each Later note is linked to its source by the `later: "[[Source note]]"` property.

### Save and compare versions

1. Run **Version: Save current state** in a note. A version note named `<number>_<timestamp>` is created with a `version` property that links back to the source.
2. Run **Version: Revert to saved version** to replace the note body with a saved version. The current frontmatter is kept.
3. Run **Version: Open comparison view** to see what changed between two points: saved versions, the current note, or an empty note. Changes are highlighted down to the word, and moved paragraphs are marked. Version names can be changed from the comparison view.

### Keep note lists

Set `notelist: true` in a note's frontmatter. The plugin fills the note body with a `- [[link]]` list of every note that links to it, sorted by name. Lists refresh when Obsidian starts and when you run **Note list: Refresh all**. Notes whose body contains anything other than such a list are skipped, so hand-written content is never overwritten.

### Log sleep with Daynight

Open the Daynight sidebar from the moon ribbon icon or the **Daynight: Open sidebar** command. Press the button at the bottom to record **Sleep now** or **Wake up now**. Records are appended to a monthly `sleep-YYYY-MM.md` table. The sidebar shows the current state, a 24-hour chart that steps through sleep periods with `‹` and `›`, and the three most recent records. Only the last record can be edited or deleted, so sleep and wake records always alternate.

### Clean up frontmatter

**Clean up properties in entire vault** checks Markdown files in the vault against the supported property list:

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
min-characters:
max-characters:
version:
notelist:
```

Unsupported empty properties are removed automatically. Files containing unsupported properties with values are opened in new tabs for review. `log.md` and the configured work note are excluded.

### Insert snippets and symbols

By default, type `@` followed by a search term to open snippet suggestions. Selecting an existing snippet replaces the typed range. A new snippet can be added directly from the suggestion list.

Type `~` followed by a symbol ID to open symbol suggestions. A symbol with a closing character wraps selected text, or inserts the pair and places the cursor between them. Pressing Backspace between a matching pair deletes both characters.

## Commands

| Command | Description |
| --- | --- |
| **Toggle Cursor centering** | Keeps the cursor near the center of the screen while editing. |
| **Copy entire note** | Copies the entire current note to the clipboard. |
| **Cut entire note** | Copies the entire current note, then clears it. |
| **Copy selection or current line** | Copies the selection, or the current line when nothing is selected. |
| **Cut selection or current line** | Cuts the selection, or the current line when nothing is selected. |
| **Delete current line** | Deletes the line containing the cursor. |
| **Focus main editor** | Returns focus to the main Markdown editor. |
| **Toggle mobile toolbar** | Shows or hides the bottom toolbar on mobile. |
| **Toggle standalone sidebar ribbon** | Turns the standalone sidebar ribbon on or off. |
| **Move current file** | Moves the current Markdown file to another folder in the vault. |
| **Edit topics** | Searches vault notes, headings, and existing block IDs to add, remove, or re-alias topic wikilinks. |
| **Date: Insert today's date if empty** | Adds today's date only when the `date` property is absent. |
| **Date: Change to today's date** | Replaces the `date` value with today's date. |
| **Clean up properties in entire vault** | Removes unsupported empty properties and opens files that need review. |
| **Note info: Open sidebar** | Shows character counts, reading time, and the writing target in the left sidebar. |
| **Note info: Set writing target** | Assigns a configured preset or a typed target, or clears the current target. |
| **Open work note** | Opens the configured work note. |
| **Close all unpinned tabs** | Closes unpinned tabs in the main workspace. |
| **Later: Send selection or current line** | Moves the exact selection or current line into a source-linked later note. |
| **Later: Open sidebar** | Shows later entries linked to the current note. |
| **Later: Select previous item** | Selects the previous entry in the later sidebar. |
| **Later: Select next item** | Selects the next entry in the later sidebar. |
| **Later: Insert selected item into source** | Moves the selected later entry back into the source editor. |
| **Later: Resolve duplicate links** | Keeps one linked later note when multiple notes point to the same source. |
| **Version: Save current state** | Saves the current note as a numbered version note. |
| **Version: Revert to saved version** | Replaces the note body with a saved version. |
| **Version: Open comparison view** | Shows what changed between two versions of the current note. |
| **Note list: Refresh all** | Rebuilds the body of every note with `notelist: true`. |
| **Daynight: Open sidebar** | Shows the sleep log in the right sidebar. |
| **Left/Right sidebar: next/previous tab** | Cycles through the tabs of the left or right sidebar. |
| **Quick slot: Add or remove current file** | Assigns the current file to a quick slot or clears a slot. |
| **Quick slot: Choose and open** / **Quick slot: Open slot 1–4** | Opens a file assigned to a quick slot. |
| **Quick slot: Clear all** | Clears every quick slot. |
| **Command slot: Assign or clear command** | Assigns a command to a command slot. |
| **Command slot: Choose and run** | Runs a command assigned to a command slot. |
| **Command slot: Clear all** | Clears every command slot. |
| **Restart input method fix** | Restarts the Korean input method fix. |

Ribbon icons provide quick access to the work note, mobile toolbar, Later sidebar, bookmarking the active tab, quick slots 1–4, note info, and the Daynight sidebar.

## Documentation

Detailed feature documentation is currently available in Korean:

| Document | Topic |
| --- | --- |
| [cursor-center.md](docs/cursor-center.md) | Cursor centering |
| [cut-copy.md](docs/cut-copy.md) | Copy and cut actions |
| [delete-paragraph.md](docs/delete-paragraph.md) | Delete the current line |
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
| [daynight.md](docs/daynight.md) | Daynight sleep log sidebar |
| [versions.md](docs/versions.md) | Saving, reverting, and comparing versions |
| [note-list.md](docs/note-list.md) | Auto-generated note lists |
| [slots.md](docs/slots.md) | Quick slots and command slots |
| [others.md](docs/others.md) | Sidebar tab cycling, standalone ribbon, file menu items, bookmarks, and the Korean input method fix |

## Credits

The snippet and symbol suggestions include code adapted from [slash-snippets-plugin](https://github.com/echo-saurav/slash-snippets-plugin) by Saurav, used under the MIT License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full license text.

## Support

If this plugin helps your writing, you can support its development on [Buy Me a Coffee](https://buymeacoffee.com/supatipanno5611).

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

```bash
npm run release
```

Interactively shows the latest release tag and commits since that tag, then offers major, minor, and patch version choices. After confirmation, it verifies a clean `main` branch and the remote state, updates all version metadata, runs lint and build checks, creates the release commit and tag, and atomically pushes both `main` and the tag. The existing GitHub Actions workflow then builds, attests, and publishes the release. Commit the release script itself before using it for the first time.

## Project structure

```text
.
├── manifest.json        # Obsidian plugin metadata
├── main.js              # Bundle generated by esbuild
├── styles.css           # Plugin styles
├── src/
│   ├── locales/         # English and Korean UI text
│   ├── main.ts          # Plugin loading, commands, and events
│   ├── setting.ts       # Settings tab
│   ├── types.ts         # Settings types and defaults
│   ├── utils.ts         # Shared utilities
│   └── features/        # Feature implementations
└── docs/                # Korean feature documentation
```
