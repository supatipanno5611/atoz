import { App, Notice, SuggestModal, TFile, WorkspaceLeaf, FileView } from 'obsidian';
import type ATOZPlugin from '../main';

export function toPathArray(slot: string | string[] | null | undefined): string[] {
    if (!slot) return [];
    return Array.isArray(slot) ? slot : [slot];
}

export function fromPathArray(paths: string[]): string | string[] | null {
    if (paths.length === 0) return null;
    if (paths.length === 1) return paths[0]!;
    return paths;
}

export class QuickSlotFeature {
    constructor(private plugin: ATOZPlugin) {}

    async saveOrClearSlot(slotId: number, file: TFile): Promise<void> {
        const targetIndex = slotId - 1;
        const slots = this.plugin.settings.quickSlots;
        const targetPaths = toPathArray(slots[targetIndex]);

        if (targetPaths.includes(file.path)) {
            const next = targetPaths.filter(p => p !== file.path);
            slots[targetIndex] = fromPathArray(next);
            new Notice(`슬롯 ${slotId}에서 파일이 제거되었습니다.`);
            await this.plugin.saveSettings();
            return;
        }

        for (let i = 0; i < slots.length; i++) {
            if (i === targetIndex) continue;
            const otherPaths = toPathArray(slots[i]);
            if (!otherPaths.includes(file.path)) continue;

            slots[i] = fromPathArray(otherPaths.filter(p => p !== file.path));
            slots[targetIndex] = fromPathArray([...targetPaths, file.path]);
            new Notice(`슬롯 ${i + 1}에서 슬롯 ${slotId}(으)로 이동되었습니다.`);
            await this.plugin.saveSettings();
            return;
        }

        slots[targetIndex] = fromPathArray([...targetPaths, file.path]);
        new Notice(
            targetPaths.length === 0
                ? `현재 파일이 퀵 슬롯 ${slotId}에 지정되었습니다.`
                : `현재 파일이 퀵 슬롯 ${slotId}에 추가되었습니다.`
        );
        await this.plugin.saveSettings();
    }

    async openSlot(slotId: number): Promise<void> {
        const index = slotId - 1;
        const paths = toPathArray(this.plugin.settings.quickSlots[index]);
        if (paths.length === 0) {
            new Notice(`퀵 슬롯 ${slotId}이 비어 있습니다.`);
            return;
        }

        if (paths.length > 1) {
            await this.openMultiple(slotId, index, paths);
            return;
        }

        const filePath = paths[0]!;
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

    private async openMultiple(slotId: number, index: number, paths: string[]): Promise<void> {
            const validPaths: string[] = [];
            let firstLeaf: WorkspaceLeaf | null = null;
    
            for (const path of paths) {
                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) continue;
                validPaths.push(path);
    
                let existingLeaf: WorkspaceLeaf | null = null;
                this.plugin.app.workspace.iterateAllLeaves((leaf) => {
                    if (leaf.getRoot() === this.plugin.app.workspace.rootSplit) {
                        if (leaf.view instanceof FileView && leaf.view.file?.path === file.path) {
                            existingLeaf = leaf;
                        }
                    }
                });
    
                const leaf = existingLeaf ?? this.plugin.app.workspace.getLeaf('tab');
                if (!existingLeaf) await leaf.openFile(file);
    
                if (!firstLeaf) firstLeaf = leaf;
            }
    
            if (firstLeaf) {
                this.plugin.app.workspace.setActiveLeaf(firstLeaf, { focus: true });
            }
    
            if (validPaths.length !== paths.length) {
                this.plugin.settings.quickSlots[index] = fromPathArray(validPaths);
                await this.plugin.saveSettings();
                new Notice(`슬롯 ${slotId}에서 찾을 수 없는 파일을 제거했습니다.`);
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
        const slotPaths = toPathArray(this.plugin.settings.quickSlots[index]);
        const isInThisSlot = slotPaths.includes(this.currentFile.path);

        let otherIndex = -1;
        this.plugin.settings.quickSlots.forEach((slot, i) => {
            if (i !== index && toPathArray(slot).includes(this.currentFile.path)) otherIndex = i;
        });

        if (isInThisSlot) {
            el.setText(`[${slotId}] 슬롯: ${slotPaths.join(', ')} (누르면 제거)`);
        } else {
            let text = `[${slotId}] 슬롯: `;
            text += slotPaths.length > 0 ? `${slotPaths.join(', ')} (추가` : `(비어 있음`;
            text += otherIndex !== -1 ? `, 기존 슬롯 ${otherIndex + 1}에서 이동)` : `)`;
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
        const paths = toPathArray(this.plugin.settings.quickSlots[index]);
        el.setText(paths.length > 0 ? `[${slotId}] 슬롯: ${paths.join(', ')} (누르면 열기)` : `[${slotId}] 슬롯: (비어 있음)`);
    }

    async onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): Promise<void> {
        await this.plugin.quickSlot.openSlot(slotId);
    }
}
