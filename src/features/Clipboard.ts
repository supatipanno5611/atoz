import { Editor, ItemView, MarkdownView, Menu, Notice, SuggestModal, WorkspaceLeaf } from 'obsidian';
import type ATOZPlugin from '../main';
import { ClipboardEntry } from '../types';

export const VIEW_TYPE_CLIPBOARD = 'atoz-clipboard-view';

export class ClipboardFeature {
    constructor(private plugin: ATOZPlugin) {}

    addEntry(text: string): void {
        const history = this.plugin.settings.clipboardHistory;
        if (history[0]?.text === text) return;

        history.unshift({ id: Date.now().toString(), text });

        const limit = this.plugin.settings.clipboardHistoryLimit;
        const pinned = history.filter(e => e.pinned);
        const normal = history.filter(e => !e.pinned);
        this.plugin.settings.clipboardHistory = [
            ...pinned,
            ...normal.slice(0, limit),
        ];

        this.plugin.debouncedSave();
        this.refreshView();
    }

    removeEntry(id: string): void {
    	const history = this.plugin.settings.clipboardHistory;
    	const index = history.findIndex(e => e.id === id);

    	this.plugin.settings.clipboardHistory = history.filter(e => e.id !== id);

    	const next = this.plugin.settings.clipboardHistory[index]
    		?? this.plugin.settings.clipboardHistory[index - 1]
    		?? null;

    	if (next) {
    		this.plugin.selectedClipboardText = next.text;
    		this.plugin.selectedClipboardId = next.id;
    	} else {
    		this.plugin.selectedClipboardText = '';
    		this.plugin.selectedClipboardId = '';
    	}
    	
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

    deleteSelected(): void {
        const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLIPBOARD);
        if (leaves.length === 0) {
            new Notice('클립보드 사이드바가 열려 있을 때만 삭제할 수 있습니다.');
            return;
        }
        const id = this.plugin.selectedClipboardId;
        if (!id) {
            new Notice('삭제할 항목이 선택되지 않았습니다.');
            return;
        }
        this.removeEntry(id);
    }

    togglePin(id: string): void {
        const history = this.plugin.settings.clipboardHistory;
        const entry = history.find(e => e.id === id);
        if (!entry) return;

        if (entry.pinned) {
            // 핀 해제: 일반 영역 맨 앞으로
            entry.pinned = false;
            const pinned = history.filter(e => e.pinned);
            const normal = history.filter(e => !e.pinned);
            this.plugin.settings.clipboardHistory = [...pinned, ...normal];
        } else {
            // 핀 고정: 핀 영역 맨 뒤로
            entry.pinned = true;
            const pinned = history.filter(e => e.pinned);
            const normal = history.filter(e => !e.pinned);
            this.plugin.settings.clipboardHistory = [...pinned, ...normal];
        }

        this.plugin.debouncedSave();
        this.refreshView();
    }

    moveSelected(direction: 'up' | 'down'): void {
        const id = this.plugin.selectedClipboardId;
        if (!id) return;

        const history = this.plugin.settings.clipboardHistory;
        const index = history.findIndex(e => e.id === id);
        if (index === -1) return;

        const entry = history[index]!;

        if (direction === 'up') {
            if (index === 0) return;
            const prev = history[index - 1]!;

            // 일반 → 핀 영역으로 넘어가는 경우 (상태만 변경, 위치 교환 X)
            if (!entry.pinned && prev.pinned) {
                entry.pinned = true;
            } else {
                // 같은 영역 내 이동 (위치 교환 O)
                history.splice(index, 1);
                history.splice(index - 1, 0, entry);
            }
        } else {
            if (index === history.length - 1) return;
            const next = history[index + 1]!;

            // 핀 → 일반 영역으로 넘어가는 경우 (상태만 변경, 위치 교환 X)
            if (entry.pinned && !next.pinned) {
                entry.pinned = false;
            } else {
                // 같은 영역 내 이동 (위치 교환 O)
                history.splice(index, 1);
                history.splice(index + 1, 0, entry);
            }
        }

        this.plugin.debouncedSave();
        this.refreshView();
        this.refreshHighlight();
    }

    selectNext(): void {
        this.selectByOffset(-1);
    }

    selectPrev(): void {
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
    private itemEls = new Map<string, HTMLElement>();

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
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
        this.itemEls.clear();

        const history = this.plugin.settings.clipboardHistory;
        const previewLength = this.plugin.settings.clipboardPreviewLength;

        if (history.length === 0) {
            container.createEl('div', { cls: 'atoz-clipboard-empty', text: '복사한 텍스트가 없습니다.' });
            return;
        }

        const pinned = history.filter(e => e.pinned);
        const normal = history.filter(e => !e.pinned);

        const list = container.createEl('ul', { cls: 'atoz-clipboard-list' });

        const renderItem = (entry: ClipboardEntry) => {
            const item = list.createEl('li', { cls: 'atoz-clipboard-item' });

            if (entry.id === this.plugin.selectedClipboardId) {
                item.addClass('atoz-clipboard-selected');
                this.selectedEl = item;
            }

            const preview = entry.text.length > previewLength
                ? entry.text.slice(0, previewLength) + '…'
                : entry.text;

            item.createEl('span', { cls: 'atoz-clipboard-text', text: preview });
            this.itemEls.set(entry.id, item);

            item.addEventListener('click', () => this.selectEntry(entry, item));
            item.addEventListener('contextmenu', (e) => {
                const menu = new Menu();
                menu.addItem(menuItem => menuItem
                    .setTitle(entry.pinned ? '핀 해제' : '핀 고정')
                    .setIcon(entry.pinned ? 'pin-off' : 'pin')
                    .onClick(() => this.plugin.clipboard.togglePin(entry.id))
                );
                menu.addItem(menuItem => menuItem
                    .setTitle('위로')
                    .setIcon('arrow-up')
                    .onClick(() => {
                        this.plugin.selectedClipboardId = entry.id;
                        this.plugin.selectedClipboardText = entry.text;
                        this.plugin.clipboard.moveSelected('up');
                    })
                );
                menu.addItem(menuItem => menuItem
                    .setTitle('아래로')
                    .setIcon('arrow-down')
                    .onClick(() => {
                        this.plugin.selectedClipboardId = entry.id;
                        this.plugin.selectedClipboardText = entry.text;
                        this.plugin.clipboard.moveSelected('down');
                    })
                );
                menu.addItem(menuItem => menuItem
                    .setTitle('삭제')
                    .setIcon('trash')
                    .onClick(() => this.plugin.clipboard.removeEntry(entry.id))
                );
                menu.showAtMouseEvent(e);
            });
        };

        for (const entry of pinned) renderItem(entry);

        if (pinned.length > 0 && normal.length > 0) {
            list.createEl('li', { cls: 'atoz-clipboard-divider' });
        }

        for (const entry of normal) renderItem(entry);

        container.scrollTop = prevScrollTop;
    }

    updateHighlight(id: string | null): void {
        this.selectedEl?.removeClass('atoz-clipboard-selected');
        this.selectedEl = null;

        if (!id) return;

        const el = this.itemEls.get(id);
        if (!el) return;

        el.addClass('atoz-clipboard-selected');
        this.selectedEl = el;
        el.scrollIntoView({ block: 'nearest' });
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
    constructor(private plugin: ATOZPlugin) {
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
