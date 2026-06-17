import { App, Modal, Notice, Setting } from 'obsidian';
import type ATOZPlugin from '../main';

type FrontmatterRecord = Record<string, unknown>;

function extractYoutubeId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);
        const host = url.hostname.replace(/^www\./, '');
        if (host === 'youtube.com' || host === 'm.youtube.com') {
            const watchId = url.searchParams.get('v');
            if (watchId) return watchId;

            const parts = url.pathname.split('/').filter((part) => part.length > 0);
            if ((parts[0] === 'embed' || parts[0] === 'shorts') && parts[1]) {
                return parts[1];
            }
        }

        if (host === 'youtu.be') {
            const id = url.pathname.split('/').filter((part) => part.length > 0)[0];
            return id ?? null;
        }
    } catch {
        return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
    }

    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

export class YoutubeFeature {
    constructor(private plugin: ATOZPlugin) {}

    insertYoutubeProperties(): void {
        new YoutubeInputModal(this.plugin.app, (input) => {
            void this.saveYoutubeId(input);
        }).open();
    }

    private async saveYoutubeId(input: string): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성 파일이 없습니다.');
            return;
        }

        const youtubeId = extractYoutubeId(input);
        if (!youtubeId) {
            new Notice('올바른 YouTube 링크나 ID를 입력하세요.');
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.youtubeId = youtubeId;
        });

        new Notice(`YouTube ID를 저장했습니다: ${youtubeId}`);
    }
}

class YoutubeInputModal extends Modal {
    private inputEl!: HTMLInputElement;

    constructor(
        app: App,
        private onSubmit: (input: string) => void,
    ) {
        super(app);
        this.modalEl.addClass('prompt');
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText('YouTube 속성 삽입');

        new Setting(contentEl).addText((text) => {
            this.inputEl = text.inputEl;
            text.setPlaceholder('YouTube 링크 또는 ID');
            window.setTimeout(() => text.inputEl.focus(), 0);
        });

        this.scope.register([], 'Enter', () => {
            this.handleSubmit();
            return false;
        });
    }

    private handleSubmit(): void {
        const input = this.inputEl.value.trim();
        this.close();
        this.onSubmit(input);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
