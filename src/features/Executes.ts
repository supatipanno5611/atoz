import type ATOZPlugin from '../main';
import { MarkdownView, WorkspaceLeaf } from 'obsidian';
import { pickMostRecentLeaf } from '../utils';

export class ExecutesFeature {
    constructor(private plugin: ATOZPlugin) {}

    async focusRootLeaf() {
        const { workspace } = this.plugin.app;
    
        // 이미 메인탭 MarkdownView에 있으면 커서만 활성화
        const activeLeaf = workspace.getMostRecentLeaf();
        if (activeLeaf?.getRoot() === workspace.rootSplit &&
            activeLeaf.view instanceof MarkdownView &&
            activeLeaf.view.file) {
            activeLeaf.view.editor.focus();
            return;
        }
    
        const rootLeaves: WorkspaceLeaf[] = [];
        workspace.iterateRootLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.file) rootLeaves.push(leaf);
        });
    
        const target = pickMostRecentLeaf(rootLeaves, this.plugin.app);
        if (target) {
            workspace.setActiveLeaf(target, { focus: true });
            (target.view as MarkdownView).editor.focus();
            return;
        }
    
        await this.plugin.work.openWorkFile();
    }

    executeDeleteParagraph() {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        const editor = view.editor;
        const cursor = editor.getCursor();
        const lineCount = editor.lineCount();

        if (lineCount === 1) {
            editor.setValue('');
            return;
        }

        if (cursor.line < lineCount - 1) {
            editor.replaceRange('',
                { line: cursor.line, ch: 0 },
                { line: cursor.line + 1, ch: 0 }
            );
        } else {
            editor.replaceRange('',
                { line: cursor.line - 1, ch: editor.getLine(cursor.line - 1).length },
                { line: cursor.line, ch: editor.getLine(cursor.line).length }
            );
        }
    }
}
