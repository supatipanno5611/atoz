import { Notice } from 'obsidian';
import type ATOZPlugin from '../main';

const HIDDEN_CLASS = 'atoz-folder-hidden';

export class FolderVisibility {
    private hiddenEls = new Set<HTMLElement>();
    private installed = false;

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        if (this.installed) return;

        this.installed = true;
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('layout-change', () => this.refresh()),
        );
        this.refresh();
    }

    uninstall(): void {
        this.clearHiddenElements();
        this.installed = false;
    }

    async toggleAllFoldersHidden(): Promise<void> {
        this.plugin.settings.isAllFoldersHidden = !this.plugin.settings.isAllFoldersHidden;
        this.refresh();
        await this.plugin.saveSettings();

        new Notice(this.plugin.settings.isAllFoldersHidden ? '모든 폴더가 숨겨졌습니다.' : '모든 폴더가 표시됩니다.');
    }

    refresh(): void {
        this.clearHiddenElements();

        if (!this.plugin.settings.isAllFoldersHidden) {
            return;
        }

        document.querySelectorAll<HTMLElement>('.nav-folder-title[data-path]').forEach((titleEl) => {
            this.hideElement(titleEl);

            const childrenEl = titleEl.nextElementSibling;
            if (childrenEl instanceof HTMLElement && childrenEl.hasClass('nav-folder-children')) {
                this.hideElement(childrenEl);
            }
        });
    }

    private hideElement(el: HTMLElement): void {
        el.addClass(HIDDEN_CLASS);
        this.hiddenEls.add(el);
    }

    private clearHiddenElements(): void {
        for (const el of this.hiddenEls) {
            el.removeClass(HIDDEN_CLASS);
        }
        this.hiddenEls.clear();
    }
}
