import type ATOZPlugin from '../main';
import { Notice, Platform } from 'obsidian';

export class MobileFeature {
    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        if (Platform.isMobileApp) {
            if (window.screen.width < 800) {
                document.body.classList.add('notice-bottom');
            }
        }
    }

    toggleMobileToolbarHidden(): void {
        const isHidden = document.body.classList.toggle('mobile-toolbar-off');
        new Notice(isHidden ? '모바일 툴바를 숨겼습니다.' : '모바일 툴바를 표시합니다.');
    }

    uninstall(): void {
        document.body.classList.remove('mobile-toolbar-off', 'notice-bottom');
    }
}
