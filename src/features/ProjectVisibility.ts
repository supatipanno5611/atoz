import { Notice } from 'obsidian';
import type ATOZPlugin from '../main';

const HIDDEN_CLASS = 'atoz-project-hidden';

export class ProjectVisibility {
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

    async toggleProjectFolderHidden(): Promise<void> {
        const nextValue = !this.plugin.settings.isProjectFolderHidden;

        if (nextValue && !this.plugin.settings.projectPath) {
            new Notice('프로젝트 폴더 경로가 설정되어 있지 않습니다. 설정에서 프로젝트 폴더 경로를 입력해주세요.');
            return;
        }

        this.plugin.settings.isProjectFolderHidden = nextValue;
        this.refresh();
        await this.plugin.saveSettings();

        new Notice(nextValue ? '프로젝트 폴더가 숨겨졌습니다.' : '프로젝트 폴더가 표시됩니다.');
    }

    refresh(): void {
        const { isProjectFolderHidden, projectPath } = this.plugin.settings;

        this.clearHiddenElements();

        if (!isProjectFolderHidden || !projectPath) {
            return;
        }

        const childPath = `${projectPath}/`;
        document.querySelectorAll<HTMLElement>('.nav-folder-title[data-path]').forEach((titleEl) => {
            const path = titleEl.dataset.path;
            if (path !== projectPath && !path?.startsWith(childPath)) return;

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
