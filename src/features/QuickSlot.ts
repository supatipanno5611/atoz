import { App, Notice, SuggestModal, TFile, WorkspaceLeaf, FileView } from 'obsidian';
import type ATOZPlugin from '../main';

export class QuickSlotFeature {
    constructor(private plugin: ATOZPlugin) {}

    async saveOrClearSlot(slotId: number, file: TFile): Promise<void> {
        const targetIndex = slotId - 1;
        const slots = this.plugin.settings.quickSlots;
        const existingIndex = slots.indexOf(file.path);

        if (existingIndex === targetIndex) {
            slots[targetIndex] = null;
            new Notice(`슬롯 ${slotId}의 지정이 해제되었습니다.`);
        } else {
            if (existingIndex !== -1) {
                slots[existingIndex] = null;
                new Notice(`슬롯 ${existingIndex + 1}에서 슬롯 ${slotId}(으)로 이동되었습니다.`);
            } else {
                new Notice(`현재 파일이 퀵 슬롯 ${slotId}에 지정되었습니다.`);
            }
            slots[targetIndex] = file.path;
        }
        await this.plugin.saveSettings();
    }

    async openSlot(slotId: number): Promise<void> {
        const index = slotId - 1;
        const filePath = this.plugin.settings.quickSlots[index];
        if (!filePath) {
            new Notice(`퀵 슬롯 ${slotId}이 비어 있습니다.`);
            return;
        }

        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(`슬롯 ${slotId}의 파일을 찾을 수 없어 초기화합니다.`);
            this.plugin.settings.quickSlots[index] = null;
            await this.plugin.saveSettings();
            return;
        }

        let existingLeaf: WorkspaceLeaf | null = null;
        this.plugin.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.getRoot() === this.plugin.app.workspace.rootSplit) {
                if (leaf.view instanceof FileView && leaf.view.file?.path === file.path) {
                    existingLeaf = leaf;
                }
            }
        });

        if (existingLeaf) {
            this.plugin.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
        } else {
            const activeLeaf = this.plugin.app.workspace.getLeaf(false);
            const isEmpty = activeLeaf && activeLeaf.view.getViewType() === 'empty';
            const leaf = isEmpty ? activeLeaf : this.plugin.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
        }
    }

    openAssignModal(): void {
        const currentFile = this.plugin.app.workspace.getActiveFile();
        if (!currentFile) {
            new Notice('현재 활성화된 파일이 없습니다.');
            return;
        }
        new SlotAssignModal(this.plugin.app, this.plugin, currentFile).open();
    }

    openSelectModal(): void {
        new SlotOpenModal(this.plugin.app, this.plugin).open();
    }
}

abstract class BaseSlotModal extends SuggestModal<number> {
    constructor(app: App, protected plugin: ATOZPlugin, placeholder: string) {
        super(app);
        this.setPlaceholder(placeholder);
    }

    onOpen(): void {
        super.onOpen();
        ['1', '2', '3', '4'].forEach((key) => {
            this.scope.register(['Alt'], key, (evt: KeyboardEvent) => {
                evt.preventDefault();
                void this.onChooseSuggestion(parseInt(key, 10), evt);
                this.close();
                return false;
            });
        });
    }

    getSuggestions(_query: string): number[] {
        return [1, 2, 3, 4];
    }

    abstract renderSuggestion(slotId: number, el: HTMLElement): void;
    abstract onChooseSuggestion(slotId: number, evt: MouseEvent | KeyboardEvent): Promise<void>;
}

class SlotAssignModal extends BaseSlotModal {
    constructor(app: App, plugin: ATOZPlugin, private currentFile: TFile) {
        super(app, plugin, '지정/해제할 슬롯을 선택하세요.');
    }

    renderSuggestion(slotId: number, el: HTMLElement): void {
        const index = slotId - 1;
        const path = this.plugin.settings.quickSlots[index];
        const existingIndex = this.plugin.settings.quickSlots.indexOf(this.currentFile.path);
        const isAlreadyInAnotherSlot = existingIndex !== -1 && existingIndex !== index;

        if (path === this.currentFile.path) {
            el.setText(`[${slotId}] 슬롯: ${path} (누르면 해제)`);
        } else {
            let text = `[${slotId}] 슬롯: `;
            text += path ? `${path} (덮어쓰기` : `(비어 있음`;
            text += isAlreadyInAnotherSlot ? `, 기존 슬롯 ${existingIndex + 1} 해제)` : `)`;
            el.setText(text);
        }
    }

    async onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): Promise<void> {
        await this.plugin.quickSlot.saveOrClearSlot(slotId, this.currentFile);
    }
}

class SlotOpenModal extends BaseSlotModal {
    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin, '열고 싶은 슬롯을 선택하세요.');
    }

    renderSuggestion(slotId: number, el: HTMLElement): void {
        const index = slotId - 1;
        const path = this.plugin.settings.quickSlots[index];
        el.setText(path ? `[${slotId}] 슬롯: ${path} (누르면 열기)` : `[${slotId}] 슬롯: (비어 있음)`);
    }

    async onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): Promise<void> {
        await this.plugin.quickSlot.openSlot(slotId);
    }
}
