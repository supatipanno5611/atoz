import { Editor, ItemView, MarkdownView, SuggestModal, WorkspaceLeaf } from 'obsidian';
import type ATOZVER6Plugin from '../main';
import { ClipboardEntry } from '../types';

export const VIEW_TYPE_CLIPBOARD = 'atoz-clipboard-view';

export class ClipboardFeature {
    constructor(private plugin: ATOZVER6Plugin) {}

    addEntry(text: string): void {
        const history = this.plugin.settings.clipboardHistory;
        if (history[0]?.text === text) return;

        history.unshift({ id: Date.now().toString(), text });

        const limit = this.plugin.settings.clipboardHistoryLimit;
        if (history.length > limit) {
            this.plugin.settings.clipboardHistory = history.slice(0, limit);
        }

        this.plugin.debouncedSave();
        this.refreshView();
    }

    removeEntry(id: string): void {
        this.plugin.settings.clipboardHistory = this.plugin.settings.clipboardHistory.filter(e => e.id !== id);
        this.plugin.debouncedSave();
        this.refreshView();
    }

    pasteSelected(editor: Editor): void {
        const text = this.plugin.selectedClipboardText;
        if (!text) return;
        editor.replaceSelection(text);
    }

    private refreshView(): void {
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLIPBOARD).forEach(leaf => {
            if (leaf.view instanceof ClipboardView) leaf.view.render();
        });
    }

    async activateView(): Promise<void> {
    const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLIPBOARD);
    if (existing.length > 0) {
        this.plugin.app.workspace.revealLeaf(existing[0]!);
        return;
    }
    const leaf = this.plugin.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_CLIPBOARD, active: true });
    this.plugin.app.workspace.revealLeaf(leaf);
    }
}

export class ClipboardView extends ItemView {
    private selectedEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZVER6Plugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_CLIPBOARD; }
    getDisplayText(): string { return '클립보드'; }
    getIcon(): string { return 'clipboard-list'; }

    async onOpen(): Promise<void> { this.render(); }
    async onClose(): Promise<void> {}

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.selectedEl = null;

        const history = this.plugin.settings.clipboardHistory;
        const previewLength = this.plugin.settings.clipboardPreviewLength;

        if (history.length === 0) {
            container.createEl('div', { cls: 'atoz-clipboard-empty', text: '복사한 텍스트가 없습니다.' });
            return;
        }

        const list = container.createEl('ul', { cls: 'atoz-clipboard-list' });

        for (const entry of history) {
            const item = list.createEl('li', { cls: 'atoz-clipboard-item' });

            // 선택된 항목이면 하이라이트 복원
            if (entry.id === this.plugin.selectedClipboardId) {
                item.addClass('atoz-clipboard-selected');
                this.selectedEl = item;
            }

            const preview = entry.text.length > previewLength
                ? entry.text.slice(0, previewLength) + '…'
                : entry.text;

            item.createEl('span', { cls: 'atoz-clipboard-text', text: preview });

            const deleteBtn = item.createEl('button', {
                cls: 'atoz-clipboard-delete',
                text: '✕',
                attr: { 'aria-label': '삭제' },
            });

            item.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('.atoz-clipboard-delete')) return;
                this.selectEntry(entry, item);
            });

            deleteBtn.addEventListener('click', () => {
                this.plugin.clipboard.removeEntry(entry.id);
            });
        }
    }

    private selectEntry(entry: ClipboardEntry, el: HTMLElement): void {
        this.selectedEl?.removeClass('atoz-clipboard-selected');
        this.plugin.selectedClipboardText = entry.text;
        this.plugin.selectedClipboardId = entry.id;
        el.addClass('atoz-clipboard-selected');
        this.selectedEl = el;
    }
}

export class ClipboardModal extends SuggestModal<ClipboardEntry> {
    constructor(private plugin: ATOZVER6Plugin) {
        super(plugin.app);
        this.setPlaceholder('클립보드 히스토리에서 선택...');
    }

    getSuggestions(query: string): ClipboardEntry[] {
        const history = this.plugin.settings.clipboardHistory;
        if (!query) return history;
        return history.filter(e => e.text.toLowerCase().includes(query.toLowerCase()));
    }

    renderSuggestion(entry: ClipboardEntry, el: HTMLElement): void {
        const previewLength = this.plugin.settings.clipboardPreviewLength;
        const preview = entry.text.length > previewLength
            ? entry.text.slice(0, previewLength) + '…'
            : entry.text;
        el.setText(preview);
    }

    onChooseSuggestion(entry: ClipboardEntry): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;
        view.editor.replaceSelection(entry.text);
    }
}