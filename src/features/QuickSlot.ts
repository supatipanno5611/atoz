import { App, Notice, SuggestModal, TFile, WorkspaceLeaf, FileView } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';

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
            new Notice(t('quickSlot.fileRemoved', { slot: slotId }));
            await this.plugin.saveSettings();
            return;
        }

        for (let i = 0; i < slots.length; i++) {
            if (i === targetIndex) continue;
            const otherPaths = toPathArray(slots[i]);
            if (!otherPaths.includes(file.path)) continue;

            slots[i] = fromPathArray(otherPaths.filter(p => p !== file.path));
            slots[targetIndex] = fromPathArray([...targetPaths, file.path]);
            new Notice(t('quickSlot.fileMoved', { from: i + 1, to: slotId }));
            await this.plugin.saveSettings();
            return;
        }

        slots[targetIndex] = fromPathArray([...targetPaths, file.path]);
        new Notice(
            targetPaths.length === 0
                ? t('quickSlot.currentAssigned', { slot: slotId })
                : t('quickSlot.currentAdded', { slot: slotId })
        );
        await this.plugin.saveSettings();
    }

    async openSlot(slotId: number): Promise<void> {
        const index = slotId - 1;
        const paths = toPathArray(this.plugin.settings.quickSlots[index]);
        if (paths.length === 0) {
            new Notice(t('quickSlot.empty', { slot: slotId }));
            return;
        }

        if (paths.length > 1) {
            await this.openMultiple(slotId, index, paths);
            return;
        }

        const filePath = paths[0]!;
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(t('quickSlot.missingCleared', { slot: slotId }));
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
                new Notice(t('quickSlot.missingRemoved', { slot: slotId }));
            }
        }

    openAssignModal(): void {
        const currentFile = this.plugin.app.workspace.getActiveFile();
        if (!currentFile) {
            new Notice(t('quickSlot.noActiveFile'));
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
        void super.onOpen();
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
    abstract onChooseSuggestion(slotId: number, evt: MouseEvent | KeyboardEvent): void;
}

class SlotAssignModal extends BaseSlotModal {
    constructor(app: App, plugin: ATOZPlugin, private currentFile: TFile) {
        super(app, plugin, t('quickSlot.assignTitle'));
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
            el.setText(t('quickSlot.assignedItem', { slot: slotId, paths: slotPaths.join(', ') }));
        } else {
            el.setText(slotPaths.length === 0
                ? t('quickSlot.emptyItem', { slot: slotId })
                : otherIndex === -1
                    ? t('quickSlot.addItem', { slot: slotId, paths: slotPaths.join(', ') })
                    : t('quickSlot.moveItem', { slot: slotId, paths: slotPaths.join(', '), from: otherIndex + 1 }));
        }
    }

    onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): void {
        void this.plugin.quickSlot.saveOrClearSlot(slotId, this.currentFile);
    }
}

class SlotOpenModal extends BaseSlotModal {
    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin, t('quickSlot.openTitle'));
    }

    renderSuggestion(slotId: number, el: HTMLElement): void {
        const index = slotId - 1;
        const paths = toPathArray(this.plugin.settings.quickSlots[index]);
        el.setText(paths.length > 0
            ? t('quickSlot.openItem', { slot: slotId, paths: paths.join(', ') })
            : t('quickSlot.emptyItem', { slot: slotId }));
    }

    onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): void {
        void this.plugin.quickSlot.openSlot(slotId);
    }
}
