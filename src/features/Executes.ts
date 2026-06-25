import type ATOZPlugin from '../main';
import { Editor, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
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

    async moveLineToTarget(editor: Editor) {
        // 1. 현재 활성화된 파일 정보를 가져옵니다.
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성화된 파일이 없습니다.');
            return;
        }

        // 2. 설정된 접미어를 가져옵니다. 비어있다면 기본값 '_later.md'를 사용합니다.
        const suffix = this.plugin.settings.moveLineSuffix?.trim() || '_later.md';
        
        // 3. 현재 파일 이름(basename) 뒤에 접미어를 붙여 타겟 파일명을 만듭니다.
        const targetFilename = `${activeFile.basename}${suffix}`;

        const cursor = editor.getCursor();
        const lineNum = cursor.line;
        const originalLineText = editor.getLine(lineNum);
        const cleanedText = this.cleanMarkdownSymbols(originalLineText);

        if (lineNum === editor.lineCount() - 1) {
            editor.replaceRange('', { line: lineNum, ch: 0 }, { line: lineNum, ch: originalLineText.length });
        } else {
            editor.replaceRange('', { line: lineNum, ch: 0 }, { line: lineNum + 1, ch: 0 });
        }

        if (!cleanedText) {
            new Notice('빈 행이 삭제되었습니다.');
            return;
        }

        // 4. 현재 파일과 같은 폴더 안에 생성되도록 경로를 계산합니다.
        let finalPath = targetFilename;
        if (activeFile.parent && activeFile.parent.path !== '/') {
            finalPath = `${activeFile.parent.path}/${targetFilename}`;
        }

        const targetFile = this.plugin.app.vault.getAbstractFileByPath(finalPath);
        if (targetFile instanceof TFile) {
            await this.plugin.app.vault.append(targetFile, `\n${cleanedText}`);
        } else {
            await this.plugin.app.vault.create(finalPath, cleanedText);
        }

        new Notice(`"${cleanedText}" 항목을 ${finalPath} 파일로 이동했습니다.`);
    }


    private cleanMarkdownSymbols(text: string): string {
        let result = text.trim();
        if (!result) return '';
        result = result.replace(/^(?:>\s*)*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(?:\d+\.\s+)?/, '');
        return result.trim();
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
