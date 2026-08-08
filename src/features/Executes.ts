import type ATOZPlugin from '../main';
import { MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
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
            const linkText = p2
                ? p2.trim()
                : (typeof targetTitle === 'string' && targetTitle ? targetTitle : linkUrl);
    
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
