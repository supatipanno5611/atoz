import type ATOZPlugin from '../main';
import { MarkdownView, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, prepareFuzzySearch } from 'obsidian';
import { SymbolItem } from '../types';
import { buildTriggerRegex } from '../utils';

export class SymbolsFeature {
    constructor(private plugin: ATOZPlugin) {}

    // 스마트 삭제 로직을 별도 메서드로 분리
    handleSmartBackspace(evt: KeyboardEvent) {
        if (evt.key !== 'Backspace') return;

        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        const editor = view.editor;
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);

        // 커서 앞뒤 문자가 PAIRS에 정의된 쌍인지 확인
        if (cursor.ch > 0 && cursor.ch < line.length) {
            const prevChar = line[cursor.ch - 1];
            const nextChar = line[cursor.ch];

            const pair = prevChar && this.plugin.settings.symbols.find(
                s => s.symbol === prevChar && s.closing
            );
            if (pair && pair.closing === nextChar) {
                editor.replaceRange("",
                    { line: cursor.line, ch: cursor.ch - 1 },
                    { line: cursor.line, ch: cursor.ch + 1 }
                );
                evt.preventDefault();
                evt.stopPropagation();
            }
        }
    }
}

// EditorSuggest 를 상속해서 Obsidian suggestion 시스템에 연결
export class SymbolSuggestions extends EditorSuggest<SymbolItem> {
    plugin: ATOZPlugin;
    private autoInserted = false;

    constructor(plugin: ATOZPlugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        this.autoInserted = false;
        const line = editor.getLine(cursor.line).substring(0, cursor.ch);
        const trigger = this.plugin.settings.symbolTrigger;
        const match = line.match(buildTriggerRegex(trigger));
        return match ? {
            start: { line: cursor.line, ch: match.index! },
            end: cursor,
            query: match[1] ?? ""
        } : null;
    }

    getSuggestions(ctx: EditorSuggestContext): SymbolItem[] {
        if (this.plugin.settings.symbolLimit < 1) return [];
        const query = ctx.query.toLowerCase();
        const fuzzy = prepareFuzzySearch(query);

        const SYMBOL_RECENT_WEIGHT = 0.0000001;
        const suggestions: SymbolItem[] = this.plugin.settings.symbols
            .map(item => {
                const result = fuzzy(item.id.toLowerCase());
                const lastUsed = this.plugin.settings.recentSymbols[item.id] ?? 0;
                return {
                    item,
                    score: result ? result.score : -1,
                    recent: lastUsed
                };
            })
            .filter(res => res.score !== -1)
            .map(res => ({
                item: res.item,
                finalScore: res.score + res.recent * SYMBOL_RECENT_WEIGHT
            }))
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, this.plugin.settings.symbolLimit)
            .map(res => res.item);

        if (query.length > 0 && suggestions.length === 1 && !this.autoInserted) {
            const targetItem = suggestions[0];
            if (!targetItem) return suggestions;

            const trigger = this.plugin.settings.symbolTrigger;
            if (targetItem.symbol.includes(trigger)) {
                return suggestions;
            }

            this.autoInserted = true;

            window.setTimeout(() => {
                if (!this.context) return;
                this.selectSuggestion(targetItem);
                this.close();
            }, 0);

            return suggestions;
        }
        return suggestions;
    }

    renderSuggestion(item: SymbolItem, el: HTMLElement) {
        el.setText(`${item.id} ${item.symbol}`);
    }

    selectSuggestion(item: SymbolItem) {
        if (!this.context) return;

        const { editor, start, end } = this.context;

        if (item.closing) {
            const selection = editor.getSelection();

            if (selection) {
                editor.replaceRange(item.symbol + selection + item.closing, start, end);
            } else {
                editor.replaceRange("", start, end);
                editor.replaceSelection(item.symbol + item.closing);

                const cursor = editor.getCursor();
                editor.setCursor({
                    line: cursor.line,
                    ch: cursor.ch - item.closing.length
                });
            }
        } else {
            editor.replaceRange(item.symbol, start, end);
        }

        this.recordRecent(item);
    }

    private recordRecent(item: SymbolItem) {
        const recent = this.plugin.settings.recentSymbols;
        recent[item.id] = Date.now();
        const limit = this.plugin.settings.symbolLimit;
        this.plugin.settings.recentSymbols = Object.fromEntries(
            Object.entries(recent)
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit)
        );
        this.plugin.debouncedSave();
    }
}
