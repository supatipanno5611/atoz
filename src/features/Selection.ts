import type ATOZPlugin from '../main';
import { Editor } from 'obsidian';

export class SelectionFeature {
    constructor(private plugin: ATOZPlugin) {}

    expandLeftEnd(editor: Editor) {
        const selections = editor.listSelections().map(sel => ({
            anchor: sel.anchor,
            head: {
                line: sel.head.line,
                ch: 0
            }
        }));
        editor.setSelections(selections);
    }

    expandRightEnd(editor: Editor) {
        const selections = editor.listSelections().map(sel => {
            const line = sel.head.line;
            const lineLength = editor.getLine(line)?.length ?? 0;
            return {
                anchor: sel.anchor,
                head: {
                    line,
                    ch: lineLength
                }
            };
        });
        editor.setSelections(selections);
    }
}
