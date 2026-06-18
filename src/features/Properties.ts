import { Notice, moment } from 'obsidian';
import type ATOZPlugin from '../main';
import { AudioFeature } from './Audio';
import { PublishNoteFeature } from './PublishNote';
import { YoutubeFeature } from './Youtube';

type FrontmatterRecord = Record<string, unknown>;

const ALLOWED_PROPERTIES = new Set([
    'date',
    'topics',
    'type',
    'parent',
    'order',
    'youtubeId',
    'audioSrc',
    'audioTitle',
]);

function isEmptyProperty(value: unknown): boolean {
    return value === null || value === undefined || value === '' ||
        (Array.isArray(value) && value.length === 0);
}

export class PropertiesFeature {
    private publishNote: PublishNoteFeature;
    private youtube: YoutubeFeature;
    private audio: AudioFeature;

    constructor(private plugin: ATOZPlugin) {
        this.publishNote = new PublishNoteFeature(plugin);
        this.youtube = new YoutubeFeature(plugin);
        this.audio = new AudioFeature(plugin);
    }

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

                if (fm.audioSrc !== undefined && fm.audioTitle === undefined) {
                    toReview.add('audioTitle');
                }
                if (fm.audioSrc === undefined && fm.audioTitle !== undefined) {
                    toReview.add('audioSrc');
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

    async configurePublishNote(): Promise<void> {
        await this.publishNote.configurePublishNote();
    }

    async editTopics(): Promise<void> {
        await this.publishNote.editTopics();
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

    insertYoutubeProperties(): void {
        this.youtube.insertYoutubeProperties();
    }

    insertAudioProperties(): void {
        this.audio.insertAudioProperties();
    }
}
