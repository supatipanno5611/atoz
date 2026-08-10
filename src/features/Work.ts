import { MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';

export class WorkFeature {
    constructor(private plugin: ATOZPlugin) {}

    async cleanupTabs(): Promise<void> {
        const { workspace } = this.plugin.app;
        const leavesToClose: WorkspaceLeaf[] = [];

        workspace.iterateAllLeaves((leaf) => {
            const isPinned = leaf.getViewState().pinned;
            if (leaf.getRoot() === workspace.rootSplit && !isPinned) {
                leavesToClose.push(leaf);
            }
        });

        leavesToClose.forEach((leaf) => leaf.detach());
        await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    async openWorkFile(): Promise<void> {
        await this.openFileInRoot(this.plugin.settings.workFilePath);
    }

    private async openFileInRoot(path: string): Promise<void> {
        const { workspace, vault } = this.plugin.app;

        try {
            const targetFile = vault.getAbstractFileByPath(path);
            if (!(targetFile instanceof TFile)) {
                new Notice(t('work.fileNotFound', { path }));
                return;
            }

            let existingLeaf: WorkspaceLeaf | null = null;
            workspace.iterateRootLeaves((leaf) => {
                if (
                    !existingLeaf &&
                    leaf.view instanceof MarkdownView &&
                    leaf.view.file?.path === path
                ) {
                    existingLeaf = leaf;
                }
            });

            const leaf = existingLeaf ?? workspace.getLeaf(true);
            if (!existingLeaf) {
                await leaf.openFile(targetFile);
            }

            workspace.setActiveLeaf(leaf, { focus: true });
            if (leaf.view instanceof MarkdownView) {
                leaf.view.editor.focus();
            }
        } catch {
            new Notice(t('work.openFailed'));
        }
    }
}
