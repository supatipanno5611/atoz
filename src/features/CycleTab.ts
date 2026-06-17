import type ATOZPlugin from '../main';
import { MarkdownView, WorkspaceLeaf } from 'obsidian';

export class CycleTabFeature {
    constructor(private plugin: ATOZPlugin) {}

    cycleAllTabs(markdownOnly = false) {
        const { workspace } = this.plugin.app;

        const leaves: WorkspaceLeaf[] = [];
        workspace.iterateRootLeaves((leaf) => {
            if (markdownOnly && !(leaf.view instanceof MarkdownView && leaf.view.file)) return;
            leaves.push(leaf);
        });

        if (leaves.length <= 1) return;

        const activeLeaf = workspace.getMostRecentLeaf();
        const currentIndex = activeLeaf ? leaves.indexOf(activeLeaf) : -1;
        const nextIndex = (currentIndex + 1) % leaves.length;
        const target = leaves[nextIndex];

        if (target) {
            workspace.setActiveLeaf(target, { focus: true });
            if (target.view instanceof MarkdownView) target.view.editor.focus();
        }
    }
}
