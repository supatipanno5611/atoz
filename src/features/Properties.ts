import { App, Modal, SuggestModal, Notice, moment, Setting } from 'obsidian';
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
	private tempData = new Map<string, { title: string; desc: string }>();
	
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
            
        const currentTitle = typeof fm.title === 'string' ? fm.title : activeFile.basename;
        const currentDesc = typeof fm.description === 'string' ? fm.description : '';
    
        // 2. 모달 띄우기
        new PropertyInputModal(
            this.plugin.app,
            activeFile.path,
            currentTitle,
            currentDesc,
            this.tempData,
            async (finalTitle, finalDesc) => {
                // 저장 버튼 클릭 시 처리 로직
                await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
                    const targetFm = frontmatter as FrontmatterRecord;
                    targetFm.title = finalTitle;
                    targetFm.description = finalDesc;
                });
                this.tempData.delete(activeFile.path); // 저장 완료 후 임시 메모리 비우기
                new Notice('Title과 Description 속성을 저장했습니다.');
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
        private tempData: Map<string, { title: string; desc: string }>,
        private onSubmit: (title: string, desc: string) => Promise<void>
    ) {
        super(app);
    }

    onOpen() {
        let titleResult = this.defaultTitle;
        let descResult = this.defaultDesc;

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
                        
                        // UI 컴포넌트 강제 업데이트
                        titleInput.setValue(saved.title);
                        descTextArea.setValue(saved.desc);
                        
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
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult });
                });
            });

        // 3. Description 입력 컴포넌트 (여러 줄, 넉넉한 공간)
        let descTextArea: any;
        new Setting(this.contentEl)
            .setName('Description')
            .setDesc('노트의 상세 설명을 넉넉하게 적어주세요.')
            .addTextArea(text => {
                descTextArea = text;
                text.setValue(descResult);
                text.inputEl.style.width = '100%';
                text.inputEl.style.height = '120px'; // 넉넉한 세로 높이 보장
                text.onChange(v => {
                    descResult = v;
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult });
                });
            });

        // 4. 하단 제어 버튼 (저장 및 제출)
        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('저장하기')
                .setCta()
                .onClick(async () => {
                    await this.onSubmit(titleResult, descResult);
                    this.close();
                })
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}
