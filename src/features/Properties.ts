import { App, SuggestModal, Notice } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { isRecord } from '../utils';

type FrontmatterRecord = Record<string, unknown>;

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

// 토픽 관련 유틸리티 함수
function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sortTopics(topics: string[]): void {
    topics.sort((a, b) => a.localeCompare(b));
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
    	this.plugin.topicCandidates = this.plugin.collectTopicCandidates();
    	new TopicInputModal(this.plugin.app, this.plugin.topicCandidates).open();
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


class TopicInputModal extends SuggestModal<string> {
    private currentTopics: string[];

    constructor(app: App, private candidates: string[], initialTopics?: string[]) {
        super(app);
        this.currentTopics = initialTopics ?? this.fetchInitialTopics();
        this.setPlaceholder(t('properties.topicPlaceholder'));
    }

    private fetchInitialTopics(): string[] {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return [];
        const cache = this.app.metadataCache.getFileCache(activeFile);
        const frontmatter: unknown = cache?.frontmatter;
        return readStringArray(isRecord(frontmatter) ? frontmatter.topics : undefined);
    }

    getSuggestions(query: string): string[] {
        const trimmed = query.trim();
        if (!trimmed) return [DONE_LABEL];
        const filtered = this.candidates.filter((candidate) =>
            candidate.toLowerCase().includes(trimmed.toLowerCase()),
        );
        const newItem = this.candidates.includes(trimmed) ? null : `${NEW_ITEM_PREFIX}${trimmed}${NEW_ITEM_SUFFIX}`;
        const mappedFiltered = filtered.map((candidate) =>
            this.currentTopics.includes(candidate) ? `${SELECTED_PREFIX}${candidate}` : candidate,
        );
        return filtered.length === 1
            ? [...mappedFiltered, ...(newItem ? [newItem] : []), DONE_LABEL]
            : [...(newItem ? [newItem] : []), DONE_LABEL, ...mappedFiltered];
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    onChooseSuggestion(value: string): void {
        if (value === DONE_LABEL) return;
        void this.handleChoice(value);
    }

    private async handleChoice(value: string): Promise<void> {
        const isSelected = value.startsWith(SELECTED_PREFIX);
        const isNew = value.startsWith(NEW_ITEM_PREFIX);
        const cleaned = isSelected ? value.slice(SELECTED_PREFIX.length) : value;
        const item = isNew ? cleaned.slice(NEW_ITEM_PREFIX.length, -NEW_ITEM_SUFFIX.length) : cleaned;
        if (isSelected) {
            await this.removeTopic(item);
            this.currentTopics = this.currentTopics.filter((topic) => topic !== item);
        } else {
            await this.addTopic(item);
            if (!this.currentTopics.includes(item)) {
                this.currentTopics.push(item);
                sortTopics(this.currentTopics);
            }
        }
        // 연속 입력을 위해 모달을 새로 오픈
        new TopicInputModal(this.app, this.candidates, this.currentTopics).open();
    }

    private async addTopic(item: string): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        let alreadyExists = false;
        await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            const topics = readStringArray(fm.topics);
            if (topics.includes(item)) {
                alreadyExists = true;
                return;
            }
            topics.push(item);
            sortTopics(topics);
            fm.topics = topics;
        });
        if (alreadyExists) {
            new Notice(t('properties.topicExists', { topic: item }));
            return;
        }
        if (!this.candidates.includes(item)) this.candidates.push(item);
        new Notice(t('properties.topicAdded', { topic: item }));
    }

    private async removeTopic(item: string): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.topics = readStringArray(fm.topics).filter((topic) => topic !== item);
        });
        new Notice(t('properties.topicRemoved', { topic: item }));
    }
}
