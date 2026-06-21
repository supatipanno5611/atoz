import type ATOZPlugin from '../main';
import { WorkspaceSplit, WorkspaceLeaf } from 'obsidian';

export class SidebarTabCycleFeature {
    constructor(private plugin: ATOZPlugin) {}

    cycleTab(side: 'left' | 'right', direction: 1 | -1): void {
        const split: WorkspaceSplit = side === 'left'
            ? this.plugin.app.workspace.leftSplit
            : this.plugin.app.workspace.rightSplit;

        const leaves = (split as any).children as WorkspaceLeaf[];
        if (leaves.length === 0) return;

        const currentIndex = leaves.findIndex(
            (leaf) => (leaf as any).tabHeaderEl?.hasClass('is-active')
        );
        if (currentIndex === -1) return;

        const nextIndex = (currentIndex + direction + leaves.length) % leaves.length;
        this.plugin.app.workspace.revealLeaf(leaves[nextIndex]!);
    }
}
