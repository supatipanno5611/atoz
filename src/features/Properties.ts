import { App, Modal, SuggestModal, Notice, moment, Setting, TFile } from 'obsidian';
import type ATOZPlugin from '../main';

type FrontmatterRecord = Record<string, unknown>;

const ALLOWED_PROPERTIES = new Set([
    'date',
    'topics',
    'title',
    'description',
    'cssclasses',
    'aliases',
    'tags',
]);

// 토픽 관리를 위한 마커 상수들
const NEW_ITEM_PREFIX = "+ '";
const NEW_ITEM_SUFFIX = "' 추가";
const DONE_LABEL = '완료';
const SELECTED_PREFIX = '[선택됨] ';

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
            this.plugin.settings.laterFilePath,
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
            new Notice('정리할 속성이 없습니다.');
            return;
        }

        new Notice(`속성 ${cleanedCount}개를 정리했고, 파일 ${reviewCount}개는 검토가 필요합니다.`);
    }

    async openTitleDescModal(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
         if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
         }
    
        // 1. 현재 파일의 실제 Frontmatter 데이터 가져오기
        const cache = this.plugin.app.metadataCache.getFileCache(activeFile);
        const fm = (cache?.frontmatter as FrontmatterRecord | undefined) ?? {};
            
        const { unique } = splitFilename(activeFile.basename);
        const currentTitle = typeof fm.title === 'string' ? fm.title : unique;
        const currentDesc = typeof fm.description === 'string' ? fm.description : '';
        const existingAliases = readStringArray(fm.aliases);
        const currentAliases = existingAliases.length > 0 ? existingAliases.join(', ') : unique;
    
        // 2. 모달 띄우기
        new PropertyInputModal(
            this.plugin.app,
            activeFile.path,
            currentTitle,
            currentDesc,
            currentAliases,
            this.tempData,
            async (finalTitle, finalDesc, finalAliases) => {
                // 저장 버튼 클릭 시 처리 로직
                await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
                    const targetFm = frontmatter as FrontmatterRecord;
                    targetFm.title = finalTitle;
                    targetFm.description = finalDesc;
                    targetFm.aliases = finalAliases;
                });
                this.tempData.delete(activeFile.path); // 저장 완료 후 임시 메모리 비우기
                new Notice('속성을 저장했습니다.');
            }
        ).open();
    }

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

    private openTopicEditor(): void {
    	this.plugin.topicCandidates = this.plugin.collectTopicCandidates();
    	new TopicInputModal(this.plugin.app, this.plugin.topicCandidates).open();
    }

    async insertTodayDate(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
        }

        let alreadyExists = false;
        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            if (fm.date !== undefined) {
                alreadyExists = true;
                return;
            }
            fm.date = moment().format('YYYY-MM-DD');
        });

        if (alreadyExists) {
            new Notice('이미 date 속성이 있습니다.');
            return;
        }
        new Notice('오늘 날짜 속성을 삽입했습니다.');
    }

    async updateTodayDate(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.date = moment().format('YYYY-MM-DD');
        });
        new Notice('date 속성을 오늘 날짜로 갱신했습니다.');
    }

    async renameFile(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
    
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
        }
    
        new RenameFileModal(this.plugin, activeFile).open();
    }
}


class TopicInputModal extends SuggestModal<string> {
    private currentTopics: string[];

    constructor(app: App, private candidates: string[], initialTopics?: string[]) {
        super(app);
        this.currentTopics = initialTopics ?? this.fetchInitialTopics();
        this.setPlaceholder('주제어 추가 또는 삭제 (검색 가능)');
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

class PropertyInputModal extends Modal {
    constructor(
        app: App,
        private filePath: string,
        private defaultTitle: string,
        private defaultDesc: string,
        private defaultAliases: string,
        private tempData: Map<string, { title: string; desc: string; aliases: string }>,
        private onSubmit: (title: string, desc: string, aliases: string[]) => Promise<void>
    ) {
        super(app);
    }

    onOpen() {
        let titleResult = this.defaultTitle;
        let descResult = this.defaultDesc;
        let aliasesResult = this.defaultAliases;

        this.titleEl.setText('문서 속성 설정 (Title / Description)');

        // 1. 유실 방지: 임시 저장된 데이터가 있을 경우 이어쓰기 유도 버튼 생성
        if (this.tempData.has(this.filePath)) {
            const saved = this.tempData.get(this.filePath)!;
            new Setting(this.contentEl)
                .setName('작성 중이던 데이터가 있습니다.')
                .setDesc('임시 보관된 내용으로 덮어씌우시겠습니까?')
                .addButton(btn => btn
                    .setButtonText('이어서 쓰기')
                    .setClass('mod-warning')
                    .onClick(() => {
                        titleResult = saved.title;
                        descResult = saved.desc;
                        aliasesResult = saved.aliases;
                        
                        // UI 컴포넌트 강제 업데이트
                        titleInput.setValue(saved.title);
                        descTextArea.setValue(saved.desc);
                        aliasesInput.setValue(saved.aliases);
                        
                        new Notice('작성 중이던 내용을 불러왔습니다.');
                    })
                );
        }

        // 2. Title 입력 컴포넌트 (한 줄)
        let titleInput: any;
        new Setting(this.contentEl)
            .setName('Title')
            .setDesc('노트의 메타데이터 제목을 지정합니다.')
            .addText(text => {
                titleInput = text;
                text.setValue(titleResult);
                text.onChange(v => {
                    titleResult = v;
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult, aliases: aliasesResult });
                });
            });

        // 3. Description 입력 컴포넌트 (여러 줄, 넉넉한 공간)
        let descTextArea: any;
        new Setting(this.contentEl)
            .setName('Description')
            .setDesc('노트의 상세 설명을 적어주세요.')
            .addTextArea(text => {
                descTextArea = text;
                text.setValue(descResult);
                text.inputEl.style.width = '100%';
                text.inputEl.style.height = '120px'; // 넉넉한 세로 높이 보장
                text.onChange(v => {
                    descResult = v;
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult, aliases: aliasesResult });
                });
            });

        // 3-1. Aliases 입력 컴포넌트 (한 줄, 콤마 구분)
        let aliasesInput: any;
        new Setting(this.contentEl)
            .setName('Aliases')
            .setDesc('콤마(,)로 구분하여 입력합니다.')
            .addText(text => {
                aliasesInput = text;
                text.setValue(aliasesResult);
                text.onChange(v => {
                    aliasesResult = v;
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult, aliases: aliasesResult });
                });
            });

        // 4. 하단 제어 버튼 (저장 및 제출)
        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('저장하기')
                .setCta()
                .onClick(async () => {
                    const aliasesArray = aliasesResult
                        .split(',')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);
                    await this.onSubmit(titleResult, descResult, aliasesArray);
                    this.close();
                })
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}
function splitFilename(name: string): { category: string; order: string; unique: string } {
    const firstDash = name.indexOf('-');
    if (firstDash === -1) {
        return { category: '', order: '', unique: name };
    }

    const category = name.substring(0, firstDash);
    const rest = name.substring(firstDash + 1);
    const orderMatch = rest.match(/^(\d+)-(.+)$/);

    if (orderMatch) {
        return { category, order: orderMatch[1]!, unique: orderMatch[2]! };
    }

    return { category, order: '', unique: rest };
}

interface BlogEntry {
    file: TFile;
    order: number;
    unique: string;
}

function scanBlogEntries(app: App, blogFolder: string, category: string, excludeFile: TFile): BlogEntry[] {
    const entries: BlogEntry[] = [];
    const pattern = new RegExp(`^${category}-(\\d+)-(.+)$`);

    for (const file of app.vault.getMarkdownFiles()) {
        if (file.path === excludeFile.path) continue;
        if (file.parent?.path !== blogFolder) continue;

        const match = file.basename.match(pattern);
        if (!match) continue;

        entries.push({ file, order: parseInt(match[1]!, 10), unique: match[2]! });
    }

    return entries;
}

class RenameFileModal extends Modal {
    constructor(
        private plugin: ATOZPlugin,
        private file: TFile,
    ) {
        super(plugin.app);
    }

    onOpen() {
        const parsed = splitFilename(this.file.basename);

        let category = parsed.category;
        let order = parsed.order;
        let unique = parsed.unique;
        
        if (!order && category && this.plugin.settings.blogFolder) {
            order = String(this.nextOrderFor(category));
        }

        this.titleEl.setText('파일 이름 변경');

        const blogFolder = this.plugin.settings.blogFolder;

        if (!blogFolder) {
            new Setting(this.contentEl)
                .setDesc('블로그 폴더가 설정되지 않았습니다. 설정 탭에서 "블로그 파일 순서 > 대상 폴더"를 먼저 지정하세요.')
                .settingEl.style.color = 'var(--text-error)';
        }

        const previewListEl = document.createElement('div');
        previewListEl.style.marginTop = '8px';
        previewListEl.style.fontSize = '0.85em';
        previewListEl.style.color = 'var(--text-muted)';
        previewListEl.style.whiteSpace = 'pre-line';

        const preview = document.createElement('div');
        preview.style.marginTop = '8px';
        preview.style.fontWeight = 'bold';

        const refreshPreview = () => {
            preview.setText(
                category.trim()
                    ? order.trim()
                        ? `${category.trim()}-${order.trim()}-${unique.trim()}`
                        : `${category.trim()}-${unique.trim()}`
                    : unique.trim()
            );
            this.refreshOrderPreview(previewListEl, category.trim(), order.trim());
        };

        new Setting(this.contentEl)
            .setName('Category')
            .setDesc('파일명 앞부분')

            .addDropdown(drop => {
                for (const item of this.plugin.settings.filenameCategories) {
                    drop.addOption(item, item);
                }
            
                if (category && !this.plugin.settings.filenameCategories.includes(category)) {
                    drop.addOption(category, category);
                }
            
                if (category) {
                    drop.setValue(category);
                } else if (this.plugin.settings.filenameCategories.length > 0) {
                    category = this.plugin.settings.filenameCategories[0]!;
                    drop.setValue(category);
                }
            
                drop.onChange(v => {
                    category = v;
                    if (!order) {
                        order = String(this.nextOrderFor(category));
                    }
                    refreshPreview();
                });
            });

        new Setting(this.contentEl)
            .setName('Order')
            .setDesc('같은 카테고리 내 순서 (숫자, 필수)')
            .addText(text => {
                text.setValue(order);
                text.onChange(v => {
                    order = v.trim();
                    refreshPreview();
                });
            });

        new Setting(this.contentEl)
            .setName('Unique name')
            .setDesc('파일명 뒷부분')

            .addText(text => {
                text.setValue(unique);

                text.onChange(v => {
                    unique = v.trim();
                    refreshPreview();
                });
            });

        this.contentEl.appendChild(preview);
        this.contentEl.appendChild(previewListEl);

        refreshPreview();

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('Rename')
                .setCta()

                .onClick(async () => {
                    const trimmedCategory = category.trim();
                    const trimmedOrder = order.trim();
                    const trimmedUnique = unique.trim();

                    if (trimmedCategory) {
                        if (!blogFolder) {
                            new Notice('블로그 폴더를 먼저 설정하세요.');
                            return;
                        }

                        if (!trimmedOrder) {
                            new Notice('순서를 입력하세요.');
                            return;
                        }

                        const orderNum = parseInt(trimmedOrder, 10);
                        if (isNaN(orderNum) || orderNum < 1) {
                            new Notice('순서는 1 이상의 숫자여야 합니다.');
                            return;
                        }

                        const ok = await this.applyOrderedRename(blogFolder, trimmedCategory, orderNum, trimmedUnique);
                        if (!ok) return;

                        new Notice('파일 이름을 변경했습니다.');
                        this.close();
                        return;
                    }

                    const finalName = trimmedUnique;

                    if (!finalName) {
                        new Notice('파일 이름을 입력하세요.');
                        return;
                    }

                    if (finalName === this.file.basename) {
                        this.close();
                        return;
                    }

                    const parent = this.file.parent?.path;

                    const newPath =
                        parent
                            ? `${parent}/${finalName}.md`
                            : `${finalName}.md`;

                    if (this.app.vault.getAbstractFileByPath(newPath)) {
                        new Notice('같은 이름의 파일이 이미 존재합니다.');
                        return;
                    }

                    await this.app.fileManager.renameFile(
                        this.file,
                        newPath,
                    );

                    new Notice('파일 이름을 변경했습니다.');

                    this.close();
                }));
    }

    private refreshOrderPreview(el: HTMLElement, category: string, orderStr: string): void {
        const blogFolder = this.plugin.settings.blogFolder;

        if (!category || !blogFolder) {
            el.setText('');
            return;
        }

        const entries = scanBlogEntries(this.app, blogFolder, category, this.file)
            .sort((a, b) => a.order - b.order);

        if (entries.length === 0) {
            el.setText('(같은 카테고리의 순서 항목 없음)');
            return;
        }

        const orderNum = orderStr ? parseInt(orderStr, 10) : NaN;
        let windowEntries: BlogEntry[];

        if (!isNaN(orderNum)) {
            windowEntries = entries.filter(e => Math.abs(e.order - orderNum) <= 1).slice(0, 3);
            if (windowEntries.length === 0) {
                windowEntries = entries.slice(-3);
            }
        } else {
            windowEntries = entries.slice(-3);
        }

        el.setText(windowEntries.map(e => `${e.order}. ${e.unique}`).join('\n'));
    }

    private nextOrderFor(category: string): number {
        const blogFolder = this.plugin.settings.blogFolder;
        if (!blogFolder || !category) return 1;
    
        const entries = scanBlogEntries(this.app, blogFolder, category, this.file);
        if (entries.length === 0) return 1;
    
        return Math.max(...entries.map(e => e.order)) + 1;
    }

    private async applyOrderedRename(blogFolder: string, category: string, newOrder: number, unique: string): Promise<boolean> {
        const entries = scanBlogEntries(this.app, blogFolder, category, this.file);

        const parsed = splitFilename(this.file.basename);
        const oldOrder = parsed.category === category && parsed.order ? parseInt(parsed.order, 10) : null;

        const maxAllowed = entries.length + 1;
        if (newOrder > maxAllowed) {
            new Notice(`순서는 1 ~ ${maxAllowed} 사이여야 합니다.`);
            return false;
        }

        if (oldOrder === newOrder) {
            const finalPath = this.buildPath(blogFolder, category, newOrder, unique);
            if (finalPath !== this.file.path && this.app.vault.getAbstractFileByPath(finalPath)) {
                new Notice('같은 이름의 파일이 이미 존재합니다.');
                return false;
            }
            if (finalPath !== this.file.path) {
                await this.app.fileManager.renameFile(this.file, finalPath);
            }
            return true;
        }

        let shifted: { file: TFile; from: number; to: number; unique: string }[] = [];

        if (oldOrder === null) {
            shifted = entries
                .filter(e => e.order >= newOrder)
                .map(e => ({ file: e.file, from: e.order, to: e.order + 1, unique: e.unique }));
        } else if (newOrder < oldOrder) {
            shifted = entries
                .filter(e => e.order >= newOrder && e.order < oldOrder)
                .map(e => ({ file: e.file, from: e.order, to: e.order + 1, unique: e.unique }));
        } else {
            shifted = entries
                .filter(e => e.order > oldOrder && e.order <= newOrder)
                .map(e => ({ file: e.file, from: e.order, to: e.order - 1, unique: e.unique }));
        }

        const isPushingUp = shifted.length > 0 && shifted[0]!.to > shifted[0]!.from;
        shifted.sort((a, b) => isPushingUp ? b.from - a.from : a.from - b.from);

        for (const s of shifted) {
            const newPath = this.buildPath(blogFolder, category, s.to, s.unique);
            await this.app.fileManager.renameFile(s.file, newPath);
        }

        const finalPath = this.buildPath(blogFolder, category, newOrder, unique);
        await this.app.fileManager.renameFile(this.file, finalPath);
        return true;
    }

    private buildPath(blogFolder: string, category: string, order: number, unique: string): string {
        const filename = `${category}-${order}-${unique}.md`;
        return `${blogFolder}/${filename}`;
    }

    onClose() {
        this.contentEl.empty();
    }
}
