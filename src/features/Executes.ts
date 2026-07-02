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
    
        // 3.5. 대상 폴더가 설정되어 있다면, 편집 전에 존재 여부를 미리 확인합니다.
        const targetFolder = this.plugin.settings.moveLineTargetFolder?.trim();
        if (targetFolder && !this.plugin.app.vault.getAbstractFileByPath(targetFolder)) {
            new Notice(`대상 폴더를 찾을 수 없습니다: ${targetFolder}`);
            return;
        }
    
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
    
        // 4. 설정된 대상 폴더 안에 생성되도록 경로를 계산합니다.
        const finalPath = targetFolder ? `${targetFolder}/${targetFilename}` : targetFilename;
    
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

    async convertWikiLinks(editor: any, file: TFile): Promise<void> {
        const text = editor.getValue();
        const regex = /\[\[(.*?)(?:\|(.*?))?\]\]/g;
        
        let errorLogs: string[] = [];
        
        // replace 콜백을 통해 변환과 동시에 오류 검출 및 행 번호 계산
        const newText = text.replace(
        	regex,
        	(
        		matchStr: string,
        		p1: string,
        		p2: string | undefined,
        		offset: number
        	) => {
            const linkUrl = p1.trim();
    
            // URL 부분에 공백이 있는지 검사
            if (/\s/.test(linkUrl)) {
                // 현재 매칭 위치(offset)까지의 텍스트를 쪼개어 행 번호 계산
                const lineNumber = text.substring(0, offset).split('\n').length;
                const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false });
                
                errorLogs.push(`- **[${timeStr}]** [[${file.basename}]]: \`${lineNumber}번째 행\` \`${matchStr}\``);
                
                // 공백 오류 시 변환하지 않고 원본 유지
                return matchStr;
            }
    
            // 대상 노트의 title 속성 조회, 없으면 |text, 그것도 없으면 url로 폴백
            const targetFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linkUrl, file.path);
            const targetTitle = targetFile
                ? (this.plugin.app.metadataCache.getFileCache(targetFile)?.frontmatter as Record<string, unknown> | undefined)?.title
                : undefined;
            const linkText = typeof targetTitle === 'string' && targetTitle
                ? targetTitle
                : (p2 ? p2.trim() : linkUrl);
    
            // 정상적인 위키링크 -> 마크다운 링크 변환
            return `[${linkText}](${linkUrl})`;
        });
    
        // 변경사항이 있을 때만 에디터 갱신 (단일 트랜잭션 유지)
        if (text !== newText) {
            editor.setValue(newText);
        }
    
        // 결과 알림 및 로그 파일 적재 처리
        if (errorLogs.length > 0) {
            await this.writeToLogFile(errorLogs);
            new Notice(`log.md 확인. 공백 오류 ${errorLogs.length}개 링크 제외 변환 완료`);
        } else {
            new Notice('위키링크 변환 완료');
        }
    }
    
    async writeToLogFile(logs: string[]): Promise<void> {
        const logFileName = 'log.md';
    
        let logFile = this.plugin.app.vault.getAbstractFileByPath(logFileName);
        const logContent = '\n' + logs.join('\n');
    
        if (logFile instanceof TFile) {
            await this.plugin.app.vault.append(logFile, logContent);
        } else {
            await this.plugin.app.vault.create(logFileName, logContent);
        }
    }
}
