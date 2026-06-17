import type ATOZPlugin from '../main';
import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Notice, prepareFuzzySearch } from 'obsidian';
import { SnippetsItem } from '../types';
import { buildTriggerRegex } from '../utils';

// EditorSuggest 를 상속해서 Obsidian suggestion 시스템에 연결
export class SnippetsSuggestions extends EditorSuggest<SnippetsItem> {
    plugin: ATOZPlugin;

    constructor(plugin: ATOZPlugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line).substring(0, cursor.ch);
        const trigger = this.plugin.settings.snippetTrigger;
        const match = line.match(buildTriggerRegex(trigger));
        return match ? {
            start: { line: cursor.line, ch: match.index! },
            end: cursor,
            query: match[1] ?? ""
        } : null;
    }

    getSuggestions(ctx: EditorSuggestContext): SnippetsItem[] {
        if (this.plugin.settings.snippetLimit < 1) return [];
        const content = ctx.query.trim().replace(/_/g, ' ');
        const query = content.toLowerCase();
        const fuzzy = prepareFuzzySearch(query);

        const SNIPPETS_RECENT_WEIGHT = 0.0000001;
        const suggestions: SnippetsItem[] = this.plugin.settings.snippets
            .map(text => {
                const result = fuzzy(text.toLowerCase());
                const lastUsed = this.plugin.settings.recentSnippets[text] ?? 0;
                return {
                    item: { kind: 'snippet' as const, content: text },
                    score: result ? result.score : -1,
                    recent: lastUsed
                };
            })
            .filter(res => res.score !== -1)
            .map(res => ({
                item: res.item,
                finalScore: res.score + res.recent * SNIPPETS_RECENT_WEIGHT
            }))
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, this.plugin.settings.snippetLimit)
            .map(res => res.item);

        const hasExactMatch = this.plugin.settings.snippets.includes(content);
        if (content.length > 0 && !hasExactMatch) {
            suggestions.push({ kind: 'add', content });
        }

        return suggestions;
    }

    renderSuggestion(item: SnippetsItem, el: HTMLElement) {
        if (item.kind === 'add') {
            el.setText(`새 조각글로 추가: ${item.content}`);
            return;
        }

        el.setText(item.content);
    }

    selectSuggestion(item: SnippetsItem) {
        if (!this.context) return;
    
        const { editor, start, end } = this.context;
        const content = item.content.replace(/_/g, ' ');
        editor.replaceRange(content, start, end);
    
        if (item.kind === 'add' && !this.plugin.settings.snippets.includes(content)) {
            this.plugin.settings.snippets.push(content);
            new Notice(`조각글 등록 완료: "${content}"`);
        }
    
        this.recordRecent(content);
    }

    private recordRecent(content: string) {
        const recent = this.plugin.settings.recentSnippets;
        recent[content] = Date.now();
        const limit = this.plugin.settings.snippetLimit;
        this.plugin.settings.recentSnippets = Object.fromEntries(
            Object.entries(recent)
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit)
        );
        this.plugin.debouncedSave();
    }
}
