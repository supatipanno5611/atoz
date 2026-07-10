import type ATOZPlugin from '../main';
import { Notice, Platform } from 'obsidian';

export class MobileFeature {
    private ribbonEl: HTMLElement | null = null;
    private originalParent: HTMLElement | null = null;
    private appContainer: HTMLElement | null = null;

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        if (Platform.isMobileApp) {
            if (window.screen.width < 800) {
                document.body.classList.add('notice-bottom');
            }

            this.ribbonEl = document.querySelector('.workspace-drawer-ribbon');
            this.originalParent = this.ribbonEl?.parentElement ?? null;
            this.appContainer = document.querySelector('.app-container');
            this.checkSidebarState();
        }
    }

    checkSidebarState(): void {
        if (!this.plugin.settings.isMobileStickyRibbonEnabled) return;
        if (!this.ribbonEl || !this.appContainer) return;

        document.body.classList.add('plugin-tablet-sticky-ribbon');

        const leftSplit = (this.plugin.app.workspace as any).leftSplit;
        if (leftSplit?.collapsed) {
            document.body.classList.add('is-left-sidebar-closed');
            if (this.ribbonEl.parentElement !== this.appContainer) {
                this.appContainer.appendChild(this.ribbonEl);
            }
        } else {
            document.body.classList.remove('is-left-sidebar-closed');
            if (this.originalParent && this.ribbonEl.parentElement !== this.originalParent) {
                this.originalParent.insertBefore(this.ribbonEl, this.originalParent.firstChild);
            }
        }
    }

    toggleMobileToolbarHidden(): void {
        const isHidden = document.body.classList.toggle('mobile-toolbar-off');
        new Notice(isHidden ? '모바일 툴바를 숨겼습니다.' : '모바일 툴바를 표시합니다.');
    }

    async toggleStickyRibbon(): Promise<void> {
        this.plugin.settings.isMobileStickyRibbonEnabled = !this.plugin.settings.isMobileStickyRibbonEnabled;
        await this.plugin.saveSettings();

        if (this.plugin.settings.isMobileStickyRibbonEnabled) {
            this.checkSidebarState();
            new Notice('사이드바 독립 리본을 사용합니다.');
        } else {
            this.restoreRibbon();
            new Notice('사이드바 독립 리본을 사용하지 않습니다.');
        }
    }

    private restoreRibbon(): void {
        document.body.classList.remove('plugin-tablet-sticky-ribbon', 'is-left-sidebar-closed');

        if (this.ribbonEl && this.originalParent) {
            this.originalParent.appendChild(this.ribbonEl);
        }
    }

    uninstall(): void {
        document.body.classList.remove('mobile-toolbar-off', 'notice-bottom');
        this.restoreRibbon();
    }
}
