import {
    App,
    Editor,
    ItemView,
    MarkdownView,
    Notice,
    SuggestModal,
    TFile,
    TFolder,
    WorkspaceLeaf,
    normalizePath,
} from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { pickMostRecentLeaf } from '../utils';

export const VIEW_TYPE_LATER = 'atoz-later-view';

type FrontmatterRecord = Record<string, unknown>;

interface LaterEntry {
    id: string;
    filePath: string;
    line: number;
    text: string;
}

interface LaterCandidate {
    file: TFile;
    preview: string;
}

export class LaterFeature {
    private sourceFile: TFile | null = null;
    private selectedEntry: LaterEntry | null = null;
    private refreshTimer: number | null = null;

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
                this.handleActiveLeafChange(leaf);
            }),
        );
        this.plugin.registerEvent(
            this.plugin.app.metadataCache.on('changed', () => this.scheduleRefresh()),
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('modify', () => this.scheduleRefresh()),
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('create', () => this.scheduleRefresh()),
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('delete', () => this.scheduleRefresh()),
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('rename', () => this.scheduleRefresh()),
        );
    }

    uninstall(): void {
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    captureCurrentRootFile(): void {
        const leaves: WorkspaceLeaf[] = [];
        this.plugin.app.workspace.iterateRootLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file) leaves.push(leaf);
        });
        const leaf = pickMostRecentLeaf(leaves, this.plugin.app);
        if (leaf?.view instanceof MarkdownView && leaf.view.file) {
            this.setSourceFile(leaf.view.file);
        }
    }

    private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
        if (!leaf) return;

        if (leaf.getRoot() === this.plugin.app.workspace.rootSplit) {
            if (leaf.view instanceof MarkdownView && leaf.view.file) {
                this.setSourceFile(leaf.view.file);
            }
            return;
        }

        if (leaf.getRoot() !== this.plugin.app.workspace.rightSplit) return;

        const viewType = leaf.view.getViewType();
        if (viewType === VIEW_TYPE_LATER) {
            this.plugin.activeSidebarMode = 'later';
        } else {
            this.plugin.activeSidebarMode = null;
        }
    }

    private setSourceFile(file: TFile): void {
        if (this.sourceFile?.path === file.path) return;
        this.sourceFile = file;
        this.selectedEntry = null;
        this.refreshView();
    }

    async moveSelectionToLater(editor: Editor, sourceFile: TFile | null): Promise<void> {
        if (!sourceFile) {
            new Notice(t('later.noActiveFile'));
            return;
        }
        if (this.hasLaterProperty(sourceFile)) {
            new Notice(t('later.unavailableInLaterNote'));
            return;
        }

        const frontmatterEnd = this.findFrontmatterEndLine(editor);
        const hasSelection = editor.somethingSelected();
        let textToMove: string;
        let currentLine: number | null = null;

        if (hasSelection) {
            const from = editor.getCursor('from');
            if (frontmatterEnd >= 0 && from.line <= frontmatterEnd) {
                new Notice(t('later.frontmatterSelection'));
                return;
            }
            textToMove = editor.getSelection();
            if (!textToMove.trim()) {
                new Notice(t('later.nothingToMove'));
                return;
            }
        } else {
            currentLine = editor.getCursor().line;
            if (frontmatterEnd >= 0 && currentLine <= frontmatterEnd) {
                new Notice(t('later.frontmatterLine'));
                return;
            }
            textToMove = this.cleanMarkdownSymbols(editor.getLine(currentLine));
            if (!textToMove) {
                this.removeLines(editor, currentLine, currentLine);
                new Notice(t('later.emptyLineDeleted'));
                return;
            }
        }

        const targetFolder = this.plugin.settings.moveLineTargetFolder?.trim();
        if (targetFolder) {
            const folder = this.plugin.app.vault.getAbstractFileByPath(normalizePath(targetFolder));
            if (!(folder instanceof TFolder)) {
                new Notice(t('later.folderNotFound', { folder: targetFolder }));
                return;
            }
        }

        try {
            const linkedFiles = this.findLaterFilesForSource(sourceFile);
            let targetFile: TFile | null;

            if (linkedFiles.length > 1) {
                targetFile = await this.chooseCanonicalLaterFile(sourceFile, linkedFiles);
                if (!targetFile) return;
            } else {
                targetFile = linkedFiles[0] ?? await this.getOrCreateLaterFile(sourceFile, targetFolder);
                if (!targetFile) return;
            }

            await this.plugin.app.vault.append(targetFile, `\n\n${textToMove}`);
            if (hasSelection) {
                editor.replaceSelection('');
            } else if (currentLine !== null) {
                this.removeLines(editor, currentLine, currentLine);
            }
            this.sourceFile = sourceFile;
            const entries = await this.readEntries(targetFile);
            this.selectedEntry = entries[entries.length - 1] ?? null;
            this.refreshView();
            new Notice(t('later.movedToFile', { file: targetFile.path }));
        } catch (error) {
            console.error(error);
            new Notice(t('later.writeFailed'));
        }
    }

    async resolveDuplicateLinks(): Promise<void> {
        const current = this.sourceFile;
        if (!current) {
            new Notice(t('later.noSourceNote'));
            return;
        }

        const source = this.hasLaterProperty(current) ? this.resolveLaterSource(current) : current;
        if (!source) {
            new Notice(t('later.sourceNotFound'));
            return;
        }

        const linkedFiles = this.findLaterFilesForSource(source);
        if (linkedFiles.length < 2) {
            new Notice(t('later.noDuplicates'));
            return;
        }

        await this.chooseCanonicalLaterFile(source, linkedFiles);
    }

    selectPrev(): void {
        void this.selectByOffset(1);
    }

    selectNext(): void {
        void this.selectByOffset(-1);
    }

    async takeSelected(): Promise<void> {
        const entry = this.selectedEntry;
        if (!entry) {
            new Notice(t('later.noSelection'));
            return;
        }

        const source = this.sourceFile;
        if (!source) {
            this.selectedEntry = null;
            this.refreshView();
            new Notice(t('later.selectAgain'));
            return;
        }

        const linkedFiles = this.findLaterFilesForSource(source);
        if (linkedFiles.length !== 1 || linkedFiles[0]?.path !== entry.filePath) {
            this.selectedEntry = null;
            this.refreshView();
            new Notice(t('later.resolveThenSelect'));
            return;
        }

        const laterFile = this.plugin.app.vault.getAbstractFileByPath(entry.filePath);
        if (!(laterFile instanceof TFile)) {
            this.selectedEntry = null;
            this.refreshView();
            new Notice(t('later.noteNotFound'));
            return;
        }

        const content = await this.plugin.app.vault.read(laterFile);
        const lines = content.split(/\r?\n/);
        if (lines[entry.line] !== entry.text) {
            this.selectedEntry = null;
            this.refreshView();
            new Notice(t('later.changedAndRefreshed'));
            return;
        }

        const leaf = await this.openFileInRoot(source);
        if (!(leaf?.view instanceof MarkdownView)) return;

        leaf.view.editor.replaceSelection(entry.text);
        this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
        leaf.view.editor.focus();
    }

    async activateView(): Promise<void> {
        const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_LATER);
        if (existing.length > 0) {
            this.plugin.activeSidebarMode = 'later';
            void this.plugin.app.workspace.revealLeaf(existing[0]!);
            return;
        }

        const leaf = this.plugin.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: VIEW_TYPE_LATER, active: true });
        this.plugin.activeSidebarMode = 'later';
        void this.plugin.app.workspace.revealLeaf(leaf);
    }

    refreshView(): void {
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_LATER).forEach((leaf) => {
            if (leaf.view instanceof LaterView) void leaf.view.render();
        });
    }

    getCurrentFile(): TFile | null {
        return this.sourceFile;
    }

    getLinkedLaterFiles(file: TFile): TFile[] {
        return this.findLaterFilesForSource(file);
    }

    resolveLaterSource(file: TFile): TFile | null {
        const linkpath = this.readLaterLinkpath(file);
        return linkpath ? this.plugin.app.metadataCache.getFirstLinkpathDest(linkpath, file.path) : null;
    }

    async readEntries(file: TFile): Promise<LaterEntry[]> {
        const content = await this.plugin.app.vault.read(file);
        const lines = content.split(/\r?\n/);
        const bodyStart = this.findBodyStart(lines);
        const entries: LaterEntry[] = [];

        for (let line = bodyStart; line < lines.length; line++) {
            const text = lines[line] ?? '';
            if (!text.trim()) continue;
            entries.push({
                id: `${file.path}:${line}`,
                filePath: file.path,
                line,
                text,
            });
        }

        return entries;
    }

    selectEntry(entry: LaterEntry): void {
        this.selectedEntry = entry;
        this.refreshHighlight();
    }

    getSelectedEntryId(): string | null {
        return this.selectedEntry?.id ?? null;
    }

    async openSourceFromLink(source: TFile): Promise<void> {
        const leaf = await this.openFileInRoot(source, false);
        if (!(leaf?.view instanceof MarkdownView)) return;
        this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
        leaf.view.editor.focus();
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            this.refreshView();
        }, 50);
    }

    private async selectByOffset(offset: 1 | -1): Promise<void> {
        const source = this.sourceFile;
        if (!source || this.hasLaterProperty(source)) return;

        const linkedFiles = this.findLaterFilesForSource(source);
        if (linkedFiles.length !== 1) return;
        const entries = await this.readEntries(linkedFiles[0]!);
        if (entries.length === 0) return;

        const currentIndex = entries.findIndex((entry) => entry.id === this.selectedEntry?.id);
        const nextIndex = currentIndex === -1
            ? (offset > 0 ? 0 : entries.length - 1)
            : (currentIndex + offset + entries.length) % entries.length;
        const entry = entries[nextIndex];
        if (!entry) return;

        this.selectedEntry = entry;
        this.refreshHighlight();
    }

    private refreshHighlight(): void {
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_LATER).forEach((leaf) => {
            if (leaf.view instanceof LaterView) leaf.view.updateHighlight(this.selectedEntry?.id ?? null);
        });
    }

    private findLaterFilesForSource(source: TFile): TFile[] {
        return this.plugin.app.vault.getMarkdownFiles().filter((file) => {
            const resolved = this.resolveLaterSource(file);
            return resolved?.path === source.path;
        });
    }

    private hasLaterProperty(file: TFile): boolean {
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as FrontmatterRecord | undefined;
        return frontmatter?.later !== undefined;
    }

    private readLaterLinkpath(file: TFile): string | null {
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as FrontmatterRecord | undefined;
        const value = frontmatter?.later;
        const nestedValues: unknown = Array.isArray(value) ? value[0] : null;
        if (Array.isArray(value) && value.length === 1 && Array.isArray(nestedValues) && nestedValues.length === 1) {
            const nestedLinkpath: unknown = nestedValues[0];
            return typeof nestedLinkpath === 'string' && nestedLinkpath.trim() ? nestedLinkpath.trim() : null;
        }
        if (typeof value !== 'string') return null;

        const match = value.trim().match(/^\[\[([^\]]+)\]\]$/);
        if (!match) return null;
        return (match[1] ?? '').split('|')[0]!.split('#')[0]!.trim() || null;
    }

    private async getOrCreateLaterFile(source: TFile, targetFolder: string | undefined): Promise<TFile | null> {
        const targetFilename = `${source.basename}_later.md`;
        const finalPath = normalizePath(targetFolder ? `${targetFolder}/${targetFilename}` : targetFilename);
        const existing = this.plugin.app.vault.getAbstractFileByPath(finalPath);

        if (existing instanceof TFile) {
            const frontmatter = this.plugin.app.metadataCache.getFileCache(existing)?.frontmatter as FrontmatterRecord | undefined;
            const laterValue = frontmatter?.later;
            if (laterValue === undefined || laterValue === null || laterValue === '') {
                await this.setLaterLink(existing, source);
                return existing;
            }

            if (this.resolveLaterSource(existing)?.path === source.path) return existing;
            new Notice(t('later.connectedElsewhere', { file: finalPath }));
            return null;
        }

        if (existing) {
            new Notice(t('later.cannotCreate', { file: finalPath }));
            return null;
        }

        const created = await this.plugin.app.vault.create(finalPath, '');
        await this.setLaterLink(created, source);
        return created;
    }

    private async setLaterLink(laterFile: TFile, source: TFile): Promise<void> {
        const linktext = this.plugin.app.metadataCache.fileToLinktext(source, laterFile.path, true);
        await this.plugin.app.fileManager.processFrontMatter(laterFile, (frontmatter) => {
            (frontmatter as FrontmatterRecord).later = `[[${linktext}]]`;
        });
    }

    private async chooseCanonicalLaterFile(source: TFile, files: TFile[]): Promise<TFile | null> {
        const candidates = await Promise.all(files.map(async (file): Promise<LaterCandidate> => {
            const entries = await this.readEntries(file);
            const preview = entries.slice(0, 2).map((entry) => entry.text.trim()).join(' / ');
            return { file, preview };
        }));
        const selected = await new Promise<TFile | null>((resolve) => {
            new LaterFilePicker(this.plugin.app, candidates, resolve).open();
        });
        if (!selected) return null;

        for (const file of files) {
            if (file.path === selected.path) continue;
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                delete (frontmatter as FrontmatterRecord).later;
            });
        }

        await this.setLaterLink(selected, source);
        this.refreshView();
        new Notice(t('later.keptNote', { file: selected.path }));
        return selected;
    }

    private findFrontmatterEndLine(editor: Editor): number {
        if (editor.getLine(0).trim() !== '---') return -1;
        for (let line = 1; line < editor.lineCount(); line++) {
            if (editor.getLine(line).trim() === '---') return line;
        }
        return -1;
    }

    private removeLines(editor: Editor, start: number, end: number): void {
        const lastLine = editor.lineCount() - 1;
        if (end < lastLine) {
            editor.replaceRange('', { line: start, ch: 0 }, { line: end + 1, ch: 0 });
            return;
        }

        if (start > 0) {
            editor.replaceRange(
                '',
                { line: start - 1, ch: editor.getLine(start - 1).length },
                { line: end, ch: editor.getLine(end).length },
            );
            return;
        }

        editor.setValue('');
    }

    private cleanMarkdownSymbols(text: string): string {
        let result = text.trim();
        if (!result) return '';
        result = result.replace(/^(?:>\s*)*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(?:\d+\.\s+)?/, '');
        return result.trim();
    }

    private findBodyStart(lines: string[]): number {
        if (lines[0]?.trim() !== '---') return 0;
        for (let line = 1; line < lines.length; line++) {
            if (lines[line]?.trim() === '---') return line + 1;
        }
        return 0;
    }

    private async openFileInRoot(file: TFile, moveToEndIfNew = true): Promise<WorkspaceLeaf | null> {
        const leaves: WorkspaceLeaf[] = [];
        this.plugin.app.workspace.iterateRootLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) leaves.push(leaf);
        });

        let leaf = pickMostRecentLeaf(leaves, this.plugin.app);
        const isNew = !leaf;
        if (!leaf) {
            leaf = this.plugin.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
        }

        if (isNew && moveToEndIfNew && leaf.view instanceof MarkdownView) {
            const editor = leaf.view.editor;
            const line = Math.max(0, editor.lineCount() - 1);
            editor.setCursor({ line, ch: editor.getLine(line).length });
        }
        return leaf;
    }
}

export class LaterView extends ItemView {
    private selectedEl: HTMLElement | null = null;
    private itemEls = new Map<string, HTMLElement>();
    private renderId = 0;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_LATER; }
    getDisplayText(): string { return t('later.viewName'); }
    getIcon(): string { return 'archive-restore'; }

    async onOpen(): Promise<void> { await this.render(); }
    async onClose(): Promise<void> {}

    async render(): Promise<void> {
        const currentRender = ++this.renderId;
        const container = this.containerEl.children[1] as HTMLElement;
        const source = this.plugin.later.getCurrentFile();
        const prevScrollTop = container.scrollTop;

        if (!source) {
            container.empty();
            container.createEl('div', { cls: 'atoz-later-empty', text: t('later.noSourceNote') });
            return;
        }

        if (this.plugin.later.resolveLaterSource(source) || this.hasLaterProperty(source)) {
            const original = this.plugin.later.resolveLaterSource(source);
            container.empty();
            if (!original) {
                container.createEl('div', { cls: 'atoz-later-empty', text: t('later.sourceNotFound') });
                return;
            }
            this.renderSourceLink(container, original);
            return;
        }

        const linkedFiles = this.plugin.later.getLinkedLaterFiles(source);
        if (linkedFiles.length !== 1) {
            container.empty();
            const text = linkedFiles.length === 0
                ? t('later.noLinkedNote')
                : t('later.multipleLinkedNotes');
            container.createEl('div', { cls: 'atoz-later-empty', text });
            return;
        }

        const entries = await this.plugin.later.readEntries(linkedFiles[0]!);
        if (currentRender !== this.renderId) return;

        container.empty();
        this.selectedEl = null;
        this.itemEls.clear();

        if (entries.length === 0) {
            container.createEl('div', { cls: 'atoz-later-empty', text: t('later.noEntries') });
            return;
        }

        const list = container.createEl('ul', { cls: 'atoz-later-list' });
        for (const entry of entries) {
            const item = list.createEl('li', { cls: 'atoz-later-item' });
            item.createEl('span', { cls: 'atoz-later-text', text: entry.text });
            this.itemEls.set(entry.id, item);

            if (entry.id === this.plugin.later.getSelectedEntryId()) {
                item.addClass('atoz-later-selected');
                this.selectedEl = item;
            }

            item.addEventListener('click', () => {
                this.plugin.activeSidebarMode = 'later';
                this.plugin.later.selectEntry(entry);
            });
        }

        container.scrollTop = prevScrollTop;
        this.selectedEl?.scrollIntoView({ block: 'nearest' });
    }

    updateHighlight(id: string | null): void {
        this.selectedEl?.removeClass('atoz-later-selected');
        this.selectedEl = null;
        if (!id) return;

        const el = this.itemEls.get(id);
        if (!el) return;
        el.addClass('atoz-later-selected');
        this.selectedEl = el;
        el.scrollIntoView({ block: 'nearest' });
    }

    private renderSourceLink(container: HTMLElement, source: TFile): void {
        const frontmatter = this.plugin.app.metadataCache.getFileCache(source)?.frontmatter as FrontmatterRecord | undefined;
        const title = typeof frontmatter?.title === 'string' && frontmatter.title.trim()
            ? frontmatter.title.trim()
            : source.basename;
        const row = container.createEl('div', { cls: 'atoz-later-source' });
        row.createSpan({ text: t('later.sourceLabel') });
        const link = row.createEl('a', { cls: 'internal-link', text: title, href: source.path });
        link.addEventListener('click', (event) => {
            event.preventDefault();
            void this.plugin.later.openSourceFromLink(source);
        });
    }

    private hasLaterProperty(file: TFile): boolean {
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as FrontmatterRecord | undefined;
        return frontmatter?.later !== undefined;
    }
}

class LaterFilePicker extends SuggestModal<LaterCandidate> {
    private settled = false;

    constructor(
        app: App,
        private candidates: LaterCandidate[],
        private resolve: (file: TFile | null) => void,
    ) {
        super(app);
        this.setPlaceholder(t('later.resolvePlaceholder'));
    }

    getSuggestions(query: string): LaterCandidate[] {
        const normalized = query.toLowerCase();
        return this.candidates.filter((candidate) =>
            !normalized || candidate.file.path.toLowerCase().includes(normalized) || candidate.preview.toLowerCase().includes(normalized)
        );
    }

    renderSuggestion(candidate: LaterCandidate, el: HTMLElement): void {
        el.createEl('div', { text: candidate.file.path });
        if (candidate.preview) {
            el.createEl('small', { cls: 'atoz-later-candidate-preview', text: candidate.preview });
        }
    }

    onChooseSuggestion(candidate: LaterCandidate): void {
        this.settled = true;
        this.resolve(candidate.file);
    }

    onClose(): void {
        if (!this.settled) this.resolve(null);
    }
}
