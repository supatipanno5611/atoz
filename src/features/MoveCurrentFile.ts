import { App, Modal, Notice, Setting, SuggestModal, TFile, TFolder } from 'obsidian';
import type ATOZPlugin from '../main';

type MoveChoice =
    | { kind: 'move'; label: string }
    | { kind: 'new-folder'; label: string }
    | { kind: 'folder'; label: string; folder: TFolder };

const MOVE_HERE_LABEL = '여기로 이동';
const NEW_FOLDER_LABEL = '새 폴더 만들기';

function folderLabel(folder: TFolder): string {
    return folder.name || '/';
}

function childTargetPath(folder: TFolder, name: string): string {
    return folder.isRoot() ? name : `${folder.path}/${name}`;
}

function isValidFolderName(name: string): boolean {
    return name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}

export class MoveCurrentFileFeature {
    constructor(private plugin: ATOZPlugin) {}

    moveCurrentFile(): void {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
        }

        new MoveFileModal(this.plugin.app, activeFile, this.plugin.app.vault.getRoot()).open();
    }
}

class MoveFileModal extends SuggestModal<MoveChoice> {
    constructor(app: App, private file: TFile, private folder: TFolder) {
        super(app);
        this.setPlaceholder(`이동할 위치 선택: ${this.folder.isRoot() ? '/' : this.folder.path}`);
    }

    getSuggestions(query: string): MoveChoice[] {
        const normalized = query.trim().toLowerCase();
        const folders = this.folder.children
            .filter((child): child is TFolder => child instanceof TFolder)
            .filter((child) => child.name.toLowerCase().includes(normalized))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((folder): MoveChoice => ({ kind: 'folder', label: folderLabel(folder), folder }));

        const fixedItems: MoveChoice[] = [
        	{ kind: 'move', label: MOVE_HERE_LABEL },
        	{ kind: 'new-folder', label: NEW_FOLDER_LABEL },
        ];

        return normalized
        	? [...folders, ...fixedItems]
        	: [...fixedItems, ...folders];
    }

    renderSuggestion(value: MoveChoice, el: HTMLElement): void {
        el.setText(value.label);
    }

    onChooseSuggestion(value: MoveChoice): void {
        if (value.kind === 'move') {
            void this.moveToFolder(this.folder);
            return;
        }
        if (value.kind === 'new-folder') {
            new NewFolderModal(this.app, this.folder, (folderName) => {
                void this.createFolderAndMove(folderName);
            }).open();
            return;
        }

        new MoveFileModal(this.app, this.file, value.folder).open();
    }

    private async moveToFolder(folder: TFolder): Promise<void> {
        if (this.file.parent?.path === folder.path) {
            new Notice('이미 이 위치에 있습니다.');
            return;
        }

        const targetPath = childTargetPath(folder, this.file.name);
        if (this.app.vault.getAbstractFileByPath(targetPath) !== null) {
            new Notice('대상 위치에 같은 이름의 노트가 이미 있습니다.');
            return;
        }

        await this.app.fileManager.renameFile(this.file, targetPath);
        new Notice('현재 파일을 이동했습니다.');
    }

    private async createFolderAndMove(folderName: string): Promise<void> {
        const targetFolderPath = childTargetPath(this.folder, folderName);
        if (this.app.vault.getAbstractFileByPath(targetFolderPath) !== null) {
            new Notice('같은 이름의 폴더가 이미 있습니다.');
            return;
        }

        const targetFilePath = `${targetFolderPath}/${this.file.name}`;
        if (this.app.vault.getAbstractFileByPath(targetFilePath) !== null) {
            new Notice('대상 위치에 같은 이름의 노트가 이미 있습니다.');
            return;
        }

        await this.app.vault.createFolder(targetFolderPath);
        await this.app.fileManager.renameFile(this.file, targetFilePath);
        new Notice('새 폴더를 만들고 현재 파일을 이동했습니다.');
    }
}

class NewFolderModal extends Modal {
    private inputEl!: HTMLInputElement;

    constructor(app: App, private folder: TFolder, private onSubmit: (folderName: string) => void) {
        super(app);
        this.modalEl.addClass('prompt');
    }

    onOpen(): void {
        this.titleEl.setText('새 폴더 만들기');
        new Setting(this.contentEl).addText((text) => {
            this.inputEl = text.inputEl;
            text.setPlaceholder(this.folder.isRoot() ? '/' : this.folder.path);
            window.setTimeout(() => text.inputEl.focus(), 0);
        });
        this.scope.register([], 'Enter', () => {
            const folderName = this.inputEl.value.trim();
            if (!isValidFolderName(folderName)) {
                new Notice('올바른 폴더 이름을 입력하세요.');
                return false;
            }
            this.close();
            this.onSubmit(folderName);
            return false;
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
