import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type ATOZPlugin from '../main';
import { BlogFolder } from '../types';

type FrontmatterRecord = Record<string, unknown>;

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function splitFilename(name: string): { category: string; order: string; unique: string } {
    const firstDash = name.indexOf('-');
    if (firstDash === -1) {
        return { category: '', order: '', unique: name };
    }

    const category = name.substring(0, firstDash);
    const rest = name.substring(firstDash + 1);
    const orderMatch = rest.match(/^(\d+)-(.+)$/);

    if (orderMatch) {
        return { category, order: orderMatch[1]!, unique: orderMatch[2]! };
    }

    return { category, order: '', unique: rest };
}

interface BlogEntry {
    file: TFile;
    order: number;
    unique: string;
}

function scanBlogEntries(app: App, blogFolder: string, category: string, excludeFile: TFile): BlogEntry[] {
    const entries: BlogEntry[] = [];
    const pattern = new RegExp(`^${category}-(\\d+)-(.+)$`);

    for (const file of app.vault.getMarkdownFiles()) {
        if (file.path === excludeFile.path) continue;
        if (file.parent?.path !== blogFolder) continue;

        const match = file.basename.match(pattern);
        if (!match) continue;

        entries.push({ file, order: parseInt(match[1]!, 10), unique: match[2]! });
    }

    return entries;
}

export class BlogFeature {
    private tempData = new Map<string, { title: string; desc: string; aliases: string }>();

    constructor(private plugin: ATOZPlugin) {}

    async openTitleDescModal(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
         if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
         }

        const cache = this.plugin.app.metadataCache.getFileCache(activeFile);
        const fm = (cache?.frontmatter as FrontmatterRecord | undefined) ?? {};

        const { unique } = splitFilename(activeFile.basename);
        const currentTitle = typeof fm.title === 'string' ? fm.title : unique;
        const currentDesc = typeof fm.description === 'string' ? fm.description : '';
        const existingAliases = readStringArray(fm.aliases);
        const currentAliases = existingAliases.length > 0 ? existingAliases.join(', ') : unique;

        new PropertyInputModal(
            this.plugin.app,
            activeFile.path,
            currentTitle,
            currentDesc,
            currentAliases,
            this.tempData,
            async (finalTitle, finalDesc, finalAliases) => {
                await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
                    const targetFm = frontmatter as FrontmatterRecord;
                    targetFm.title = finalTitle;
                    targetFm.description = finalDesc;
                    targetFm.aliases = finalAliases;
                });
                this.tempData.delete(activeFile.path);
                new Notice('속성을 저장했습니다.');
            }
        ).open();
    }

    async renameFile(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();

        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('활성 마크다운 파일이 없습니다.');
            return;
        }

        new RenameFileModal(this.plugin, activeFile).open();
    }
}

class PropertyInputModal extends Modal {
    constructor(
        app: App,
        private filePath: string,
        private defaultTitle: string,
        private defaultDesc: string,
        private defaultAliases: string,
        private tempData: Map<string, { title: string; desc: string; aliases: string }>,
        private onSubmit: (title: string, desc: string, aliases: string[]) => Promise<void>
    ) {
        super(app);
    }

    onOpen() {
        let titleResult = this.defaultTitle;
        let descResult = this.defaultDesc;
        let aliasesResult = this.defaultAliases;

        this.titleEl.setText('문서 속성 설정 (Title / Description)');

        if (this.tempData.has(this.filePath)) {
            const saved = this.tempData.get(this.filePath)!;
            new Setting(this.contentEl)
                .setName('작성 중이던 데이터가 있습니다.')
                .setDesc('임시 보관된 내용으로 덮어씌우시겠습니까?')
                .addButton(btn => btn
                    .setButtonText('이어서 쓰기')
                    .setClass('mod-warning')
                    .onClick(() => {
                        titleResult = saved.title;
                        descResult = saved.desc;
                        aliasesResult = saved.aliases;

                        titleInput.setValue(saved.title);
                        descTextArea.setValue(saved.desc);
                        aliasesInput.setValue(saved.aliases);

                        new Notice('작성 중이던 내용을 불러왔습니다.');
                    })
                );
        }

        let titleInput: any;
        new Setting(this.contentEl)
            .setName('Title')
            .setDesc('노트의 메타데이터 제목을 지정합니다.')
            .addText(text => {
                titleInput = text;
                text.setValue(titleResult);
                text.onChange(v => {
                    titleResult = v;
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult, aliases: aliasesResult });
                });
            });

        let descTextArea: any;
        new Setting(this.contentEl)
            .setName('Description')
            .setDesc('노트의 상세 설명을 적어주세요.')
            .addTextArea(text => {
                descTextArea = text;
                text.setValue(descResult);
                text.inputEl.style.width = '100%';
                text.inputEl.style.height = '120px';
                text.onChange(v => {
                    descResult = v;
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult, aliases: aliasesResult });
                });
            });

        let aliasesInput: any;
        new Setting(this.contentEl)
            .setName('Aliases')
            .setDesc('콤마(,)로 구분하여 입력합니다.')
            .addText(text => {
                aliasesInput = text;
                text.setValue(aliasesResult);
                text.onChange(v => {
                    aliasesResult = v;
                    this.tempData.set(this.filePath, { title: titleResult, desc: descResult, aliases: aliasesResult });
                });
            });

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('저장하기')
                .setCta()
                .onClick(async () => {
                    const aliasesArray = aliasesResult
                        .split(',')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);
                    await this.onSubmit(titleResult, descResult, aliasesArray);
                    this.close();
                })
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}

class RenameFileModal extends Modal {
    constructor(
        private plugin: ATOZPlugin,
        private file: TFile,
    ) {
        super(plugin.app);
    }

    onOpen() {
        const parsed = splitFilename(this.file.basename);

        let folder: BlogFolder | null = this.findFolderForFile();
        let category = parsed.category;
        let order = parsed.order;
        let unique = parsed.unique;

        if (!order && category && folder) {
            order = String(this.nextOrderFor(folder, category));
        }

        this.titleEl.setText('파일 이름 변경');

        const previewListEl = document.createElement('div');
        previewListEl.style.marginTop = '8px';
        previewListEl.style.fontSize = '0.85em';
        previewListEl.style.color = 'var(--text-muted)';
        previewListEl.style.whiteSpace = 'pre-line';

        const preview = document.createElement('div');
        preview.style.marginTop = '8px';
        preview.style.fontWeight = 'bold';

        const refreshPreview = () => {
            preview.setText(
                category.trim()
                    ? order.trim()
                        ? `${category.trim()}-${order.trim()}-${unique.trim()}`
                        : `${category.trim()}-${unique.trim()}`
                    : unique.trim()
            );
            this.refreshOrderPreview(previewListEl, folder, category.trim(), order.trim());
        };

        let categoryDropdown: any;
        const rebuildCategoryOptions = () => {
            categoryDropdown.selectEl.empty();
            const categories = folder?.categories ?? [];
            for (const item of categories) {
                categoryDropdown.addOption(item, item);
            }
            if (category && !categories.includes(category)) {
                categoryDropdown.addOption(category, category);
            }
            categoryDropdown.setValue(category);
        };

        new Setting(this.contentEl)
            .setName('블로그 폴더')
            .setDesc('파일이 속할 폴더')
            .addDropdown(drop => {
                const folders = this.plugin.settings.blogFolders;
                for (const f of folders) {
                    drop.addOption(f.path, f.path || '/');
                }

                const currentParentPath = this.file.parent?.path ?? '';
                if (folder && !folders.some(f => f.path === folder!.path)) {
                    drop.addOption(folder.path, folder.path || '/');
                }

                if (folder) {
                    drop.setValue(folder.path);
                } else if (folders.length > 0) {
                    folder = folders[0]!;
                    drop.setValue(folder.path);
                }

                drop.onChange(v => {
                    folder = this.plugin.settings.blogFolders.find(f => f.path === v) ?? null;
                    if (!category || !(folder?.categories.includes(category))) {
                        category = folder && folder.categories.length > 0 ? folder.categories[0]! : category;
                        categoryDropdown.setValue(category);
                    }
                    order = folder ? String(this.nextOrderFor(folder, category)) : order;
                    rebuildCategoryOptions();
                    refreshPreview();
                });
            });

        new Setting(this.contentEl)
            .setName('Category')
            .setDesc('파일명 앞부분')
            .addDropdown(drop => {
                categoryDropdown = drop;
                rebuildCategoryOptions();

                drop.onChange(v => {
                    category = v;
                    if (!order && folder) {
                        order = String(this.nextOrderFor(folder, category));
                    }
                    refreshPreview();
                });
            });

        new Setting(this.contentEl)
            .setName('Order')
            .setDesc('같은 카테고리 내 순서 (숫자, 필수)')
            .addText(text => {
                text.setValue(order);
                text.onChange(v => {
                    order = v.trim();
                    refreshPreview();
                });
            });

        new Setting(this.contentEl)
            .setName('Unique name')
            .setDesc('파일명 뒷부분')
            .addText(text => {
                text.setValue(unique);
                text.onChange(v => {
                    unique = v.trim();
                    refreshPreview();
                });
            });

        this.contentEl.appendChild(preview);
        this.contentEl.appendChild(previewListEl);

        refreshPreview();

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('Rename')
                .setCta()
                .onClick(async () => {
                    const trimmedCategory = category.trim();
                    const trimmedOrder = order.trim();
                    const trimmedUnique = unique.trim();

                    if (trimmedCategory) {
                        if (!folder) {
                            new Notice('블로그 폴더를 먼저 설정하세요.');
                            return;
                        }

                        if (!trimmedOrder) {
                            new Notice('순서를 입력하세요.');
                            return;
                        }

                        const orderNum = parseInt(trimmedOrder, 10);
                        if (isNaN(orderNum) || orderNum < 1) {
                            new Notice('순서는 1 이상의 숫자여야 합니다.');
                            return;
                        }

                        const ok = await this.applyOrderedRename(folder, trimmedCategory, orderNum, trimmedUnique);
                        if (!ok) return;

                        new Notice('파일 이름을 변경했습니다.');
                        this.close();
                        return;
                    }

                    const finalName = trimmedUnique;

                    if (!finalName) {
                        new Notice('파일 이름을 입력하세요.');
                        return;
                    }

                    if (finalName === this.file.basename) {
                        this.close();
                        return;
                    }

                    const parent = this.file.parent?.path;

                    const newPath =
                        parent
                            ? `${parent}/${finalName}.md`
                            : `${finalName}.md`;

                    if (this.app.vault.getAbstractFileByPath(newPath)) {
                        new Notice('같은 이름의 파일이 이미 존재합니다.');
                        return;
                    }

                    await this.app.fileManager.renameFile(
                        this.file,
                        newPath,
                    );

                    new Notice('파일 이름을 변경했습니다.');

                    this.close();
                }));
    }

    private findFolderForFile(): BlogFolder | null {
        const currentParentPath = this.file.parent?.path ?? '';
        return this.plugin.settings.blogFolders.find(f => f.path === currentParentPath) ?? null;
    }

    private refreshOrderPreview(el: HTMLElement, folder: BlogFolder | null, category: string, orderStr: string): void {
        if (!category || !folder) {
            el.setText('');
            return;
        }

        const entries = scanBlogEntries(this.app, folder.path, category, this.file)
            .sort((a, b) => a.order - b.order);

        if (entries.length === 0) {
            el.setText('(같은 카테고리의 순서 항목 없음)');
            return;
        }

        const orderNum = orderStr ? parseInt(orderStr, 10) : NaN;
        let windowEntries: BlogEntry[];

        if (!isNaN(orderNum)) {
            windowEntries = entries.filter(e => Math.abs(e.order - orderNum) <= 1).slice(0, 3);
            if (windowEntries.length === 0) {
                windowEntries = entries.slice(-3);
            }
        } else {
            windowEntries = entries.slice(-3);
        }

        el.setText(windowEntries.map(e => `${e.order}. ${e.unique}`).join('\n'));
    }

    private nextOrderFor(folder: BlogFolder, category: string): number {
        if (!folder.path || !category) return 1;

        const entries = scanBlogEntries(this.app, folder.path, category, this.file);
        if (entries.length === 0) return 1;

        return Math.max(...entries.map(e => e.order)) + 1;
    }

    private async applyOrderedRename(folder: BlogFolder, category: string, newOrder: number, unique: string): Promise<boolean> {
        const entries = scanBlogEntries(this.app, folder.path, category, this.file);

        const parsed = splitFilename(this.file.basename);
        const currentParentPath = this.file.parent?.path ?? '';
        const oldOrder = parsed.category === category && parsed.order && currentParentPath === folder.path
            ? parseInt(parsed.order, 10)
            : null;

        const maxAllowed = entries.length + 1;
        if (newOrder > maxAllowed) {
            new Notice(`순서는 1 ~ ${maxAllowed} 사이여야 합니다.`);
            return false;
        }

        if (oldOrder === newOrder) {
            const finalPath = this.buildPath(folder.path, category, newOrder, unique);
            if (finalPath !== this.file.path && this.app.vault.getAbstractFileByPath(finalPath)) {
                new Notice('같은 이름의 파일이 이미 존재합니다.');
                return false;
            }
            if (finalPath !== this.file.path) {
                await this.app.fileManager.renameFile(this.file, finalPath);
            }
            return true;
        }

        let shifted: { file: TFile; from: number; to: number; unique: string }[] = [];

        if (oldOrder === null) {
            shifted = entries
                .filter(e => e.order >= newOrder)
                .map(e => ({ file: e.file, from: e.order, to: e.order + 1, unique: e.unique }));
        } else if (newOrder < oldOrder) {
            shifted = entries
                .filter(e => e.order >= newOrder && e.order < oldOrder)
                .map(e => ({ file: e.file, from: e.order, to: e.order + 1, unique: e.unique }));
        } else {
            shifted = entries
                .filter(e => e.order > oldOrder && e.order <= newOrder)
                .map(e => ({ file: e.file, from: e.order, to: e.order - 1, unique: e.unique }));
        }

        const isPushingUp = shifted.length > 0 && shifted[0]!.to > shifted[0]!.from;
        shifted.sort((a, b) => isPushingUp ? b.from - a.from : a.from - b.from);

        for (const s of shifted) {
            const newPath = this.buildPath(folder.path, category, s.to, s.unique);
            await this.app.fileManager.renameFile(s.file, newPath);
        }

        const finalPath = this.buildPath(folder.path, category, newOrder, unique);
        await this.app.fileManager.renameFile(this.file, finalPath);
        return true;
    }

    private buildPath(blogFolder: string, category: string, order: number, unique: string): string {
        const filename = `${category}-${order}-${unique}.md`;
        return `${blogFolder}/${filename}`;
    }

    onClose() {
        this.contentEl.empty();
    }
}
