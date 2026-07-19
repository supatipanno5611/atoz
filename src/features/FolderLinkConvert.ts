import { App, SuggestModal, TFile, TFolder, Notice } from 'obsidian';
import type ATOZPlugin from '../main';

type FolderChoice =
    | { kind: 'select'; label: string }
    | { kind: 'folder'; label: string; folder: TFolder };

const SELECT_HERE_LABEL = '여기 선택';

function folderLabel(folder: TFolder): string {
    return folder.name || '/';
}

type FrontmatterRecord = Record<string, unknown>;

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export class FolderLinkConvertFeature {
    constructor(private plugin: ATOZPlugin) {}

    openWikilinkToMarkdownPicker(): void {
        new FolderPickerModal(this.plugin.app, this.plugin.app.vault.getRoot(), (folder) => {
            void this.convertWikilinksToMarkdown(folder);
        }).open();
    }

    openPlaintextToWikilinkPicker(): void {
        new FolderPickerModal(this.plugin.app, this.plugin.app.vault.getRoot(), (folder) => {
            void this.convertPlaintextToWikilinks(folder);
        }).open();
    }

    private getFolderFiles(folder: TFolder): TFile[] {
        return this.plugin.app.vault.getMarkdownFiles()
            .filter((file) => file.parent?.path === folder.path);
    }

    // ─── 명령어 1: 위키링크 -> 마크다운 링크 ───────────────────────────────

    private async convertWikilinksToMarkdown(folder: TFolder): Promise<void> {
        const files = this.getFolderFiles(folder);
        const regex = /\[\[(.*?)(?:\|(.*?))?\]\]/g;

        let convertedCount = 0;
        let errorCount = 0;
        const logs: string[] = [];

        for (const file of files) {
            let fileHadChange = false;

            await this.plugin.app.vault.process(file, (data) => {
                const newText = data.replace(
                    regex,
                    (matchStr: string, p1: string, p2: string | undefined, offset: number) => {
                        const linkUrl = p1.trim();

                        if (/\s/.test(linkUrl)) {
                            const lineNumber = data.substring(0, offset).split('\n').length;
                            const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false });
                            logs.push(`- **[${timeStr}]** [[${file.basename}]]: \`${lineNumber}번째 행\` \`${matchStr}\``);
                            errorCount++;
                            return matchStr;
                        }

                        const targetFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linkUrl, file.path);
                        const targetFm = targetFile
                            ? (this.plugin.app.metadataCache.getFileCache(targetFile)?.frontmatter as FrontmatterRecord | undefined)
                            : undefined;
                        const aliases = readStringArray(targetFm?.aliases);
                        const targetTitle = targetFm?.title;

                        const linkText = p2
                            ? p2.trim()
                            : aliases.length > 0
                                ? aliases[0]!
                                : typeof targetTitle === 'string' && targetTitle
                                    ? targetTitle
                                    : linkUrl;

                        convertedCount++;
                        fileHadChange = true;
                        return `[${linkText}](${linkUrl})`;
                    }
                );

                return newText;
            });

            if (fileHadChange) continue;
        }

        await this.writeSummaryLog('폴더 위키링크 → 마크다운 링크 변환', folder, convertedCount, errorCount, logs);
        new Notice('완료되었습니다.');
    }

    // ─── 명령어 2: 플레인 텍스트 -> 위키링크 ───────────────────────────────

    private async convertPlaintextToWikilinks(folder: TFolder): Promise<void> {
        const files = this.getFolderFiles(folder);

        interface Candidate {
            name: string;
            isAlias: boolean;
        }

        let convertedCount = 0;
        const logs: string[] = [];

        for (const file of files) {
            const candidates: Candidate[] = [];

            for (const other of files) {
                if (other.path === file.path) continue;
                candidates.push({ name: other.basename, isAlias: false });

                const cache = this.plugin.app.metadataCache.getFileCache(other);
                const fm = cache?.frontmatter as FrontmatterRecord | undefined;
                for (const alias of readStringArray(fm?.aliases)) {
                    candidates.push({ name: alias, isAlias: true });
                }
            }

            // 긴 문자열 우선 정렬
            candidates.sort((a, b) => b.name.length - a.name.length);

            let convertedInFile = 0;

            await this.plugin.app.vault.process(file, (data) => {
                const { frontmatterEnd, body } = this.splitFrontmatter(data);

                let newBody = body;
                const protectedRanges: [number, number][] = this.findExistingLinkRanges(newBody);

                for (const candidate of candidates) {
                    const result = this.replaceFirstUnprotected(newBody, candidate.name, candidate.isAlias, protectedRanges);
                    if (result) {
                        newBody = result.text;
                        protectedRanges.push(result.range);
                        convertedInFile++;
                    }
                }

                if (convertedInFile === 0) return data;
                return data.slice(0, frontmatterEnd) + newBody;
            });

            if (convertedInFile > 0) {
                convertedCount += convertedInFile;
                logs.push(`- [[${file.basename}]]: ${convertedInFile}개 변환`);
            }
        }

        await this.writeSummaryLog('폴더 텍스트 → 위키링크 변환', folder, convertedCount, 0, logs);
        new Notice('완료되었습니다.');
    }

    /** frontmatter(--- ... ---) 블록을 건너뛴 본문의 시작 인덱스와 본문 텍스트를 반환 */
    private splitFrontmatter(data: string): { frontmatterEnd: number; body: string } {
        if (!data.startsWith('---')) return { frontmatterEnd: 0, body: data };

        const closeMatch = data.slice(3).match(/\n---\s*\n/);
        if (!closeMatch || closeMatch.index === undefined) return { frontmatterEnd: 0, body: data };

        const frontmatterEnd = 3 + closeMatch.index + closeMatch[0].length;
        return { frontmatterEnd, body: data.slice(frontmatterEnd) };
    }

    /** 기존 [[...]] 및 [...](...) 링크의 [start, end) 범위를 수집 */
    private findExistingLinkRanges(text: string): [number, number][] {
        const ranges: [number, number][] = [];
        const wikiRegex = /\[\[.*?\]\]/g;
        const mdLinkRegex = /\[.*?\]\(.*?\)/g;

        let match: RegExpExecArray | null;
        while ((match = wikiRegex.exec(text)) !== null) {
            ranges.push([match.index, match.index + match[0].length]);
        }
        while ((match = mdLinkRegex.exec(text)) !== null) {
            ranges.push([match.index, match.index + match[0].length]);
        }

        return ranges;
    }

    private rangesOverlap(a: [number, number], b: [number, number]): boolean {
        return a[0] < b[1] && b[0] < a[1];
    }

    private isWordChar(ch: string | undefined): boolean {
        if (!ch) return false; // 문자열 경계는 단어 문자가 아님 (즉 경계로 취급)
        return /[\p{L}\p{N}]/u.test(ch);
    }

    /**
     * candidate.name의 첫 번째 매칭(보호 구간과 겹치지 않는)을 찾아 위키링크로 치환.
     * 매칭 없으면 null 반환.
     */
    private replaceFirstUnprotected(
        text: string,
        name: string,
        isAlias: boolean,
        protectedRanges: [number, number][],
    ): { text: string; range: [number, number] } | null {
        const isSingleWord = !/\s/.test(name.trim());
        const lowerText = text.toLowerCase();
        const lowerName = name.toLowerCase();

        let searchFrom = 0;
        while (true) {
            const idx = lowerText.indexOf(lowerName, searchFrom);
            if (idx === -1) return null;

            const matchRange: [number, number] = [idx, idx + name.length];

            const overlapsProtected = protectedRanges.some((r) => this.rangesOverlap(matchRange, r));
            if (overlapsProtected) {
                searchFrom = idx + 1;
                continue;
            }

            if (isSingleWord) {
                const before = text[idx - 1];
                const after = text[idx + name.length];
                if (this.isWordChar(before) || this.isWordChar(after)) {
                    searchFrom = idx + 1;
                    continue;
                }
            }

            const original = text.slice(idx, idx + name.length);
            const replacement = isAlias ? `[[${name}|${original}]]` : `[[${original}]]`;
            const newText = text.slice(0, idx) + replacement + text.slice(idx + name.length);

            return { text: newText, range: [idx, idx + replacement.length] };
        }
    }

    private async writeSummaryLog(
        title: string,
        folder: TFolder,
        convertedCount: number,
        errorCount: number,
        details: string[],
    ): Promise<void> {
        const logFileName = 'log.md';
        const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false });
        const folderLabelText = folder.isRoot() ? '/' : folder.path;

        let content = `\n### [${timeStr}] ${title} (${folderLabelText})\n`;
        content += `- 변환: ${convertedCount}개, 에러: ${errorCount}건\n`;
        if (details.length > 0) {
            content += details.join('\n') + '\n';
        }

        const logFile = this.plugin.app.vault.getAbstractFileByPath(logFileName);
        if (logFile instanceof TFile) {
            await this.plugin.app.vault.append(logFile, content);
        } else {
            await this.plugin.app.vault.create(logFileName, content);
        }
    }
}

class FolderPickerModal extends SuggestModal<FolderChoice> {
    constructor(app: App, private folder: TFolder, private onSubmit: (folder: TFolder) => void) {
        super(app);
        this.setPlaceholder(`대상 폴더 선택: ${this.folder.isRoot() ? '/' : this.folder.path}`);
    }

    getSuggestions(query: string): FolderChoice[] {
        const normalized = query.trim().toLowerCase();
        const folders = this.folder.children
            .filter((child): child is TFolder => child instanceof TFolder)
            .filter((child) => child.name.toLowerCase().includes(normalized))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((folder): FolderChoice => ({ kind: 'folder', label: folderLabel(folder), folder }));

        return [
            { kind: 'select', label: SELECT_HERE_LABEL },
            ...folders,
        ];
    }

    renderSuggestion(value: FolderChoice, el: HTMLElement): void {
        el.setText(value.label);
    }

    onChooseSuggestion(value: FolderChoice): void {
        if (value.kind === 'select') {
            this.onSubmit(this.folder);
            return;
        }

        new FolderPickerModal(this.app, value.folder, this.onSubmit).open();
    }
}
