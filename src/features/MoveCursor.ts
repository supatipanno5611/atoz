import type ATOZPlugin from '../main';
import { Editor, EditorPosition } from 'obsidian';

export class MoveCursorFeature {
    constructor(private plugin: ATOZPlugin) {}

    moveCursorToEnd(editor: Editor) {
        editor.focus();
        const line = editor.lineCount() - 1;
        const pos: EditorPosition = { line, ch: editor.getLine(line).length };
        editor.setCursor(pos);
        editor.scrollIntoView({ from: pos, to: pos }, true);
    }

    moveCursorToStart(editor: Editor) {
        editor.focus();
        const file = this.plugin.app.workspace.getActiveFile();
        const fmEnd = file
            ? this.plugin.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.line
            : undefined;
        const startLine = fmEnd !== undefined ? fmEnd + 1 : 0;
        const pos: EditorPosition = { line: startLine, ch: 0 };
        editor.setCursor(pos);
        editor.scrollIntoView({ from: pos, to: pos }, true);
    }

    goToLineStart(editor: Editor) {
    		const cursor = editor.getCursor();
    		editor.setCursor({ line: cursor.line, ch: 0 });
  	}

  	goToLineEnd(editor: Editor) {
  			const cursor = editor.getCursor();
  			editor.setCursor({ line: cursor.line, ch: editor.getLine(cursor.line).length });
  	}
}
