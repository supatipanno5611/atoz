import {
    App,
    Notice,
    SuggestModal,
    TFile,
    parseFrontMatterAliases,
    parseLinktext,
    stripHeadingForLink,
} from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { isRecord } from '../utils';

type FrontmatterRecord = Record<string, unknown>;

export interface TopicSource {
    includeExcludedTarget?: boolean;
    kind: 'note' | 'topic';
    value: string;
    sourcePath: string;
}

interface ParsedTopic {
    alias?: string;
    file: TFile | null;
    identity: string;
    linkpath: string;
    subpath: string;
    targetLabel: string;
}

interface TopicTarget extends ParsedTopic {
    aliases: string[];
}

interface NoteMatch {
    alias?: string;
    target: TopicTarget;
}

interface SubpathQuery {
    base: string;
    filter: string;
    type: 'block' | 'heading';
}

type TopicSuggestion =
    | { kind: 'done' }
    | { kind: 'message'; label: string }
    | {
        alias?: string;
        detail?: string;
        kind: 'topic';
        label: string;
        status: 'add' | 'remove' | 'update';
        target: TopicTarget;
    }
    | {
        alias?: string;
        detail?: string;
        kind: 'new';
        label: string;
        status: 'add' | 'remove' | 'update';
        target: TopicTarget;
    };

function getLocalDate(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const ALLOWED_PROPERTIES = new Set([
    'date',
    'topics',
    'title',
    'description',
    'cssclasses',
    'aliases',
    'tags',
    'later',
    'target-characters',
    'target-tolerance',
]);

// 토픽 관리를 위한 마커 상수들
const NEW_ITEM_PREFIX = t('properties.addPrefix');
const NEW_ITEM_SUFFIX = t('properties.addSuffix');
const DONE_LABEL = t('properties.done');
const SELECTED_PREFIX = t('properties.selectedPrefix');
const UPDATE_PREFIX = t('properties.updatePrefix');

// 토픽 관련 유틸리티 함수
function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function unwrapWikiLink(value: string): { alias?: string; linktext: string } {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[[') || !trimmed.endsWith(']]')) {
        return { linktext: trimmed };
    }

    const inner = trimmed.slice(2, -2);
    const aliasSeparator = inner.indexOf('|');
    if (aliasSeparator === -1) return { linktext: inner.trim() };

    const alias = inner.slice(aliasSeparator + 1).trim();
    return {
        alias: alias || undefined,
        linktext: inner.slice(0, aliasSeparator).trim(),
    };
}

function parseTopic(app: App, value: string, sourcePath: string): ParsedTopic | null {
    const { alias, linktext } = unwrapWikiLink(value);
    if (!linktext) return null;

    const { path, subpath } = parseLinktext(linktext);
    const linkpath = path.trim();
    if (!linkpath) return null;

    const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    const resolvedPath = file ? file.path.replace(/\.md$/i, '') : linkpath;
    return {
        alias,
        file,
        identity: `${file ? `file:${file.path}` : `link:${linkpath}`}|${subpath}`,
        linkpath,
        subpath,
        targetLabel: `${resolvedPath}${subpath}`,
    };
}

function topicAliases(app: App, file: TFile | null): string[] {
    if (!file) return [];
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    return [...(parseFrontMatterAliases(frontmatter) ?? [])];
}

function addSubpathToAlias(alias: string, subpath: string): string {
    if (!subpath) return alias;
    if (subpath.startsWith('#^')) return `${alias}^${subpath.slice(2)}`;
    return `${alias}${subpath}`;
}

function buildTopicTargets(app: App, sources: TopicSource[]): TopicTarget[] {
    const targets = new Map<string, TopicTarget>();
    const allowedFilePaths = new Set(
        sources
            .filter((source) => source.kind === 'note')
            .map((source) => parseTopic(app, source.value, source.sourcePath)?.file?.path)
            .filter((path): path is string => path !== undefined),
    );

    for (const source of sources) {
        const parsed = parseTopic(app, source.value, source.sourcePath);
        if (!parsed) continue;
        if (source.kind === 'topic' && parsed.file && !allowedFilePaths.has(parsed.file.path) &&
            !source.includeExcludedTarget) continue;

        const existing = targets.get(parsed.identity);
        if (existing) {
            if (parsed.alias && !existing.aliases.includes(parsed.alias)) {
                existing.aliases.push(parsed.alias);
            }
            continue;
        }

        const aliases = topicAliases(app, parsed.file)
            .map((alias) => addSubpathToAlias(alias, parsed.subpath))
            .filter((alias) => alias !== parsed.targetLabel);
        if (parsed.alias && !aliases.includes(parsed.alias)) aliases.push(parsed.alias);
        aliases.sort((a, b) => a.localeCompare(b));
        targets.set(parsed.identity, { ...parsed, aliases });
    }

    return [...targets.values()];
}

function topicDisplayLabel(value: string): string {
    const { alias, linktext } = unwrapWikiLink(value);
    return alias ?? linktext;
}

function sortTopics(topics: string[]): void {
    topics.sort((a, b) => topicDisplayLabel(a).localeCompare(topicDisplayLabel(b)));
}

function parseSubpathQuery(query: string): SubpathQuery | null {
    const trimmed = query.trim();
    if (trimmed.startsWith('[[')) return null;

    const blockIndex = trimmed.indexOf('^');
    if (blockIndex > 0) {
        const rawBase = trimmed.slice(0, blockIndex);
        const base = (rawBase.endsWith('#') ? rawBase.slice(0, -1) : rawBase).trim();
        return base ? { base, filter: trimmed.slice(blockIndex + 1).trim(), type: 'block' } : null;
    }

    const headingIndex = trimmed.indexOf('#');
    if (headingIndex > 0) {
        const base = trimmed.slice(0, headingIndex).trim();
        return base ? { base, filter: trimmed.slice(headingIndex + 1).trim(), type: 'heading' } : null;
    }

    return null;
}

function previewBlock(content: string, startLine: number, endLine: number): string {
    const lines = content.split(/\r?\n/).slice(startLine, endLine + 1);
    const preview = lines.join(' ').replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').replace(/\s+/g, ' ').trim();
    return preview.length > 80 ? `${preview.slice(0, 80).trimEnd()}…` : preview;
}

function isEmptyProperty(value: unknown): boolean {
    return value === null || value === undefined || value === '' ||
        (Array.isArray(value) && value.length === 0);
}

export class PropertiesFeature {
	private tempData = new Map<string, { title: string; desc: string; aliases: string }>();
	
    constructor(private plugin: ATOZPlugin) {}

    async lintProperties(): Promise<void> {
        const files = this.plugin.app.vault.getMarkdownFiles();
        const excluded = new Set([
            'log.md',
            this.plugin.settings.workFilePath,
        ]);

        let cleanedCount = 0;
        let reviewCount = 0;

        for (const file of files) {
            if (excluded.has(file.path)) continue;

            const toReview = new Set<string>();
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                const fm = frontmatter as FrontmatterRecord;

                for (const key of Object.keys(fm)) {
                    if (ALLOWED_PROPERTIES.has(key)) continue;

                    const value = fm[key];
                    if (isEmptyProperty(value)) {
                        delete fm[key];
                        cleanedCount++;
                    } else {
                        toReview.add(key);
                    }
                }

                if (Array.isArray(fm.topics)) {
                	fm.topics = (fm.topics as unknown[]).map(v =>
                		typeof v === 'string' && v.startsWith('.') ? v.slice(1) : v
                	);
                }

                const sorted = Object.keys(fm).sort();
                const values = sorted.map(k => fm[k]);
                for (const key of Object.keys(fm)) delete fm[key];
                sorted.forEach((k, i) => fm[k] = values[i]);
            });

            if (toReview.size > 0) {
                const leaf = this.plugin.app.workspace.getLeaf('tab');
                await leaf.openFile(file);
                reviewCount++;
            }
        }

        if (cleanedCount === 0 && reviewCount === 0) {
            new Notice(t('properties.nothingToClean'));
            return;
        }

        new Notice(t('properties.cleaned', { cleaned: cleanedCount, review: reviewCount }));
    }

    async editTopics(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('properties.noActiveMarkdown'));
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            if (fm.topics === undefined) fm.topics = [];
        });
        this.openTopicEditor();
    }

    private openTopicEditor(): void {
        new TopicInputModal(this.plugin.app, this.plugin.collectTopicCandidates()).open();
    }

    async insertTodayDate(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('properties.noActiveMarkdown'));
            return;
        }

        let alreadyExists = false;
        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            if (fm.date !== undefined) {
                alreadyExists = true;
                return;
            }
            fm.date = getLocalDate();
        });

        if (alreadyExists) {
            new Notice(t('properties.dateExists'));
            return;
        }
        new Notice(t('properties.dateInserted'));
    }

    async updateTodayDate(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('properties.noActiveMarkdown'));
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.date = getLocalDate();
        });
        new Notice(t('properties.dateUpdated'));
    }
}


class TopicInputModal extends SuggestModal<TopicSuggestion> {
    private autocompleteHandled = false;
    private autocompleteRequested = false;
    private currentTopics: string[];
    private targets: TopicTarget[];

    constructor(app: App, private sources: TopicSource[], initialTopics?: string[]) {
        super(app);
        this.currentTopics = initialTopics ?? this.fetchInitialTopics();
        this.targets = buildTopicTargets(app, sources);
        this.setPlaceholder(t('properties.topicPlaceholder'));
        this.inputEl.addEventListener('keydown', (event) => this.handleAutocompleteKey(event));
    }

    private handleAutocompleteKey(event: KeyboardEvent): void {
        if (event.key !== ':' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;

        this.autocompleteHandled = false;
        this.autocompleteRequested = true;
        this.selectActiveSuggestion(event);
        this.autocompleteRequested = false;
        if (this.autocompleteHandled) event.preventDefault();
    }

    selectSuggestion(value: TopicSuggestion, event: MouseEvent | KeyboardEvent): void {
        if (!this.autocompleteRequested) {
            super.selectSuggestion(value, event);
            return;
        }
        if (value.kind !== 'topic' || !value.target.file || value.target.subpath) return;

        this.autocompleteHandled = true;
        this.inputEl.value = value.label;
        this.inputEl.setSelectionRange(value.label.length, value.label.length);
        const EventConstructor = this.inputEl.doc.defaultView?.Event ?? Event;
        this.inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    }

    private fetchInitialTopics(): string[] {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return [];
        const cache = this.app.metadataCache.getFileCache(activeFile);
        const frontmatter: unknown = cache?.frontmatter;
        return readStringArray(isRecord(frontmatter) ? frontmatter.topics : undefined);
    }

    private getCurrentTopics(): ParsedTopic[] {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return [];
        return this.currentTopics
            .map((value) => parseTopic(this.app, value, activeFile.path))
            .filter((topic): topic is ParsedTopic => topic !== null);
    }

    private getStatus(target: ParsedTopic, alias?: string): 'add' | 'remove' | 'update' {
        const matches = this.getCurrentTopics().filter((topic) => topic.identity === target.identity);
        if (matches.length === 0) return 'add';
        return matches.some((topic) => topic.alias === alias) ? 'remove' : 'update';
    }

    private getNewSuggestion(query: string): TopicSuggestion | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;
        const parsed = parseTopic(this.app, query, activeFile.path);
        if (!parsed) return null;
        const target: TopicTarget = {
            ...parsed,
            aliases: parsed.alias ? [parsed.alias] : [],
        };
        return {
            alias: parsed.alias,
            kind: 'new',
            label: parsed.alias ?? parsed.targetLabel,
            status: this.getStatus(parsed, parsed.alias),
            target,
        };
    }

    private getNoteMatches(base: string): NoteMatch[] {
        const lowered = base.toLowerCase();
        const matches = new Map<string, NoteMatch>();

        for (const target of this.targets) {
            if (target.subpath || !target.file) continue;
            const isDirectMatch = target.targetLabel.toLowerCase() === lowered ||
                target.file.basename.toLowerCase() === lowered;
            const matchedAlias = target.aliases.find((alias) => alias.toLowerCase() === lowered);
            if (!isDirectMatch && !matchedAlias) continue;

            const existing = matches.get(target.file.path);
            if (!existing || isDirectMatch) {
                matches.set(target.file.path, {
                    alias: isDirectMatch ? undefined : matchedAlias,
                    target,
                });
            }
        }

        return [...matches.values()];
    }

    private createSubpathTarget(match: NoteMatch, subpath: string): TopicTarget {
        const file = match.target.file;
        if (!file) return { ...match.target, aliases: [], subpath };
        const resolvedPath = file.path.replace(/\.md$/i, '');
        return {
            aliases: [],
            file,
            identity: `file:${file.path}|${subpath}`,
            linkpath: resolvedPath,
            subpath,
            targetLabel: `${resolvedPath}${subpath}`,
        };
    }

    private createSubpathSuggestion(
        match: NoteMatch,
        subpath: string,
        label: string,
        alias?: string,
        detail?: string,
        kind: 'new' | 'topic' = 'topic',
    ): TopicSuggestion {
        const target = this.createSubpathTarget(match, subpath);
        return {
            alias,
            detail,
            kind,
            label,
            status: this.getStatus(target, alias),
            target,
        };
    }

    private createUnresolvedSubpathSuggestion(query: SubpathQuery): TopicSuggestion | null {
        if (!query.filter) return null;
        const subpath = query.type === 'block' ? `#^${query.filter}` : `#${query.filter}`;
        const suggestion = this.getNewSuggestion(`${query.base}${subpath}`);
        if (!suggestion || suggestion.kind === 'done' || suggestion.kind === 'message') return null;
        return {
            ...suggestion,
            label: query.type === 'block' ? `${query.base}^${query.filter}` : `${query.base}#${query.filter}`,
        };
    }

    private sortSubpathSuggestions(suggestions: TopicSuggestion[], filter: string): void {
        const lowered = filter.toLowerCase();
        const rank = (value: TopicSuggestion): number => {
            if (value.kind === 'done' || value.kind === 'message') return 3;
            const label = value.label.toLowerCase();
            if (label === lowered || label.endsWith(`#${lowered}`) || label.endsWith(`^${lowered}`)) return 0;
            return label.includes(lowered) ? 1 : 2;
        };
        suggestions.sort((a, b) => {
            const labelA = a.kind === 'done' ? '' : a.label;
            const labelB = b.kind === 'done' ? '' : b.label;
            return rank(a) - rank(b) || labelA.localeCompare(labelB);
        });
    }

    private getHeadingSuggestions(query: SubpathQuery, matches: NoteMatch[]): TopicSuggestion[] {
        const lowered = query.filter.toLowerCase();
        const suggestions: TopicSuggestion[] = [];

        for (const match of matches) {
            const file = match.target.file;
            if (!file) continue;
            const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
            const seen = new Set<string>();
            for (const heading of headings) {
                const linkHeading = stripHeadingForLink(heading.heading);
                if (!linkHeading || seen.has(linkHeading)) continue;
                seen.add(linkHeading);
                if (lowered && !heading.heading.toLowerCase().includes(lowered)) continue;

                const alias = match.alias ? `${match.alias}#${heading.heading}` : undefined;
                suggestions.push(this.createSubpathSuggestion(
                    match,
                    `#${linkHeading}`,
                    alias ?? heading.heading,
                    alias,
                ));
            }
        }

        if (suggestions.length === 0 && query.filter) {
            for (const match of matches) {
                const alias = match.alias ? `${match.alias}#${query.filter}` : undefined;
                suggestions.push(this.createSubpathSuggestion(
                    match,
                    `#${query.filter}`,
                    alias ?? query.filter,
                    alias,
                    undefined,
                    'new',
                ));
            }
        }

        this.sortSubpathSuggestions(suggestions, query.filter);
        return suggestions.length > 0
            ? [...suggestions, { kind: 'done' }]
            : [{ kind: 'message', label: t('properties.topicNoHeadings') }];
    }

    private async getBlockSuggestions(query: SubpathQuery, matches: NoteMatch[]): Promise<TopicSuggestion[]> {
        const lowered = query.filter.toLowerCase();
        const suggestions: TopicSuggestion[] = [];

        for (const match of matches) {
            const file = match.target.file;
            if (!file) continue;
            const blocks = Object.values(this.app.metadataCache.getFileCache(file)?.blocks ?? {});
            const content = blocks.length > 0 ? await this.app.vault.cachedRead(file) : '';
            for (const block of blocks) {
                const preview = previewBlock(content, block.position.start.line, block.position.end.line);
                if (lowered && !block.id.toLowerCase().includes(lowered) &&
                    !preview.toLowerCase().includes(lowered)) continue;

                const alias = match.alias ? `${match.alias}^${block.id}` : undefined;
                suggestions.push(this.createSubpathSuggestion(
                    match,
                    `#^${block.id}`,
                    alias ?? (preview || block.id),
                    alias,
                    alias && preview ? preview : undefined,
                ));
            }
        }

        if (suggestions.length === 0 && query.filter) {
            for (const match of matches) {
                const alias = match.alias ? `${match.alias}^${query.filter}` : undefined;
                suggestions.push(this.createSubpathSuggestion(
                    match,
                    `#^${query.filter}`,
                    alias ?? query.filter,
                    alias,
                    undefined,
                    'new',
                ));
            }
        }

        this.sortSubpathSuggestions(suggestions, query.filter);
        return suggestions.length > 0
            ? [...suggestions, { kind: 'done' }]
            : [{ kind: 'message', label: t('properties.topicNoBlocks') }];
    }

    private async getSubpathSuggestions(query: SubpathQuery): Promise<TopicSuggestion[]> {
        const matches = this.getNoteMatches(query.base);
        if (matches.length === 0) {
            const unresolved = this.createUnresolvedSubpathSuggestion(query);
            return unresolved
                ? [unresolved, { kind: 'done' }]
                : [{ kind: 'message', label: t('properties.topicNoteNotFound') }];
        }
        return query.type === 'heading'
            ? this.getHeadingSuggestions(query, matches)
            : this.getBlockSuggestions(query, matches);
    }

    async getSuggestions(query: string): Promise<TopicSuggestion[]> {
        const trimmed = query.trim();
        if (!trimmed) return [{ kind: 'done' }];

        const subpathQuery = parseSubpathQuery(trimmed);
        if (subpathQuery) return this.getSubpathSuggestions(subpathQuery);

        const lowered = trimmed.toLowerCase();
        const suggestions: Array<Extract<TopicSuggestion, { kind: 'topic' }>> = [];
        for (const target of this.targets) {
            const labels = [target.targetLabel, ...target.aliases];
            for (const label of labels) {
                if (!label.toLowerCase().includes(lowered)) continue;
                const alias = label === target.targetLabel ? undefined : label;
                suggestions.push({
                    alias,
                    kind: 'topic',
                    label,
                    status: this.getStatus(target, alias),
                    target,
                });
            }
        }

        const matchRank = (label: string): number => {
            const candidate = label.toLowerCase();
            if (candidate === lowered) return 0;
            return candidate.startsWith(lowered) ? 1 : 2;
        };
        suggestions.sort((a, b) => {
            return matchRank(a.label) - matchRank(b.label) || a.label.localeCompare(b.label);
        });

        const hasExactMatch = suggestions.some((suggestion) =>
            suggestion.label.toLowerCase() === lowered,
        );
        const newItem = hasExactMatch ? null : this.getNewSuggestion(trimmed);
        return suggestions.length === 1
            ? [...suggestions, ...(newItem ? [newItem] : []), { kind: 'done' }]
            : [...(newItem ? [newItem] : []), { kind: 'done' }, ...suggestions];
    }

    renderSuggestion(value: TopicSuggestion, el: HTMLElement): void {
        if (value.kind === 'done') {
            el.setText(DONE_LABEL);
            return;
        }
        if (value.kind === 'message') {
            el.setText(value.label);
            return;
        }

        const prefix = value.status === 'remove'
            ? SELECTED_PREFIX
            : value.status === 'update'
                ? UPDATE_PREFIX
                : value.kind === 'new'
                    ? NEW_ITEM_PREFIX
                    : '';
        const suffix = value.kind === 'new' && value.status === 'add' ? NEW_ITEM_SUFFIX : '';
        el.createDiv({ text: `${prefix}${value.label}${suffix}` });
        if (value.detail) el.createDiv({ text: value.detail });
        if (value.label !== value.target.targetLabel) {
            el.createDiv({ text: `→ ${value.target.targetLabel}` });
        }
    }

    onChooseSuggestion(value: TopicSuggestion): void {
        if (value.kind === 'done' || value.kind === 'message') return;
        void this.handleChoice(value);
    }

    private async handleChoice(
        value: Exclude<TopicSuggestion, { kind: 'done' } | { kind: 'message' }>,
    ): Promise<void> {
        const result = await this.updateTopic(value.target, value.alias);
        if (!result) return;

        this.currentTopics = result.topics;
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            this.sources = this.sources.filter((source) => {
                if (source.sourcePath !== activeFile.path) return true;
                return parseTopic(this.app, source.value, source.sourcePath)?.identity !== value.target.identity;
            });
            if (result.storedValue) {
                this.sources.push({
                    includeExcludedTarget: true,
                    kind: 'topic',
                    value: result.storedValue,
                    sourcePath: activeFile.path,
                });
            }
        }
        new TopicInputModal(this.app, this.sources, this.currentTopics).open();
    }

    private createWikiLink(target: ParsedTopic, alias?: string): string | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;
        const linkpath = target.file
            ? this.app.metadataCache.fileToLinktext(target.file, activeFile.path, true)
            : target.linkpath;
        const linktext = `${linkpath}${target.subpath}`;
        return alias ? `[[${linktext}|${alias}]]` : `[[${linktext}]]`;
    }

    private async updateTopic(
        target: ParsedTopic,
        alias?: string,
    ): Promise<{ storedValue?: string; topics: string[] } | null> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;

        const storedValue = this.createWikiLink(target, alias);
        if (!storedValue) return null;
        const result: { action: 'add' | 'remove' | 'update' } = { action: 'add' };
        let updatedTopics: string[] = [];

        await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            const topics = readStringArray(fm.topics);
            const matchingIndexes = topics
                .map((topic, index) => ({ parsed: parseTopic(this.app, topic, activeFile.path), index }))
                .filter(({ parsed }) => parsed?.identity === target.identity)
                .map(({ index }) => index);
            const hasExactAlias = matchingIndexes.some((index) => {
                const topic = topics[index];
                return topic !== undefined &&
                    parseTopic(this.app, topic, activeFile.path)?.alias === alias;
            });

            if (hasExactAlias) {
                result.action = 'remove';
                updatedTopics = topics.filter((_, index) => !matchingIndexes.includes(index));
            } else if (matchingIndexes.length > 0) {
                result.action = 'update';
                updatedTopics = topics.filter((_, index) => !matchingIndexes.includes(index));
                updatedTopics.push(storedValue);
            } else {
                updatedTopics = [...topics, storedValue];
            }

            sortTopics(updatedTopics);
            fm.topics = updatedTopics;
        });

        const label = alias ?? target.targetLabel;
        if (result.action === 'remove') {
            new Notice(t('properties.topicRemoved', { topic: label }));
            return { topics: updatedTopics };
        }
        if (result.action === 'update') {
            new Notice(t('properties.topicUpdated', { topic: label }));
        } else {
            new Notice(t('properties.topicAdded', { topic: label }));
        }
        return { storedValue, topics: updatedTopics };
    }
}
