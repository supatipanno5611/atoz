import { Notice, TFile, normalizePath } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { isRecord } from '../utils';

const NOTELIST_PROPERTY = 'notelist';
const LIST_LINE = /^- \[\[[^\]]+\]\]$/;

function isGeneratedBody(body: string): boolean {
    return body.split('\n').every((line) => line.trim() === '' || LIST_LINE.test(line));
}

type ApplyResult = 'updated' | 'unchanged' | 'skipped';

export class NoteListFeature {
    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.addCommand({
            id: 'refresh-note-list',
            name: t('command.refreshNoteList'),
            icon: 'lucide-list-tree',
            callback: () => void this.refreshAll(true),
        });

        if (this.plugin.app.workspace.layoutReady) {
            void this.refreshAll(false);
            return;
        }

        const ref = this.plugin.app.metadataCache.on('resolved', () => {
            this.plugin.app.metadataCache.offref(ref);
            void this.refreshAll(false);
        });
        this.plugin.registerEvent(ref);
    }

    async refreshAll(notify: boolean): Promise<void> {
        const targets = this.plugin.app.vault.getMarkdownFiles()
            .filter((file) => this.isNoteListNote(file));

        if (targets.length === 0) {
            if (notify) new Notice(t('noteList.noNotes'));
            return;
        }

        let count = 0;
        let skipped = 0;
        for (const file of targets) {
            const result = await this.applyList(file);
            if (result === 'updated') count++;
            else if (result === 'skipped') skipped++;
        }

        if (notify || count > 0) new Notice(t('noteList.refreshed', { count }));
        if (skipped > 0) new Notice(t('noteList.skipped', { count: skipped }));
    }

    private async applyList(file: TFile): Promise<ApplyResult> {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const offset = cache?.frontmatterPosition?.end.offset;
        if (offset === undefined) return 'skipped';

        const current = await this.plugin.app.vault.cachedRead(file);
        const head = current.slice(0, offset);
        if (!isGeneratedBody(current.slice(offset))) return 'skipped';

        const next = `${head}\n${this.buildList(this.collectMentions(file), file.path)}`;
        if (next === current) return 'unchanged';

        await this.plugin.app.vault.process(file, (data) => (data.startsWith(head) ? next : data));
        return 'updated';
    }

    private buildList(sources: TFile[], targetPath: string): string {
        return sources
            .map((file) =>
                `- [[${this.plugin.app.metadataCache.fileToLinktext(file, targetPath, true)}]]\n`)
            .join('');
    }

    private collectMentions(target: TFile): TFile[] {
        const workFilePath = normalizePath(this.plugin.settings.workFilePath);
        const sources: TFile[] = [];

        for (const sourcePath in this.plugin.app.metadataCache.resolvedLinks) {
            if (sourcePath === target.path || sourcePath === workFilePath) continue;
            if (!this.plugin.app.metadataCache.resolvedLinks[sourcePath]?.[target.path]) continue;

            const file = this.plugin.app.vault.getFileByPath(sourcePath);
            if (!file || file.extension !== 'md' || this.isGeneratedNote(file)) continue;
            sources.push(file);
        }

        return sources.sort((a, b) => a.basename.localeCompare(b.basename));
    }

    private isNoteListNote(file: TFile): boolean {
        const frontmatter: unknown = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        return isRecord(frontmatter) && frontmatter[NOTELIST_PROPERTY] === true;
    }

    private isGeneratedNote(file: TFile): boolean {
        const frontmatter: unknown = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!isRecord(frontmatter)) return false;
        return frontmatter.later !== undefined || frontmatter.version !== undefined;
    }
}
