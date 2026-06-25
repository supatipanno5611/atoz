import { Editor } from 'obsidian';
import type ATOZPlugin from '../main';

export class LinePrefixSymbolFeature {
    constructor(private plugin: ATOZPlugin) {}

    toggle(editor: Editor) {
        const symbol = this.plugin.settings.linePrefixSymbol;

        if (!symbol) return;

        const cursor = editor.getCursor();
        const lineNumber = cursor.line;
        const lineText = editor.getLine(lineNumber);

        if (lineText.startsWith(symbol)) {
            editor.replaceRange(
                '',
                { line: lineNumber, ch: 0 },
                { line: lineNumber, ch: symbol.length }
            );
        } else {
            editor.replaceRange(
                symbol,
                { line: lineNumber, ch: 0 }
            );
        }
    }
}
