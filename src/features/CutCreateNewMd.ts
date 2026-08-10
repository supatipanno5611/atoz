import { App, Editor, Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';

export class CutCreateNewMdFeature {
    constructor(private plugin: ATOZPlugin) {}

    async cutAndCreateNewMd(editor: Editor): Promise<void> {
        const hasSelection = editor.somethingSelected();
        let contentToMove: string;
        let startLine: number;
        let endLine: number;

        if (hasSelection) {
            const selection = editor.listSelections()[0];
            if (!selection) return;

            startLine = Math.min(selection.anchor.line, selection.head.line);
            endLine = Math.max(selection.anchor.line, selection.head.line);
            const lines: string[] = [];
            for (let index = startLine; index <= endLine; index++) {
                lines.push(editor.getLine(index));
            }
            contentToMove = lines.join('\n');
        } else {
            startLine = 0;
            endLine = editor.lineCount() - 1;
            contentToMove = editor.getValue();
        }

        if (!contentToMove.trim()) {
            new Notice(t('notice.nothingToMove'));
            return;
        }

        const originalFile = this.plugin.app.workspace.getActiveFile();
        if (!originalFile) return;

        const isFullContent = !hasSelection;
        new CutAndCreateModal(this.plugin.app, (filename) => {
            void this.createNoteFromSelection(filename, contentToMove, originalFile, isFullContent, startLine, endLine);
        }).open();
    }

    private async createNoteFromSelection(
        filename: string,
        contentToMove: string,
        originalFile: TFile,
        isFullContent: boolean,
        startLine: number,
        endLine: number,
    ): Promise<void> {
        try {
            const newPath = normalizePath(`${filename}.md`);
            const newFile = await this.plugin.app.vault.create(newPath, contentToMove);

            const leaf = this.plugin.app.workspace.getLeaf(false);
            await leaf.openFile(newFile);
            this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });

            if (isFullContent) {
                await this.plugin.app.vault.modify(originalFile, '');
                return;
            }

            await this.plugin.app.vault.process(originalFile, (data) => {
                const lines = data.split('\n');
                lines.splice(startLine, endLine - startLine + 1);
                return lines.join('\n');
            });
        } catch (error) {
            console.error(error);
            new Notice(t('notice.failedToCreateNote'));
        }
    }
}

export class CutAndCreateModal extends Modal {
    private inputEl!: HTMLInputElement;
    private errorEl!: HTMLElement;

    constructor(
        app: App,
        private onSubmit: (filename: string) => void,
    ) {
        super(app);
        this.modalEl.addClass('prompt');
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText(t('createNote.title'));

        new Setting(contentEl).addText((text) => {
            this.inputEl = text.inputEl;
            text.setPlaceholder(t('createNote.fileName'));
            text.inputEl.addEventListener('input', () => this.clearError());
            window.setTimeout(() => text.inputEl.focus(), 0);
        });

        this.errorEl = contentEl.createDiv({ cls: 'cut-create-error' });
        this.scope.register([], 'Enter', () => {
            this.handleSubmit();
            return false;
        });
    }

    private handleSubmit(): void {
        const raw = this.inputEl.value.trim();

        if (!raw) {
            this.showError(t('createNote.fileNameRequired'));
            return;
        }

        if (/[\\/:*?"<>|]/.test(raw)) {
            this.showError(t('createNote.invalidCharacters'));
            return;
        }

        if (this.app.vault.getAbstractFileByPath(normalizePath(`${raw}.md`))) {
            this.showError(t('createNote.alreadyExists'));
            return;
        }

        this.close();
        this.onSubmit(raw);
    }

    private showError(message: string): void {
        this.errorEl.setText(message);
        this.errorEl.addClass('is-visible');
    }

    private clearError(): void {
        this.errorEl.removeClass('is-visible');
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
