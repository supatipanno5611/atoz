import { MarkdownView, Notice, TFile, WorkspaceLeaf, moment } from 'obsidian';
import type ATOZPlugin from '../main';

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

    async readWorkContent(): Promise<{ file: TFile; content: string } | null> {
        const { vault, workspace } = this.plugin.app;
        const workPath = this.plugin.settings.workFilePath;

        try {
            const workFile = vault.getAbstractFileByPath(workPath);
            if (!(workFile instanceof TFile)) {
                new Notice(`Work file not found: ${workPath}`);
                return null;
            }

            const activeView = workspace.getActiveViewOfType(MarkdownView);
            if (activeView && activeView.file?.path === workPath) {
                return { file: workFile, content: activeView.editor.getValue() };
            }

            return { file: workFile, content: await vault.read(workFile) };
        } catch (error) {
            console.error(error);
            new Notice('Failed to read work file.');
            return null;
        }
    }

    async backupAndClear(workFile: TFile, content: string): Promise<boolean> {
        const { vault } = this.plugin.app;
        const laterPath = this.plugin.settings.laterFilePath;

        try {
            const laterFile = vault.getAbstractFileByPath(laterPath);
            if (!(laterFile instanceof TFile)) {
                new Notice(`Backup file not found: ${laterPath}`);
                return false;
            }

            const timestamp = moment().format(this.plugin.settings.workTimestampFormat);
            const laterContent = await vault.read(laterFile);
            await vault.modify(laterFile, `${laterContent}\n\n${timestamp}\n${content}`);
            await vault.modify(workFile, '');
            return true;
        } catch (error) {
            console.error(error);
            new Notice('Failed to back up work file.');
            return false;
        }
    }

    async openWorkFile(): Promise<void> {
        await this.openFileInRoot(this.plugin.settings.workFilePath, 'Failed to open work note.');
    }

    async openLaterFile(): Promise<void> {
        await this.openFileInRoot(this.plugin.settings.laterFilePath, 'Failed to open later note.', true);
    }

    private async openFileInRoot(path: string, errorMessage: string, moveToLastHeading = false): Promise<void> {
        const { workspace, vault } = this.plugin.app;

        try {
            const targetFile = vault.getAbstractFileByPath(path);
            if (!(targetFile instanceof TFile)) {
                new Notice(`File not found: ${path}`);
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
                if (moveToLastHeading) this.moveToLastHeading(leaf.view);
            }
        } catch {
            new Notice(errorMessage);
        }
    }

    private moveToLastHeading(view: MarkdownView): void {
        const { editor } = view;

        for (let line = editor.lineCount() - 1; line >= 0; line--) {
            if (/^#{1,6}\s+\S/.test(editor.getLine(line))) {
                const pos = { line, ch: 0 };
                editor.setCursor(pos);
                editor.scrollIntoView({ from: pos, to: pos }, true);
                return;
            }
        }
    }
}
