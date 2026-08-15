import type ATOZPlugin from '../main';
import { WorkspaceLeaf } from 'obsidian';

export class SidebarTabCycleFeature {
    constructor(private plugin: ATOZPlugin) {}

    cycleTab(side: 'left' | 'right', direction: 1 | -1): void {
        const workspace = this.plugin.app.workspace;
        const split = side === 'left'
            ? this.plugin.app.workspace.leftSplit
            : this.plugin.app.workspace.rightSplit;

        const leaves: WorkspaceLeaf[] = [];
        workspace.iterateAllLeaves((leaf) => {
            if (leaf.getRoot() === split) leaves.push(leaf);
        });
        if (leaves.length === 0) return;

        const currentLeaf = workspace.getMostRecentLeaf(split);
        const currentIndex = currentLeaf ? leaves.indexOf(currentLeaf) : -1;
        const nextIndex = currentIndex === -1
            ? (direction === 1 ? 0 : leaves.length - 1)
            : (currentIndex + direction + leaves.length) % leaves.length;
        void workspace.revealLeaf(leaves[nextIndex]!);
    }
}
