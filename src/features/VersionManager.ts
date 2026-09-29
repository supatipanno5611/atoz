import {
    App,
    Editor,
    ItemView,
    MarkdownView,
    Notice,
    SuggestModal,
    TFile,
    WorkspaceLeaf,
    normalizePath,
    setIcon,
} from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { isRecord } from '../utils';
import { DiffBlock, diffDocuments } from './VersionDiff';

export const VIEW_TYPE_VERSION_DIFF = 'atoz-version-diff-view';

const VERSION_PROPERTY = 'version';
const STAMP_PATTERN = /_(\d{14})$/;
const FORBIDDEN_FILENAME = /[\\/:*?"<>|#^[\]]/g;
const MESSAGE_LIMIT = 50;
const CURRENT_KEY = ' current';
const EMPTY_KEY = ' empty';

type FrontmatterRecord = Record<string, unknown>;

interface VersionEntry {
    file: TFile;
    message: string;
    stamp: string;
}

type VersionChoice =
    | { kind: 'empty' }
    | { kind: 'current' }
    | { kind: 'version'; entry: VersionEntry };

function choiceKey(choice: VersionChoice): string {
    if (choice.kind === 'empty') return EMPTY_KEY;
    return choice.kind === 'current' ? CURRENT_KEY : choice.entry.file.path;
}

function choiceLabel(choice: VersionChoice): string {
    if (choice.kind === 'empty') return t('versionManager.emptyDocument');
    return choice.kind === 'current' ? t('versionManager.currentState') : choice.entry.message;
}

function splitFrontmatter(source: string): { frontmatter: string; body: string } {
    const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
    const lines = text.split('\n');
    if (lines[0]?.trim() !== '---') return { frontmatter: '', body: text };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (line === '---' || line === '...') {
            return {
                frontmatter: lines.slice(0, i + 1).join('\n') + '\n',
                body: lines.slice(i + 1).join('\n'),
            };
        }
    }

    return { frontmatter: '', body: text };
}

function timestamp(): string {
    const now = new Date();
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sanitizeMessage(raw: string): string {
    const cleaned = raw.replace(FORBIDDEN_FILENAME, '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return t('versionManager.defaultMessage');
    return cleaned.slice(0, MESSAGE_LIMIT).trim() || t('versionManager.defaultMessage');
}

function messageOf(basename: string): string {
    const match = STAMP_PATTERN.exec(basename);
    return match ? basename.slice(0, match.index) : basename;
}

function formatStamp(stamp: string): string {
    if (stamp.length !== 14) return stamp;
    return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ` +
        `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}`;
}

export class VersionManagerFeature {
    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.registerView(
            VIEW_TYPE_VERSION_DIFF,
            (leaf) => new VersionDiffView(leaf, this.plugin),
        );

        this.plugin.addCommand({
            id: 'save-current-version',
            name: t('command.saveCurrentVersion'),
            icon: 'lucide-history',
            callback: () => void this.saveCurrentVersion(),
        });

        this.plugin.addCommand({
            id: 'revert-to-version',
            name: t('command.revertToVersion'),
            icon: 'lucide-undo-2',
            callback: () => void this.revertToVersion(),
        });

        this.plugin.addCommand({
            id: 'open-version-diff',
            name: t('command.openVersionDiff'),
            icon: 'lucide-git-compare',
            callback: () => void this.openVersionDiff(),
        });
    }

    uninstall(): void {
        this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_VERSION_DIFF);
    }

    isVersionNote(file: TFile): boolean {
        const frontmatter: unknown = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        return isRecord(frontmatter) && frontmatter[VERSION_PROPERTY] !== undefined;
    }

    private requireSourceView(): MarkdownView | null {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || view.file.extension !== 'md') {
            new Notice(t('versionManager.noActiveMarkdown'));
            return null;
        }
        if (this.isVersionNote(view.file)) {
            new Notice(t('versionManager.onVersionNote'));
            return null;
        }
        return view;
    }

    async saveCurrentVersion(): Promise<void> {
        const view = this.requireSourceView();
        if (!view?.file) return;

        const message = this.nextNumber(view.file);
        const created = await this.createVersionNote(view.file, view.editor.getValue(), message);
        if (created) new Notice(t('versionManager.saved', { file: messageOf(created.basename) }));
    }

    async revertToVersion(): Promise<void> {
        const view = this.requireSourceView();
        if (!view?.file) return;

        const entries = this.getVersionEntries(view.file);
        if (entries.length === 0) {
            new Notice(t('versionManager.noVersions'));
            return;
        }

        const choices = entries.map((entry): VersionChoice => ({ kind: 'version', entry }));
        const selected = await this.pickFrom(choices, t('versionManager.pickRevert'));
        if (!selected || selected.kind !== 'version') return;

        const current = view.editor.getValue();
        const restored = splitFrontmatter(await this.plugin.app.vault.read(selected.entry.file)).body;
        view.editor.setValue(splitFrontmatter(current).frontmatter + restored);
        new Notice(t('versionManager.reverted', { file: selected.entry.message }));
    }

    async openVersionDiff(): Promise<void> {
        const view = this.requireSourceView();
        if (!view?.file) return;

        if (this.getVersionEntries(view.file).length === 0) {
            new Notice(t('versionManager.noVersions'));
            return;
        }

        const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_VERSION_DIFF);
        const leaf = existing[0] ?? this.plugin.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE_VERSION_DIFF, active: true });
        await this.plugin.app.workspace.revealLeaf(leaf);

        if (leaf.view instanceof VersionDiffView) await leaf.view.setSource(view.file);
    }

    getVersionEntries(source: TFile): VersionEntry[] {
        const entries: VersionEntry[] = [];

        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            const linkpath = this.readVersionLinkpath(file);
            if (linkpath === null) continue;

            const target = this.plugin.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
            if (target?.path !== source.path) continue;

            const match = STAMP_PATTERN.exec(file.basename);
            entries.push({
                file,
                message: messageOf(file.basename),
                stamp: match?.[1] ?? '',
            });
        }

        return entries.sort((a, b) => b.stamp.localeCompare(a.stamp));
    }

    async readBody(choice: VersionChoice, source: TFile): Promise<string> {
        if (choice.kind === 'empty') return '';
        if (choice.kind === 'version') {
            return splitFrontmatter(await this.plugin.app.vault.read(choice.entry.file)).body;
        }

        const editor = this.findEditor(source);
        const content = editor ? editor.getValue() : await this.plugin.app.vault.read(source);
        return splitFrontmatter(content).body;
    }

    pickFrom(choices: VersionChoice[], placeholder: string): Promise<VersionChoice | null> {
        return new Promise((resolve) => {
            window.setTimeout(() => {
                new VersionPicker(this.plugin.app, choices, placeholder, resolve).open();
            }, 0);
        });
    }

    async renameVersion(entry: VersionEntry, raw: string): Promise<string | null> {
        if (!raw.trim()) return null;
        const message = sanitizeMessage(raw);
        if (message === entry.message) return null;

        const basename = entry.stamp ? `${message}_${entry.stamp}` : message;
        const parent = entry.file.parent?.isRoot() ? '' : entry.file.parent?.path ?? '';
        const path = normalizePath(parent ? `${parent}/${basename}.md` : `${basename}.md`);

        if (this.plugin.app.vault.getAbstractFileByPath(path)) {
            new Notice(t('versionManager.duplicateNote', { file: path }));
            return null;
        }

        await this.plugin.app.fileManager.renameFile(entry.file, path);
        return path;
    }

    private nextNumber(source: TFile): string {
        const numbers = this.getVersionEntries(source)
            .filter((entry) => /^\d+$/.test(entry.message))
            .map((entry) => Number(entry.message));
        return String(Math.max(0, ...numbers) + 1);
    }

    private findEditor(file: TFile): Editor | null {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === file.path) return view.editor;
        }
        return null;
    }

    private readVersionLinkpath(file: TFile): string | null {
        const frontmatter: unknown = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const value = isRecord(frontmatter) ? frontmatter[VERSION_PROPERTY] : undefined;
        const nested: unknown = Array.isArray(value) ? value[0] : null;
        if (Array.isArray(value) && value.length === 1 && Array.isArray(nested) && nested.length === 1) {
            const nestedLinkpath: unknown = nested[0];
            return typeof nestedLinkpath === 'string' && nestedLinkpath.trim() ? nestedLinkpath.trim() : null;
        }
        if (typeof value !== 'string') return null;

        const match = value.trim().match(/^\[\[([^\]]+)\]\]$/);
        if (!match) return null;
        return (match[1] ?? '').split('|')[0]!.split('#')[0]!.trim() || null;
    }

    private async createVersionNote(
        source: TFile,
        content: string,
        message: string,
    ): Promise<TFile | null> {
        const folder = this.plugin.settings.versionFolder.trim();
        if (folder && !this.plugin.app.vault.getFolderByPath(normalizePath(folder))) {
            await this.plugin.app.vault.createFolder(normalizePath(folder));
        }

        const parent = folder || (source.parent?.isRoot() ? '' : source.parent?.path ?? '');
        const filename = `${sanitizeMessage(message)}_${timestamp()}.md`;
        const path = normalizePath(parent ? `${parent}/${filename}` : filename);

        if (this.plugin.app.vault.getAbstractFileByPath(path)) {
            new Notice(t('versionManager.duplicateNote', { file: path }));
            return null;
        }

        const created = await this.plugin.app.vault.create(path, splitFrontmatter(content).body);
        const linktext = this.plugin.app.metadataCache.fileToLinktext(source, created.path, true);
        await this.plugin.app.fileManager.processFrontMatter(created, (frontmatter) => {
            (frontmatter as FrontmatterRecord)[VERSION_PROPERTY] = `[[${linktext}]]`;
        });

        return created;
    }
}

class VersionPicker extends SuggestModal<VersionChoice> {
    private settled = false;

    constructor(
        app: App,
        private choices: VersionChoice[],
        placeholder: string,
        private onChoose: (choice: VersionChoice | null) => void,
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }

    getSuggestions(query: string): VersionChoice[] {
        const normalized = query.trim().toLowerCase();
        return this.choices.filter((choice) =>
            choice.kind !== 'version' || choice.entry.message.toLowerCase().includes(normalized));
    }

    renderSuggestion(value: VersionChoice, el: HTMLElement): void {
        el.createDiv({ text: choiceLabel(value) });
        if (value.kind === 'version') {
            el.createDiv({
                cls: 'atoz-version-stamp',
                text: formatStamp(value.entry.stamp),
            });
        }
    }

    onChooseSuggestion(value: VersionChoice): void {
        this.settle(value);
    }

    onClose(): void {
        window.setTimeout(() => this.settle(null), 0);
    }

    private settle(choice: VersionChoice | null): void {
        if (this.settled) return;
        this.settled = true;
        this.onChoose(choice);
    }
}

export class VersionDiffView extends ItemView {
    private source: TFile | null = null;
    private axis: VersionChoice[] = [];
    private beforeKey = CURRENT_KEY;
    private afterKey = CURRENT_KEY;
    private blocks: DiffBlock[] = [];
    private listToggled = false;
    private listEl: HTMLElement | null = null;
    private mainEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_VERSION_DIFF; }
    getDisplayText(): string { return t('versionManager.viewName'); }
    getIcon(): string { return 'lucide-git-compare'; }

    async onOpen(): Promise<void> { this.render(false); }
    async onClose(): Promise<void> {}

    async setSource(source: TFile): Promise<void> {
        this.source = source;
        this.reloadAxis();
        this.afterKey = CURRENT_KEY;
        this.beforeKey = choiceKey(this.axis[Math.max(0, this.axis.length - 2)] ?? { kind: 'current' });
        await this.recompute(false);
    }

    private reloadAxis(): void {
        if (!this.source) {
            this.axis = [];
            return;
        }

        const entries = this.plugin.versionManager.getVersionEntries(this.source);
        const older = [...entries].reverse().map((entry): VersionChoice => ({ kind: 'version', entry }));
        this.axis = [{ kind: 'empty' }, ...older, { kind: 'current' }];
    }

    private positions(): { before: number; after: number } {
        let after = this.axis.findIndex((choice) => choiceKey(choice) === this.afterKey);
        if (after < 0) after = this.axis.length - 1;

        let before = this.axis.findIndex((choice) => choiceKey(choice) === this.beforeKey);
        if (before < 0 || before >= after) before = Math.max(0, after - 1);

        return { before, after };
    }

    private async recompute(preserveScroll: boolean): Promise<void> {
        const { before, after } = this.positions();
        const beforeChoice = this.axis[before];
        const afterChoice = this.axis[after];

        if (!this.source || !beforeChoice || !afterChoice) {
            this.blocks = [];
            this.render(preserveScroll);
            return;
        }

        this.beforeKey = choiceKey(beforeChoice);
        this.afterKey = choiceKey(afterChoice);

        const beforeBody = await this.plugin.versionManager.readBody(beforeChoice, this.source);
        const afterBody = await this.plugin.versionManager.readBody(afterChoice, this.source);
        this.blocks = diffDocuments(beforeBody, afterBody);
        this.render(preserveScroll);
    }

    private async selectRow(index: number): Promise<void> {
        this.afterKey = choiceKey(this.axis[index]!);
        this.beforeKey = choiceKey(this.axis[index - 1]!);
        this.listToggled = false;
        await this.recompute(false);
    }

    private startRename(title: HTMLElement, entry: VersionEntry): void {
        const input = createEl('input', {
            cls: 'atoz-version-diff-rename',
            type: 'text',
            value: entry.message,
        });
        title.replaceWith(input);
        input.focus();
        input.select();

        let done = false;
        const finish = (commit: boolean) => {
            if (done) return;
            done = true;
            if (commit) void this.renameEntry(entry, input.value);
            else input.replaceWith(title);
        };

        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('blur', () => finish(false));
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') finish(true);
            else if (event.key === 'Escape') finish(false);
            else return;
            event.preventDefault();
        });
    }

    private async renameEntry(entry: VersionEntry, raw: string): Promise<void> {
        const oldPath = entry.file.path;
        const newPath = await this.plugin.versionManager.renameVersion(entry, raw);
        if (newPath) {
            if (this.beforeKey === oldPath) this.beforeKey = newPath;
            if (this.afterKey === oldPath) this.afterKey = newPath;
        }
        await this.refresh();
    }

    private async pickSide(side: 'before' | 'after'): Promise<void> {
        if (!this.source) return;

        this.reloadAxis();
        const { before, after } = this.positions();
        const range = side === 'before' ? this.axis.slice(0, after) : this.axis.slice(before + 1);
        if (range.length === 0) return;

        const selected = await this.plugin.versionManager.pickFrom(
            [...range].reverse(),
            side === 'before' ? t('versionManager.pickBefore') : t('versionManager.pickAfter'),
        );
        if (!selected) return;

        if (side === 'before') this.beforeKey = choiceKey(selected);
        else this.afterKey = choiceKey(selected);

        await this.recompute(false);
    }

    private async refresh(): Promise<void> {
        this.reloadAxis();
        await this.recompute(true);
    }

    private render(preserveScroll: boolean): void {
        const container = this.containerEl.children[1] as HTMLElement;
        const previousScroll = this.mainEl?.scrollTop ?? 0;
        const previousListScroll = this.listEl?.scrollTop ?? 0;

        container.empty();
        container.addClass('atoz-version-diff');
        container.toggleClass('is-list-toggled', this.listToggled);

        if (!this.source) {
            this.listEl = null;
            this.mainEl = container.createDiv({ cls: 'atoz-version-diff-main' });
            this.mainEl.createDiv({
                cls: 'atoz-version-diff-empty',
                text: t('versionManager.noComparison'),
            });
            return;
        }

        this.renderHeader(container);
        const panes = container.createDiv({ cls: 'atoz-version-diff-panes' });
        this.listEl = this.renderList(panes);
        this.mainEl = panes.createDiv({ cls: 'atoz-version-diff-main' });
        this.renderBody(this.mainEl);
        this.mainEl.scrollTop = preserveScroll ? previousScroll : 0;
        this.listEl.scrollTop = previousListScroll;
    }

    private renderHeader(container: HTMLElement): void {
        const { before, after } = this.positions();
        const header = container.createDiv({ cls: 'atoz-version-diff-header' });
        header.createDiv({ cls: 'atoz-version-diff-source', text: this.source?.basename ?? '' });

        const controls = header.createDiv({ cls: 'atoz-version-diff-controls' });

        const toggle = controls.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': t('versionManager.toggleList') },
        });
        setIcon(toggle, 'lucide-list');
        toggle.addEventListener('click', () => {
            this.listToggled = !this.listToggled;
            container.toggleClass('is-list-toggled', this.listToggled);
        });

        this.renderLabel(controls, 'before', before);
        controls.createSpan({ cls: 'atoz-version-diff-sep', text: '→' });
        this.renderLabel(controls, 'after', after);

        const refresh = controls.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': t('versionManager.refresh') },
        });
        setIcon(refresh, 'lucide-refresh-cw');
        refresh.addEventListener('click', () => void this.refresh());
    }

    private renderLabel(parent: HTMLElement, side: 'before' | 'after', position: number): void {
        const label = choiceLabel(this.axis[position] ?? { kind: 'current' });
        const button = parent.createEl('button', {
            cls: 'atoz-version-diff-label',
            text: label,
            attr: { title: label },
        });
        button.addEventListener('click', () => void this.pickSide(side));
    }

    private renderList(parent: HTMLElement): HTMLElement {
        const { before, after } = this.positions();
        const list = parent.createDiv({ cls: 'atoz-version-diff-list' });

        for (let index = this.axis.length - 1; index > 0; index--) {
            const choice = this.axis[index]!;
            const row = list.createDiv({ cls: 'atoz-version-diff-row' });
            row.toggleClass('is-active', index === after);
            row.toggleClass('is-before', index === before && before !== after - 1);
            const title = row.createDiv({ text: choiceLabel(choice) });
            if (choice.kind === 'version') {
                row.createDiv({ cls: 'atoz-version-stamp', text: formatStamp(choice.entry.stamp) });
            }
            row.addEventListener('click', () => {
                if (index === after && choice.kind === 'version') this.startRename(title, choice.entry);
                else void this.selectRow(index);
            });
        }

        return list;
    }

    private renderBody(container: HTMLElement): void {
        const blocks = this.blocks;
        if (!blocks.some((block) => block.kind !== 'same')) {
            container.createDiv({ cls: 'atoz-version-diff-empty', text: t('versionManager.noChanges') });
            return;
        }

        const keep = new Set<number>();
        blocks.forEach((block, index) => {
            if (block.kind === 'same') return;
            keep.add(index - 1);
            keep.add(index);
            keep.add(index + 1);
        });

        let skipped = 0;
        blocks.forEach((block, index) => {
            if (!keep.has(index)) {
                skipped++;
                return;
            }
            if (skipped > 0) {
                this.renderGap(container, skipped);
                skipped = 0;
            }
            this.renderBlock(container, block);
        });

        if (skipped > 0) this.renderGap(container, skipped);
    }

    private renderGap(container: HTMLElement, count: number): void {
        container.createDiv({
            cls: 'atoz-version-diff-gap',
            text: t('versionManager.omitted', { count }),
        });
    }

    private renderBlock(container: HTMLElement, block: DiffBlock): void {
        const el = container.createDiv({ cls: `atoz-version-diff-block atoz-version-diff-${block.kind}` });

        if (block.kind === 'move') {
            el.createSpan({ cls: 'atoz-version-diff-tag', text: t('versionManager.movedTag') });
        }

        for (const span of block.spans) {
            el.createSpan({ cls: `atoz-version-diff-${span.op}`, text: span.text });
        }
    }
}
