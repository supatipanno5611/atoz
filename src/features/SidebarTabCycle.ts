import type ATOZPlugin from '../main';
import { WorkspaceSplit, WorkspaceLeaf } from 'obsidian';

interface WorkspaceSplitInternals {
    children: WorkspaceLeaf[];
}

interface WorkspaceLeafInternals {
    tabHeaderEl?: HTMLElement;
}

export class SidebarTabCycleFeature {
    constructor(private plugin: ATOZPlugin) {}

    cycleTab(side: 'left' | 'right', direction: 1 | -1): void {
        const split: WorkspaceSplit = side === 'left'
            ? this.plugin.app.workspace.leftSplit
            : this.plugin.app.workspace.rightSplit;

        const leaves = (split as WorkspaceSplit & WorkspaceSplitInternals).children;
        if (leaves.length === 0) return;

        const currentIndex = leaves.findIndex(
            (leaf) => (leaf as WorkspaceLeaf & WorkspaceLeafInternals).tabHeaderEl?.hasClass('is-active')
        );
        if (currentIndex === -1) return;

        const nextIndex = (currentIndex + direction + leaves.length) % leaves.length;
        void this.plugin.app.workspace.revealLeaf(leaves[nextIndex]!);
    }
}
