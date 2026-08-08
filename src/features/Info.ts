import {
    Component,
    ItemView,
    MarkdownRenderer,
    MarkdownView,
    TFile,
    WorkspaceLeaf,
} from 'obsidian';
import type ATOZPlugin from '../main';

export const VIEW_TYPE_CHARACTER_COUNT = 'character-count-view';
const UPDATE_DELAY = 100;

interface CharacterStats {
    withSpaces: number;
    withoutSpaces: number;
    nonEmptyLines: number;
}

export class CharacterCountView extends ItemView {
    private withSpacesEl: HTMLElement | null = null;
    private withoutSpacesEl: HTMLElement | null = null;
    private nonEmptyLinesEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_CHARACTER_COUNT; }
    getDisplayText(): string { return '문서 정보'; }
    getIcon(): string { return 'letter-text'; }

    async onOpen(): Promise<void> {
        this.contentEl.empty();

        const wrapper = this.contentEl.createDiv({ cls: 'character-count-container' });
        wrapper.setCssProps({ padding: '16px' });

        const createStat = (labelText: string, tooltip: string): HTMLElement => {
            const section = wrapper.createDiv();
            section.setCssProps({ marginBottom: '20px' });

            const label = section.createDiv({ text: labelText });
            label.setCssProps({
                fontSize: '0.85em',
                color: 'var(--text-muted)',
                marginBottom: '6px',
            });
            label.setAttr('aria-label', tooltip);

            const value = section.createDiv({ text: '—' });
            value.setCssProps({
                fontSize: '2em',
                fontWeight: '600',
                lineHeight: '1.1',
                fontVariantNumeric: 'tabular-nums',
            });
            return value;
        };

        this.withSpacesEl = createStat(
            '공백 포함',
            '프론트매터와 Markdown 문법을 제외하고 공백을 포함한 글자 수',
        );
        this.withoutSpacesEl = createStat(
            '공백 제외',
            '프론트매터와 Markdown 문법을 제외하고 공백까지 제외한 글자 수',
        );
        this.nonEmptyLinesEl = createStat(
            '글자가 있는 행',
            '실제로 읽을 수 있는 글자가 존재하는 행 수',
        );

        await this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.withSpacesEl || !this.withoutSpacesEl || !this.nonEmptyLinesEl) return;

        const stats = await this.plugin.info.getCharacterStats();
        if (!stats) {
            this.withSpacesEl.setText('—');
            this.withoutSpacesEl.setText('—');
            this.nonEmptyLinesEl.setText('—');
            return;
        }

        this.withSpacesEl.setText(stats.withSpaces.toLocaleString());
        this.withoutSpacesEl.setText(stats.withoutSpaces.toLocaleString());
        this.nonEmptyLinesEl.setText(stats.nonEmptyLines.toLocaleString());
    }
}

export class InfoFeature {
    private lastMarkdownFile: TFile | null = null;
    private lastMarkdownView: MarkdownView | null = null;
    private updateTimer: number | null = null;

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.registerView(
            VIEW_TYPE_CHARACTER_COUNT,
            (leaf) => new CharacterCountView(leaf, this.plugin),
        );

        this.plugin.addCommand({
            id: 'show-character-count',
            name: '문서 정보 보기',
            callback: async () => this.activateView(),
        });

        this.plugin.addRibbonIcon('letter-text', '문서 정보 보기', async () => this.activateView());

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf?.view instanceof MarkdownView) this.rememberMarkdownView(leaf.view);
                this.scheduleUpdate();
            }),
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('file-open', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.lastMarkdownFile = file;
                    const view = this.findMarkdownViewForFile(file);
                    if (view) this.lastMarkdownView = view;
                }
                this.scheduleUpdate();
            }),
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('editor-change', (_editor, info) => {
                if (info instanceof MarkdownView) this.rememberMarkdownView(info);
                this.scheduleUpdate();
            }),
        );

        this.plugin.app.workspace.onLayoutReady(() => {
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (view) this.rememberMarkdownView(view);
            this.scheduleUpdate();
        });
    }

    uninstall(): void {
        if (this.updateTimer !== null) {
            window.clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_CHARACTER_COUNT);
    }

    async activateView(): Promise<void> {
        const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHARACTER_COUNT);
        if (existing.length > 0) {
            await this.plugin.app.workspace.revealLeaf(existing[0]!);
            return;
        }

        const leaf = this.plugin.app.workspace.getLeftLeaf(false);
        if (!leaf) return;

        await leaf.setViewState({ type: VIEW_TYPE_CHARACTER_COUNT, active: true });
        await this.plugin.app.workspace.revealLeaf(leaf);
    }

    async getCharacterStats(): Promise<CharacterStats | null> {
        const file = this.resolveCurrentMarkdownFile();
        if (!file) return null;

        const view = this.resolveMarkdownView(file);
        const source = view
            ? view.editor.getValue()
            : await this.plugin.app.vault.cachedRead(file);

        return this.analyzeRenderedText(removeFrontmatter(source), file.path);
    }

    private rememberMarkdownView(view: MarkdownView): void {
        if (!view.file) return;
        this.lastMarkdownView = view;
        this.lastMarkdownFile = view.file;
    }

    private findMarkdownViewForFile(file: TFile): MarkdownView | null {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
                return leaf.view;
            }
        }
        return null;
    }

    private scheduleUpdate(): void {
        if (this.updateTimer !== null) window.clearTimeout(this.updateTimer);
        this.updateTimer = window.setTimeout(() => {
            this.updateTimer = null;
            void this.refreshViews();
        }, UPDATE_DELAY);
    }

    private async refreshViews(): Promise<void> {
        const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHARACTER_COUNT);
        for (const leaf of leaves) {
            if (leaf.view instanceof CharacterCountView) await leaf.view.refresh();
        }
    }

    private resolveCurrentMarkdownFile(): TFile | null {
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file) {
            this.rememberMarkdownView(activeView);
            return activeView.file;
        }

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile instanceof TFile && activeFile.extension === 'md') {
            this.lastMarkdownFile = activeFile;
            return activeFile;
        }
        return this.lastMarkdownFile;
    }

    private resolveMarkdownView(file: TFile): MarkdownView | null {
        if (this.lastMarkdownView?.file?.path === file.path) return this.lastMarkdownView;

        const view = this.findMarkdownViewForFile(file);
        if (view) this.lastMarkdownView = view;
        return view;
    }

    private async analyzeRenderedText(source: string, sourcePath: string): Promise<CharacterStats> {
        if (source.length === 0) {
            return { withSpaces: 0, withoutSpaces: 0, nonEmptyLines: 0 };
        }

        const container = document.createElement('div');
        const component = new Component();
        component.load();

        try {
            await MarkdownRenderer.render(
                this.plugin.app,
                source,
                container,
                sourcePath,
                component,
            );

            cleanRenderedMarkdown(container);
            const normalized = renderedDomToText(container)
                .replace(/\r\n?/g, '\n')
                .replace(/\u00a0/g, ' ');

            const withSpaces = normalized.replace(/\n/g, '').length;
            const withoutSpaces = normalized.replace(/\s/gu, '').length;
            const nonEmptyLines = normalized
                .split('\n')
                .filter((line) => line.replace(/\s/gu, '').length > 0)
                .length;

            return { withSpaces, withoutSpaces, nonEmptyLines };
        } finally {
            component.unload();
            container.remove();
        }
    }
}

function removeFrontmatter(source: string): string {
    if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

    const lines = source.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return source;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (line === '---' || line === '...') return lines.slice(i + 1).join('\n');
    }
    return source;
}

function cleanRenderedMarkdown(container: HTMLElement): void {
    container.querySelectorAll('pre').forEach((el) => el.remove());
    container.querySelectorAll('img').forEach((el) => el.remove());
    container.querySelectorAll([
        '.internal-embed',
        '.markdown-embed',
        '.image-embed',
        '.file-embed',
    ].join(', ')).forEach((el) => el.remove());
    container.querySelectorAll([
        '.math',
        '.math-block',
        '.math-inline',
        'mjx-container',
    ].join(', ')).forEach((el) => el.remove());
    container.querySelectorAll('a.tag').forEach((el) => el.remove());
    container.querySelectorAll([
        '.footnote-ref',
        'sup.footnote-ref',
    ].join(', ')).forEach((el) => el.remove());
    container.querySelectorAll([
        '.footnotes',
        'section.footnotes',
    ].join(', ')).forEach((el) => el.remove());
    container.querySelectorAll([
        'script',
        'style',
        'template',
    ].join(', ')).forEach((el) => el.remove());
    container.querySelectorAll('hr').forEach((el) => el.remove());
}

function renderedDomToText(container: HTMLElement): string {
    const blockTags = new Set<string>([
        'ADDRESS',
        'ARTICLE',
        'ASIDE',
        'BLOCKQUOTE',
        'DIV',
        'DL',
        'DT',
        'DD',
        'FIGCAPTION',
        'FIGURE',
        'FOOTER',
        'FORM',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'HEADER',
        'LI',
        'MAIN',
        'NAV',
        'OL',
        'P',
        'SECTION',
        'TABLE',
        'TBODY',
        'THEAD',
        'TFOOT',
        'TR',
        'UL',
    ]);

    let result = '';
    const appendNewline = (): void => {
        if (result.length > 0 && !result.endsWith('\n')) result += '\n';
    };

    const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent ?? '';
            return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node.tagName === 'BR') {
            result += '\n';
            return;
        }

        const isBlock = blockTags.has(node.tagName);
        if (isBlock) appendNewline();
        for (const child of Array.from(node.childNodes)) walk(child);
        if (isBlock) appendNewline();
    };

    for (const child of Array.from(container.childNodes)) walk(child);

    return result
        .replace(/\n{2,}/g, '\n')
        .replace(/^\n+|\n+$/g, '');
}
