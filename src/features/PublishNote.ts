import { App, Modal, Notice, Setting, SuggestModal, TFile, TFolder, moment } from 'obsidian';
import type ATOZPlugin from '../main';

type FrontmatterRecord = Record<string, unknown>;
type PublishType = '일반 게시글' | '일상 게시글' | '목차 문서' | '시리즈 게시글';
type PublishResetChoice = '초기화' | '취소';

const PUBLISH_TYPES: PublishType[] = ['일반 게시글', '일상 게시글', '목차 문서', '시리즈 게시글'];
const PUBLISH_RESET_CHOICES: PublishResetChoice[] = ['초기화', '취소'];
const NEW_ITEM_PREFIX = "+ '";
const NEW_ITEM_SUFFIX = "' 추가";
const DONE_LABEL = '완료';
const SELECTED_PREFIX = '[선택됨] ';

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sortTopics(topics: string[]): void {
    topics.sort((a, b) => a.localeCompare(b));
}

function normalizeParentRef(value: unknown, projectPath: string): string | null {
    if (typeof value !== 'string') return null;

    let parent = value.trim().replace(/\\/g, '/');
    const wikiLink = parent.match(/^\[\[([^\]|#^\n]+)\]\]$/);
    if (parent.startsWith('[[')) {
        const linkTarget = wikiLink?.[1];
        if (!linkTarget) return null;
        parent = linkTarget.trim();
    }

    if (parent.toLowerCase().endsWith('.md')) parent = parent.slice(0, -'.md'.length);
    if (parent === projectPath) return '';
    if (parent.startsWith(`${projectPath}/`)) parent = parent.slice(projectPath.length + 1);
    return parent;
}

function parentLinkForFile(file: TFile): string {
    return `[[${file.path.slice(0, -'.md'.length)}]]`;
}

export class PublishNoteFeature {
    constructor(private plugin: ATOZPlugin) {}

    async editTopics(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            if (fm.topics === undefined) fm.topics = [];
        });
        this.openTopicEditor();
    }

    async configurePublishNote(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        const projectPath = this.plugin.settings.projectPath;
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
        }
        if (!projectPath || !activeFile.path.startsWith(`${projectPath}/`)) {
            new Notice('프로젝트 폴더 안의 노트에서만 설정할 수 있습니다.');
            return;
        }
        if (
            activeFile.path.startsWith(`${projectPath}/ordinary/`) &&
            !this.isDirectOrdinaryFile(activeFile, projectPath)
        ) {
            new Notice('일상 게시글은 일상 게시글 폴더 바로 아래에 두어야 합니다.');
            return;
        }

        if (this.hasPublishProperties(activeFile)) {
            new PublishResetModal(this.plugin.app, (choice) => {
                if (choice === '취소') {
                    new Notice('게시 노트 설정을 취소했습니다.');
                    return;
                }
                void this.resetPublishNote(activeFile, projectPath);
            }).open();
            return;
        }

        this.continueConfigurePublishNote(activeFile, projectPath);
    }

    private continueConfigurePublishNote(activeFile: TFile, projectPath: string): void {
        if (this.isDirectOrdinaryFile(activeFile, projectPath)) {
            void this.configurePost(activeFile, '일상 게시글 속성을 설정했습니다.');
            return;
        }

        new PublishTypeModal(this.plugin.app, (type) => {
            void this.applyPublishType(activeFile, projectPath, type);
        }).open();
    }

    private hasPublishProperties(file: TFile): boolean {
        const frontmatter = this.getFrontmatter(file);
        return frontmatter.date !== undefined ||
            frontmatter.topics !== undefined ||
            frontmatter.type !== undefined ||
            frontmatter.parent !== undefined ||
            frontmatter.order !== undefined;
    }

    private getFrontmatter(file: TFile): FrontmatterRecord {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        return (cache?.frontmatter as FrontmatterRecord | undefined) ?? {};
    }

    private isDirectOrdinaryFile(file: TFile, projectPath: string): boolean {
        return file.parent?.path === `${projectPath}/ordinary`;
    }

    private async resetPublishNote(file: TFile, projectPath: string): Promise<void> {
        const targetPath = `${projectPath}/${file.name}`;
        if (targetPath !== file.path && this.plugin.app.vault.getAbstractFileByPath(targetPath) !== null) {
            new Notice('프로젝트 폴더에 같은 이름의 노트가 이미 있습니다.');
            return;
        }

        if (targetPath !== file.path) {
            await this.plugin.app.fileManager.renameFile(file, targetPath);
        }
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            delete fm.date;
            delete fm.topics;
            delete fm.type;
            delete fm.parent;
            delete fm.order;
        });
        new Notice('게시 속성을 초기화했습니다.');
    }

    private async applyPublishType(file: TFile, projectPath: string, type: PublishType): Promise<void> {
        if (type === '일반 게시글') {
            await this.configurePost(file, '일반 게시글 속성을 설정했습니다.');
            return;
        }
        if (type === '일상 게시글') {
            const movedFile = await this.moveToOrdinary(file, projectPath);
            if (movedFile) await this.configurePost(movedFile, '일상 게시글 속성을 설정했습니다.');
            return;
        }
        if (type === '목차 문서') {
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                const fm = frontmatter as FrontmatterRecord;
                fm.type = 'index';
                delete fm.date;
                delete fm.topics;
                delete fm.parent;
                delete fm.order;
            });
            new Notice('목차 문서로 설정했습니다.');
            return;
        }

        this.selectSeriesParent(file, projectPath);
    }

    private async configurePost(file: TFile, notice: string): Promise<void> {
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.date = moment().format('YYYY-MM-DD');
            if (fm.topics === undefined) fm.topics = [];
            delete fm.type;
            delete fm.parent;
            delete fm.order;
        });
        new Notice(notice);
    }

    private async moveToOrdinary(file: TFile, projectPath: string): Promise<TFile | null> {
        const ordinaryPath = `${projectPath}/ordinary`;
        const ordinary = this.plugin.app.vault.getAbstractFileByPath(ordinaryPath);
        if (ordinary !== null && !(ordinary instanceof TFolder)) {
            new Notice('일상 게시글 경로가 폴더가 아닙니다.');
            return null;
        }
        if (ordinary === null) {
            await this.plugin.app.vault.createFolder(ordinaryPath);
        }

        const targetPath = `${ordinaryPath}/${file.name}`;
        if (targetPath !== file.path && this.plugin.app.vault.getAbstractFileByPath(targetPath) !== null) {
            new Notice('일상 게시글 폴더에 같은 이름의 노트가 이미 있습니다.');
            return null;
        }
        if (targetPath !== file.path) {
            await this.plugin.app.fileManager.renameFile(file, targetPath);
        }
        return file;
    }

    private selectSeriesParent(file: TFile, projectPath: string): void {
        const parents = this.plugin.app.vault.getMarkdownFiles().filter((candidate) => {
            if (candidate.path === file.path) return false;
            if (!candidate.path.startsWith(`${projectPath}/`)) return false;
            if (candidate.path.startsWith(`${projectPath}/ordinary/`)) return false;
            return this.getFrontmatter(candidate).type === 'index';
        });

        if (parents.length === 0) {
            new Notice('선택할 목차 문서가 없습니다.');
            return;
        }

        new ParentSelectModal(this.plugin.app, parents, (parent) => {
            const parentValue = parentLinkForFile(parent);
            const parentRef = normalizeParentRef(parentValue, projectPath);
            if (parentRef === null) {
                new Notice('목차 문서 링크를 해석할 수 없습니다.');
                return;
            }
            const nextOrder = this.getNextOrder(parentRef, projectPath);
            new OrderInputModal(this.plugin.app, nextOrder, (order) => {
                void this.saveSeriesPost(file, parentValue, parentRef, order, projectPath);
            }).open();
        }).open();
    }

    private getNextOrder(parentRef: string, projectPath: string): number {
        let maxOrder = 0;
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            if (!file.path.startsWith(`${projectPath}/`)) continue;
            const fm = this.getFrontmatter(file);
            if (
                normalizeParentRef(fm.parent, projectPath) === parentRef &&
                typeof fm.order === 'number' &&
                Number.isInteger(fm.order)
            ) {
                maxOrder = Math.max(maxOrder, fm.order);
            }
        }
        return maxOrder + 1;
    }

    private async saveSeriesPost(
        file: TFile,
        parent: string,
        parentRef: string,
        order: number,
        projectPath: string,
    ): Promise<void> {
        const hasDuplicate = this.plugin.app.vault.getMarkdownFiles().some((candidate) => {
            if (candidate.path === file.path || !candidate.path.startsWith(`${projectPath}/`)) return false;
            const fm = this.getFrontmatter(candidate);
            return normalizeParentRef(fm.parent, projectPath) === parentRef && fm.order === order;
        });
        if (hasDuplicate) {
            new Notice('같은 목차에 이미 사용 중인 순번입니다.');
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.date = moment().format('YYYY-MM-DD');
            if (fm.topics === undefined) fm.topics = [];
            fm.parent = parent;
            fm.order = order;
            delete fm.type;
        });
        new Notice('시리즈 게시글 속성을 설정했습니다.');
    }

    private openTopicEditor(): void {
        this.plugin.topicCandidates = this.plugin.collectTopicCandidates();
        new TopicInputModal(this.plugin.app, this.plugin.topicCandidates).open();
    }
}

class PublishTypeModal extends SuggestModal<PublishType> {
    constructor(app: App, private onSelect: (type: PublishType) => void) {
        super(app);
        this.setPlaceholder('게시 노트 형식 선택');
    }

    getSuggestions(query: string): PublishType[] {
        const normalized = query.trim().toLowerCase();
        return PUBLISH_TYPES.filter((type) => type.toLowerCase().includes(normalized));
    }

    renderSuggestion(value: PublishType, el: HTMLElement): void {
        el.setText(value);
    }

    onChooseSuggestion(value: PublishType): void {
        this.onSelect(value);
    }
}

class PublishResetModal extends SuggestModal<PublishResetChoice> {
    constructor(app: App, private onSelect: (choice: PublishResetChoice) => void) {
        super(app);
        this.setPlaceholder('기존 게시 속성을 초기화할까요?');
    }

    getSuggestions(query: string): PublishResetChoice[] {
        const normalized = query.trim().toLowerCase();
        return PUBLISH_RESET_CHOICES.filter((choice) => choice.toLowerCase().includes(normalized));
    }

    renderSuggestion(value: PublishResetChoice, el: HTMLElement): void {
        el.setText(value);
    }

    onChooseSuggestion(value: PublishResetChoice): void {
        this.onSelect(value);
    }
}

class ParentSelectModal extends SuggestModal<TFile> {
    constructor(app: App, private parents: TFile[], private onSelect: (file: TFile) => void) {
        super(app);
        this.setPlaceholder('목차 문서 선택');
    }

    getSuggestions(query: string): TFile[] {
        const normalized = query.trim().toLowerCase();
        return this.parents.filter((file) => file.path.toLowerCase().includes(normalized));
    }

    renderSuggestion(value: TFile, el: HTMLElement): void {
        el.setText(value.path);
    }

    onChooseSuggestion(value: TFile): void {
        this.onSelect(value);
    }
}

class OrderInputModal extends Modal {
    private inputEl!: HTMLInputElement;

    constructor(app: App, private defaultOrder: number, private onSubmit: (order: number) => void) {
        super(app);
        this.modalEl.addClass('prompt');
    }

    onOpen(): void {
        this.titleEl.setText('시리즈 순번 입력');
        new Setting(this.contentEl).addText((text) => {
            this.inputEl = text.inputEl;
            this.inputEl.type = 'number';
            text.setValue(String(this.defaultOrder));
            window.setTimeout(() => text.inputEl.focus(), 0);
        });
        this.scope.register([], 'Enter', () => {
            const order = Number(this.inputEl.value);
            if (!Number.isInteger(order) || order < 1) {
                new Notice('순번은 1 이상의 정수여야 합니다.');
                return false;
            }
            this.close();
            this.onSubmit(order);
            return false;
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

class TopicInputModal extends SuggestModal<string> {
    private currentTopics: string[];

    constructor(app: App, private candidates: string[], initialTopics?: string[]) {
        super(app);
        this.currentTopics = initialTopics ?? this.fetchInitialTopics();
        this.setPlaceholder('주제어 추가');
    }

    private fetchInitialTopics(): string[] {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return [];
        const cache = this.app.metadataCache.getFileCache(activeFile);
        const frontmatter = cache?.frontmatter as FrontmatterRecord | undefined;
        return readStringArray(frontmatter?.topics);
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
            new Notice(`이미 주제어에 있습니다: ${item}`);
            return;
        }
        if (!this.candidates.includes(item)) this.candidates.push(item);
        new Notice(`주제어에 추가했습니다: ${item}`);
    }

    private async removeTopic(item: string): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.topics = readStringArray(fm.topics).filter((topic) => topic !== item);
        });
        new Notice(`주제어에서 제거했습니다: ${item}`);
    }
}
