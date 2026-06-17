import { App, Modal, Notice, Setting } from 'obsidian';
import type ATOZPlugin from '../main';

type FrontmatterRecord = Record<string, unknown>;

function isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

export class AudioFeature {
    constructor(private plugin: ATOZPlugin) {}

    insertAudioProperties(): void {
        new AudioSrcModal(this.plugin.app, (src) => {
            if (!isHttpUrl(src)) {
                new Notice('HTTP 또는 HTTPS 오디오 링크를 입력하세요.');
                return;
            }

            new AudioTitleModal(this.plugin.app, src, (title) => {
                void this.saveAudioProperties(src, title);
            }).open();
        }).open();
    }

    private async saveAudioProperties(src: string, title: string): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성 파일이 없습니다.');
            return;
        }

        if (!title.trim()) {
            new Notice('오디오 제목을 입력하세요.');
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            const fm = frontmatter as FrontmatterRecord;
            fm.audioSrc = src;
            fm.audioTitle = title.trim();
        });

        new Notice('오디오 속성을 저장했습니다.');
    }
}

class AudioSrcModal extends Modal {
    private inputEl!: HTMLInputElement;

    constructor(
        app: App,
        private onSubmit: (src: string) => void,
    ) {
        super(app);
        this.modalEl.addClass('prompt');
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText('오디오 링크 입력');

        new Setting(contentEl).addText((text) => {
            this.inputEl = text.inputEl;
            text.setPlaceholder('오디오 링크');
            window.setTimeout(() => text.inputEl.focus(), 0);
        });

        this.scope.register([], 'Enter', () => {
            this.handleSubmit();
            return false;
        });
    }

    private handleSubmit(): void {
        const src = this.inputEl.value.trim();
        this.close();
        this.onSubmit(src);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

class AudioTitleModal extends Modal {
    private inputEl!: HTMLInputElement;

    constructor(
        app: App,
        private src: string,
        private onSubmit: (title: string) => void,
    ) {
        super(app);
        this.modalEl.addClass('prompt');
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText('오디오 제목 입력');
        contentEl.createDiv({ text: this.src });

        new Setting(contentEl).addText((text) => {
            this.inputEl = text.inputEl;
            text.setPlaceholder('오디오 제목');
            window.setTimeout(() => text.inputEl.focus(), 0);
        });

        this.scope.register([], 'Enter', () => {
            this.handleSubmit();
            return false;
        });
    }

    private handleSubmit(): void {
        const title = this.inputEl.value.trim();
        this.close();
        this.onSubmit(title);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
