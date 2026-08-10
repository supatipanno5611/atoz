import {
    Component,
    ItemView,
    MarkdownRenderer,
    MarkdownView,
    Notice,
    setIcon,
    SuggestModal,
    TFile,
    WorkspaceLeaf,
} from 'obsidian';
import type ATOZPlugin from '../main';
import type { WritingTargetPreset } from '../types';
import { t } from '../locales';
import { isRecord } from '../utils';

export const VIEW_TYPE_CHARACTER_COUNT = 'character-count-view';
const UPDATE_DELAY = 100;

interface CharacterStats {
    withSpaces: number;
    withoutSpaces: number;
    nonEmptyLines: number;
    writingTarget: WritingTargetState;
}

type WritingTargetState =
    | { kind: 'none' }
    | { kind: 'invalid' }
    | { kind: 'valid'; target: number; tolerance: number };

type WritingTargetChoice =
    | { kind: 'clear' }
    | { kind: 'preset'; preset: WritingTargetPreset };

export class CharacterCountView extends ItemView {
    private withSpacesEl: HTMLElement | null = null;
    private withoutSpacesEl: HTMLElement | null = null;
    private nonEmptyLinesEl: HTMLElement | null = null;
    private readingTimeEl: HTMLElement | null = null;
    private writingTargetSectionEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_CHARACTER_COUNT; }
    getDisplayText(): string { return t('info.viewName'); }
    getIcon(): string { return 'letter-text'; }

    async onOpen(): Promise<void> {
        this.contentEl.empty();

        const wrapper = this.contentEl.createDiv({ cls: 'character-count-container' });

        const toolbar = wrapper.createDiv({ cls: 'character-count-toolbar' });
        const targetButton = toolbar.createEl('button', { cls: 'clickable-icon' });
        targetButton.setAttr('aria-label', t('info.setTarget'));
        targetButton.setAttr('title', t('info.setTarget'));
        setIcon(targetButton, 'target');
        targetButton.addEventListener('click', () => this.plugin.info.openWritingTargetPicker());

        const createStat = (labelText: string, tooltip: string): HTMLElement => {
            const section = wrapper.createDiv({ cls: 'character-count-stat' });

            const label = section.createDiv({ cls: 'character-count-label', text: labelText });
            label.setAttr('aria-label', tooltip);

            const value = section.createDiv({ cls: 'character-count-value', text: '—' });
            return value;
        };

        this.withSpacesEl = createStat(
            t('info.withSpaces.label'),
            t('info.withSpaces.desc'),
        );
        this.withoutSpacesEl = createStat(
            t('info.withoutSpaces.label'),
            t('info.withoutSpaces.desc'),
        );
        this.nonEmptyLinesEl = createStat(
            t('info.nonEmptyLines.label'),
            t('info.nonEmptyLines.desc'),
        );
        this.readingTimeEl = createStat(
            t('info.readingTime.label'),
            t('info.readingTime.desc'),
        );
        this.writingTargetSectionEl = wrapper.createDiv();

        await this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.withSpacesEl || !this.withoutSpacesEl || !this.nonEmptyLinesEl ||
            !this.readingTimeEl || !this.writingTargetSectionEl) return;

        const stats = await this.plugin.info.getCharacterStats();
        if (!stats) {
            this.withSpacesEl.setText('—');
            this.withoutSpacesEl.setText('—');
            this.nonEmptyLinesEl.setText('—');
            this.readingTimeEl.setText('—');
            this.writingTargetSectionEl.empty();
            return;
        }

        this.withSpacesEl.setText(stats.withSpaces.toLocaleString());
        this.withoutSpacesEl.setText(stats.withoutSpaces.toLocaleString());
        this.nonEmptyLinesEl.setText(stats.nonEmptyLines.toLocaleString());
        this.readingTimeEl.setText(this.plugin.info.formatReadingTime(stats));
        this.renderWritingTarget(stats);
    }

    private renderWritingTarget(stats: CharacterStats): void {
        if (!this.writingTargetSectionEl) return;
        this.writingTargetSectionEl.empty();
        if (stats.writingTarget.kind === 'none') return;

        const section = this.writingTargetSectionEl.createDiv({ cls: 'character-count-stat' });

        const label = section.createDiv({ cls: 'character-count-label', text: t('info.writingTarget') });
        label.setAttr('aria-label', t('info.targetDifference'));

        if (stats.writingTarget.kind === 'invalid') {
            section.createDiv({ cls: 'character-count-value', text: t('info.invalidTarget') });
        } else {
            const { target, tolerance } = stats.writingTarget;
            const delta = target - stats.withSpaces;
            const lower = target - tolerance;
            const upper = target + tolerance;
            const isSafe = stats.withSpaces >= lower && stats.withSpaces <= upper;
            const deltaText = isSafe
                ? `± ${Math.abs(delta).toLocaleString()}`
                : delta > 0
                    ? `+ ${delta.toLocaleString()}`
                    : `- ${Math.abs(delta).toLocaleString()}`;
            section.createDiv({ cls: 'character-count-value', text: deltaText });
        }
    }
}

export class InfoFeature {
    private updateTimer: number | null = null;

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.registerView(
            VIEW_TYPE_CHARACTER_COUNT,
            (leaf) => new CharacterCountView(leaf, this.plugin),
        );

        this.plugin.addCommand({
            id: 'show-character-count',
            name: t('command.viewDocumentInfo'),
            callback: async () => this.activateView(),
        });

        this.plugin.addCommand({
            id: 'set-writing-target',
            name: t('command.setWritingTarget'),
            callback: () => this.openWritingTargetPicker(),
        });

        this.plugin.addRibbonIcon('letter-text', t('ribbon.viewDocumentInfo'), async () => this.activateView());

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', () => this.scheduleUpdate()),
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('file-open', () => this.scheduleUpdate()),
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('editor-change', () => this.scheduleUpdate()),
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('layout-change', () => this.scheduleUpdate()),
        );

        this.plugin.registerEvent(
            this.plugin.app.metadataCache.on('changed', (file) => {
                if (file.path === this.plugin.app.workspace.getActiveFile()?.path) {
                    this.scheduleUpdate();
                }
            }),
        );

        this.plugin.app.workspace.onLayoutReady(() => {
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
        const leaf = this.plugin.app.workspace.getMostRecentLeaf();
        if (!(leaf?.view instanceof MarkdownView) || !leaf.view.file) return null;

        const source = leaf.view.editor.getValue();
        const stats = await this.analyzeRenderedText(removeFrontmatter(source), leaf.view.file.path);
        return {
            ...stats,
            writingTarget: this.getWritingTargetState(leaf.view.file),
        };
    }

    formatReadingTime(stats: CharacterStats): string {
        const characterCount = this.plugin.settings.readingTimeCharacterBasis === 'with-spaces'
            ? stats.withSpaces
            : stats.withoutSpaces;
        if (characterCount === 0) return '—';

        const minutes = characterCount / this.plugin.settings.readingCharactersPerMinute;
        return Math.max(1, Math.round(minutes)).toLocaleString();
    }

    getWritingTargetPresets(): WritingTargetPreset[] {
        return this.plugin.settings.writingTargetPresets.filter((preset) =>
            Number.isInteger(preset.target) && preset.target > 0 &&
            Number.isInteger(preset.tolerance) && preset.tolerance > 0 &&
            preset.tolerance < preset.target
        );
    }

    openWritingTargetPicker(): void {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== 'md') {
            new Notice(t('info.openMarkdownFirst'));
            return;
        }

        const presets = this.getWritingTargetPresets();
        const current = this.getWritingTargetState(file);
        if (presets.length === 0 && current.kind === 'none') {
            new Notice(t('info.addPresetFirst'));
            return;
        }

        new WritingTargetPicker(
            this.plugin,
            presets,
            current.kind !== 'none',
            (choice) => {
                void this.setWritingTarget(choice.kind === 'preset' ? choice.preset : null, file);
            },
        ).open();
    }

    async setWritingTarget(preset: WritingTargetPreset | null, file?: TFile): Promise<void> {
        const targetFile = file ?? this.plugin.app.workspace.getActiveFile();
        if (!(targetFile instanceof TFile) || targetFile.extension !== 'md') return;

        await this.plugin.app.fileManager.processFrontMatter(targetFile, (frontmatter) => {
            const properties = frontmatter as Record<string, unknown>;
            if (preset) {
                properties['target-characters'] = preset.target;
                properties['target-tolerance'] = preset.tolerance;
            } else {
                delete properties['target-characters'];
                delete properties['target-tolerance'];
            }
        });
        this.scheduleUpdate();
    }

    settingsChanged(): void {
        this.scheduleUpdate();
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

    private getWritingTargetState(file: TFile): WritingTargetState {
        const frontmatter: unknown = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!isRecord(frontmatter)) return { kind: 'none' };
        const targetValue = frontmatter?.['target-characters'];
        const toleranceValue = frontmatter?.['target-tolerance'];
        if (targetValue === undefined && toleranceValue === undefined) return { kind: 'none' };
        if (!Number.isInteger(targetValue) || Number(targetValue) < 1 ||
            !Number.isInteger(toleranceValue) || Number(toleranceValue) < 1 ||
            Number(toleranceValue) >= Number(targetValue)) {
            return { kind: 'invalid' };
        }
        return {
            kind: 'valid',
            target: Number(targetValue),
            tolerance: Number(toleranceValue),
        };
    }

    private async analyzeRenderedText(
        source: string,
        sourcePath: string,
    ): Promise<Omit<CharacterStats, 'writingTarget'>> {
        if (source.length === 0) {
            return { withSpaces: 0, withoutSpaces: 0, nonEmptyLines: 0 };
        }

        const container = createDiv();
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

class WritingTargetPicker extends SuggestModal<WritingTargetChoice> {
    constructor(
        plugin: ATOZPlugin,
        private presets: WritingTargetPreset[],
        private hasCurrentTarget: boolean,
        private choose: (choice: WritingTargetChoice) => void,
    ) {
        super(plugin.app);
        this.setPlaceholder(t('info.targetModalPlaceholder'));
    }

    getSuggestions(query: string): WritingTargetChoice[] {
        const normalized = query.trim().replace(/[,자\s]/g, '');
        const choices = this.presets.filter((preset) => !normalized ||
            preset.target.toString().includes(normalized) ||
            preset.tolerance.toString().includes(normalized)
        ).map((preset): WritingTargetChoice => ({ kind: 'preset', preset }));
        return this.hasCurrentTarget ? [{ kind: 'clear' }, ...choices] : choices;
    }

    renderSuggestion(choice: WritingTargetChoice, el: HTMLElement): void {
        el.setText(choice.kind === 'preset'
            ? t('info.targetChoice', {
                target: choice.preset.target.toLocaleString(),
                tolerance: choice.preset.tolerance.toLocaleString(),
            })
            : t('info.clearTarget'));
    }

    onChooseSuggestion(choice: WritingTargetChoice): void {
        this.choose(choice);
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
        if (!node.instanceOf(HTMLElement)) return;
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
