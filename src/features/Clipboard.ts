import { Editor, ItemView, MarkdownView, setIcon, SuggestModal, WorkspaceLeaf } from 'obsidian';
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
        if (this.plugin.selectedClipboardId === id) {
            this.plugin.selectedClipboardText = '';
            this.plugin.selectedClipboardId = '';
        }
        this.plugin.settings.clipboardHistory = this.plugin.settings.clipboardHistory.filter(e => e.id !== id);
        this.plugin.debouncedSave();
        this.refreshView();
    }

    clearHistory(): void {
        this.plugin.selectedClipboardText = '';
        this.plugin.selectedClipboardId = '';
        this.plugin.settings.clipboardHistory = [];
        this.plugin.debouncedSave();
        this.refreshView();
    }

    pasteSelected(editor: Editor): void {
        const text = this.plugin.selectedClipboardText;
        if (!text) return;
        editor.replaceSelection(text);
    }

    selectPrev(): void {
        this.selectByOffset(-1);
    }

    selectNext(): void {
        this.selectByOffset(1);
    }

    private selectByOffset(offset: 1 | -1): void {
        const history = this.plugin.settings.clipboardHistory;
        if (history.length === 0) return;

        const currentIndex = history.findIndex(e => e.id === this.plugin.selectedClipboardId);
        let nextIndex: number;

        if (currentIndex === -1) {
            nextIndex = offset > 0 ? 0 : history.length - 1;
        } else {
            nextIndex = (currentIndex + offset + history.length) % history.length;
        }

        const entry = history[nextIndex];
        if (!entry) return;

        this.plugin.selectedClipboardText = entry.text;
        this.plugin.selectedClipboardId = entry.id;
        this.refreshHighlight();
    }

    private refreshView(): void {
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLIPBOARD).forEach(leaf => {
            if (leaf.view instanceof ClipboardView) leaf.view.render();
        });
    }

    private refreshHighlight(): void {
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLIPBOARD).forEach(leaf => {
            if (leaf.view instanceof ClipboardView) leaf.view.updateHighlight(this.plugin.selectedClipboardId);
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
    private pendingDeleteId: string | null = null;
    private itemEls = new Map<string, { item: HTMLElement; deleteBtn: HTMLElement }>();

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
        const prevScrollTop = container.scrollTop;
        container.empty();
        this.selectedEl = null;
        this.pendingDeleteId = null;
        this.itemEls.clear();

        const history = this.plugin.settings.clipboardHistory;
        const previewLength = this.plugin.settings.clipboardPreviewLength;

        const toolbar = container.createEl('div', { cls: 'atoz-clipboard-toolbar' });
        toolbar.createEl('button', { cls: 'atoz-clipboard-clear', text: '전체 삭제' })
            .addEventListener('click', () => this.plugin.clipboard.clearHistory());

        if (history.length === 0) {
            container.createEl('div', { cls: 'atoz-clipboard-empty', text: '복사한 텍스트가 없습니다.' });
            return;
        }

        const list = container.createEl('ul', { cls: 'atoz-clipboard-list' });

        for (const entry of history) {
            const item = list.createEl('li', { cls: 'atoz-clipboard-item' });

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
                attr: { 'aria-label': '삭제' },
            });
            setIcon(deleteBtn, 'x');

            this.itemEls.set(entry.id, { item, deleteBtn });

            item.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('.atoz-clipboard-delete')) return;
                if (this.pendingDeleteId !== null) {
                    this.cancelPendingDelete();
                    return;
                }
                this.selectEntry(entry, item);
            });

            deleteBtn.addEventListener('click', () => {
                if (this.pendingDeleteId === entry.id) {
                    this.plugin.clipboard.removeEntry(entry.id);
                    return;
                }
                this.cancelPendingDelete();
                this.pendingDeleteId = entry.id;
                deleteBtn.addClass('atoz-clipboard-delete-pending');
            });
        }

        container.scrollTop = prevScrollTop;
    }

    updateHighlight(id: string | null): void {
        this.selectedEl?.removeClass('atoz-clipboard-selected');
        this.selectedEl = null;

        if (!id) return;

        const els = this.itemEls.get(id);
        if (!els) return;

        els.item.addClass('atoz-clipboard-selected');
        this.selectedEl = els.item;
        els.item.scrollIntoView({ block: 'nearest' });
    }

    private selectEntry(entry: ClipboardEntry, el: HTMLElement): void {
        this.selectedEl?.removeClass('atoz-clipboard-selected');
        this.plugin.selectedClipboardText = entry.text;
        this.plugin.selectedClipboardId = entry.id;
        el.addClass('atoz-clipboard-selected');
        this.selectedEl = el;
    }

    private cancelPendingDelete(): void {
        if (this.pendingDeleteId === null) return;
        const els = this.itemEls.get(this.pendingDeleteId);
        els?.deleteBtn.removeClass('atoz-clipboard-delete-pending');
        this.pendingDeleteId = null;
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