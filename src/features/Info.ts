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
import { EditorView } from '@codemirror/view';
import type ATOZPlugin from '../main';
import {
    isSameWritingTarget,
    isSameWritingTargetKey,
    isValidWritingTarget,
    parseWritingTargetInput,
    type WritingTargetPreset,
} from '../types';
import { t } from '../locales';
import { isRecord } from '../utils';

export const VIEW_TYPE_CHARACTER_COUNT = 'character-count-view';
const UPDATE_DELAY = 100;

interface CharacterStats {
    withSpaces: number;
    withoutSpaces: number;
    nonEmptyLines: number;
    selection: { withSpaces: number; withoutSpaces: number } | null;
    writingTarget: WritingTargetState;
}

type WritingTargetState =
    | { kind: 'none' }
    | { kind: 'invalid' }
    | { kind: 'valid'; preset: WritingTargetPreset };

type WritingTargetChoice =
    | { kind: 'clear' }
    | { kind: 'preset'; preset: WritingTargetPreset }
    | { kind: 'custom'; preset: WritingTargetPreset; save: boolean };

const WRITING_TARGET_KEYS = ['target-characters', 'target-tolerance', 'min-characters', 'max-characters'];

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

        // 선택 영역이 있으면 공백 포함·제외 글자 수를 `선택 / 전체`로 표시한다.
        const withSelection = (selected: number | undefined, total: number): string =>
            selected === undefined
                ? total.toLocaleString()
                : `${selected.toLocaleString()} / ${total.toLocaleString()}`;
        this.withSpacesEl.setText(withSelection(stats.selection?.withSpaces, stats.withSpaces));
        this.withoutSpacesEl.setText(withSelection(stats.selection?.withoutSpaces, stats.withoutSpaces));
        this.nonEmptyLinesEl.setText(stats.nonEmptyLines.toLocaleString());
        this.readingTimeEl.setText(this.plugin.info.formatReadingTime(stats));
        this.renderWritingTarget(stats);
    }

    private renderWritingTarget(stats: CharacterStats): void {
        if (!this.writingTargetSectionEl) return;
        this.writingTargetSectionEl.empty();
        if (stats.writingTarget.kind === 'none') return;

        const section = this.writingTargetSectionEl.createDiv({ cls: 'character-count-stat' });
        const preset = stats.writingTarget.kind === 'valid' ? stats.writingTarget.preset : null;

        const label = section.createDiv({
            cls: 'character-count-label',
            text: preset?.kind === 'min'
                ? t('info.minTarget')
                : preset?.kind === 'max' ? t('info.maxTarget') : t('info.writingTarget'),
        });
        label.setAttr('aria-label', preset?.kind === 'min'
            ? t('info.minDifference')
            : preset?.kind === 'max' ? t('info.maxDifference') : t('info.targetDifference'));

        if (!preset) {
            section.createDiv({ cls: 'character-count-value', text: t('info.invalidTarget') });
        } else if (preset.kind === 'range') {
            const { target, tolerance } = preset;
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
        } else {
            // 조건을 만족하면 ✓와 여유분, 아니면 채우거나 줄여야 할 글자 수를 표시한다.
            const margin = preset.kind === 'min'
                ? stats.withSpaces - preset.value
                : preset.value - stats.withSpaces;
            const deltaText = margin >= 0
                ? `✓ ${margin.toLocaleString()}`
                : `${preset.kind === 'min' ? '+' : '-'} ${Math.abs(margin).toLocaleString()}`;
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

        // Obsidian에는 선택 변경 이벤트가 없어서 CodeMirror에서 직접 받는다.
        this.plugin.registerEditorExtension(
            EditorView.updateListener.of((update) => {
                if (update.selectionSet) this.scheduleUpdate();
            }),
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

        const { editor, file } = leaf.view;
        const stats = await this.analyzeRenderedText(removeFrontmatter(editor.getValue()), file.path);

        // 읽기 모드에서는 에디터 선택이 화면에 보이지 않으므로 편집 모드에서만 센다.
        let selection: CharacterStats['selection'] = null;
        if (leaf.view.getMode() === 'source' && editor.somethingSelected()) {
            const selectedText = editor.listSelections()
                .map(({ anchor, head }) => editor.posToOffset(anchor) <= editor.posToOffset(head)
                    ? editor.getRange(anchor, head)
                    : editor.getRange(head, anchor))
                .join('\n');
            const { withSpaces, withoutSpaces } = await this.analyzeRenderedText(
                removeFrontmatter(selectedText),
                file.path,
            );
            selection = { withSpaces, withoutSpaces };
        }

        return {
            ...stats,
            selection,
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
        return this.plugin.settings.writingTargetPresets.filter(isValidWritingTarget);
    }

    openWritingTargetPicker(): void {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== 'md') {
            new Notice(t('info.openMarkdownFirst'));
            return;
        }

        new WritingTargetPicker(
            this.plugin,
            this.getWritingTargetPresets(),
            this.getWritingTargetState(file).kind !== 'none',
            (choice) => {
                void this.setWritingTarget(choice.kind === 'clear' ? null : choice.preset, file);
                if (choice.kind === 'custom' && choice.save) void this.addWritingTargetPreset(choice.preset);
            },
        ).open();
    }

    async setWritingTarget(preset: WritingTargetPreset | null, file?: TFile): Promise<void> {
        const targetFile = file ?? this.plugin.app.workspace.getActiveFile();
        if (!(targetFile instanceof TFile) || targetFile.extension !== 'md') return;

        await this.plugin.app.fileManager.processFrontMatter(targetFile, (frontmatter) => {
            const properties = frontmatter as Record<string, unknown>;
            for (const key of WRITING_TARGET_KEYS) delete properties[key];
            if (preset?.kind === 'range') {
                properties['target-characters'] = preset.target;
                properties['target-tolerance'] = preset.tolerance;
            } else if (preset?.kind === 'min') {
                properties['min-characters'] = preset.value;
            } else if (preset?.kind === 'max') {
                properties['max-characters'] = preset.value;
            }
        });
        this.scheduleUpdate();
    }

    private async addWritingTargetPreset(preset: WritingTargetPreset): Promise<void> {
        this.plugin.settings.writingTargetPresets.push(preset);
        await this.plugin.saveSettings();
        new Notice(t('info.presetSaved', { target: formatWritingTarget(preset) }));
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
        const targetValue = frontmatter['target-characters'];
        const toleranceValue = frontmatter['target-tolerance'];
        const minValue = frontmatter['min-characters'];
        const maxValue = frontmatter['max-characters'];
        const hasRange = targetValue !== undefined || toleranceValue !== undefined;
        const kindCount = [hasRange, minValue !== undefined, maxValue !== undefined].filter(Boolean).length;
        if (kindCount === 0) return { kind: 'none' };
        if (kindCount > 1) return { kind: 'invalid' };

        // 문자열 숫자는 받지 않도록 정수가 아니면 NaN으로 넘겨 검증에서 걸러낸다.
        const toInteger = (value: unknown): number => Number.isInteger(value) ? Number(value) : NaN;
        const preset: WritingTargetPreset = hasRange
            ? { kind: 'range', target: toInteger(targetValue), tolerance: toInteger(toleranceValue) }
            : minValue !== undefined
                ? { kind: 'min', value: toInteger(minValue) }
                : { kind: 'max', value: toInteger(maxValue) };
        return isValidWritingTarget(preset) ? { kind: 'valid', preset } : { kind: 'invalid' };
    }

    private async analyzeRenderedText(
        source: string,
        sourcePath: string,
    ): Promise<Omit<CharacterStats, 'selection' | 'writingTarget'>> {
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
        this.setInstructions([{ command: t('info.saveCommand'), purpose: t('info.saveInstruction') }]);
    }

    getSuggestions(query: string): WritingTargetChoice[] {
        // 입력과 겹치는 후보가 있으면 직접 입력 대신 그 후보를 맨 위에 보여준다.
        // 저장할 때는 같은 종류와 글자 수의 후보도 겹치는 것으로 본다.
        const { presets: customs, save } = parseWritingTargetInput(query);
        const head: WritingTargetChoice[] = [];
        const existing: WritingTargetPreset[] = [];
        for (const custom of customs) {
            const match = this.presets.find((preset) => save
                ? isSameWritingTargetKey(preset, custom)
                : isSameWritingTarget(preset, custom));
            if (match) {
                head.push({ kind: 'preset', preset: match });
                existing.push(match);
            } else {
                head.push({ kind: 'custom', preset: custom, save });
            }
        }

        const normalized = query.trim().replace(/[,자\s]/g, '');
        const choices = this.presets.filter((preset) => !existing.includes(preset) && (!normalized ||
            (preset.kind === 'range' ? [preset.target, preset.tolerance] : [preset.value])
                .some((value) => value.toString().includes(normalized))
        )).map((preset): WritingTargetChoice => ({ kind: 'preset', preset }));
        const clear: WritingTargetChoice[] = this.hasCurrentTarget ? [{ kind: 'clear' }] : [];
        return [...head, ...clear, ...choices];
    }

    renderSuggestion(choice: WritingTargetChoice, el: HTMLElement): void {
        if (choice.kind === 'clear') {
            el.setText(t('info.clearTarget'));
        } else if (choice.kind === 'preset') {
            el.setText(formatWritingTarget(choice.preset));
        } else {
            el.setText(t(choice.save ? 'info.customSaveChoice' : 'info.customChoice', {
                target: formatWritingTarget(choice.preset),
            }));
        }
    }

    onChooseSuggestion(choice: WritingTargetChoice): void {
        this.choose(choice);
    }
}

function formatWritingTarget(preset: WritingTargetPreset): string {
    if (preset.kind === 'range') {
        return t('info.targetChoice', {
            target: preset.target.toLocaleString(),
            tolerance: preset.tolerance.toLocaleString(),
        });
    }
    return t(preset.kind === 'min' ? 'info.minChoice' : 'info.maxChoice', {
        value: preset.value.toLocaleString(),
    });
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
