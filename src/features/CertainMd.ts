import { MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type ATOZPlugin from '../main';

export class CertainMdFeature {
    constructor(private plugin: ATOZPlugin) {}

    async openCertainMdFile(): Promise<void> {
        const { CertainMdPath } = this.plugin.settings;

        if (!CertainMdPath) {
            new Notice('Certain Markdown path is not set');
            return;
        }

        const file = this.plugin.app.vault.getAbstractFileByPath(CertainMdPath);
        if (!(file instanceof TFile)) {
            new Notice(`File not found: ${CertainMdPath}`);
            return;
        }

        let targetLeaf: WorkspaceLeaf | null = null;
        this.plugin.app.workspace.iterateRootLeaves((leaf) => {
            if (
                !targetLeaf &&
                leaf.view instanceof MarkdownView &&
                leaf.view.file?.path === CertainMdPath
            ) {
                targetLeaf = leaf;
            }
        });

        if (targetLeaf) {
            this.plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
            return;
        }

        const newLeaf = this.plugin.app.workspace.getLeaf('tab');
        await newLeaf.openFile(file);
    }
}
