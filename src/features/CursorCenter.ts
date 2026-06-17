import type ATOZPlugin from '../main';
import { Editor, MarkdownView } from 'obsidian';

export class CursorCenterFeature {
    constructor(private plugin: ATOZPlugin) {}

    async toggleCursorCenter() {
        // 상태 반전 및 저장
        this.plugin.settings.isCursorCenterEnabled = !this.plugin.settings.isCursorCenterEnabled;
        await this.plugin.saveSettings();

        // 활성화 시 즉시 중앙 정렬 실행
        if (this.plugin.settings.isCursorCenterEnabled) {
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (view) this.scrollToCursorCenter(view.editor);
        }
    }

    scrollToCursorCenter(editor: Editor) {
        const cursor = editor.getCursor();
        // true 인자는 수직 중앙(Center) 정렬을 의미합니다.
        editor.scrollIntoView({ from: cursor, to: cursor }, true);
    }
}
