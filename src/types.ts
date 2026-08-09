export interface ClipboardEntry {
    id: string;
    text: string;
    pinned?: boolean;
}

export interface BlogFolder {
    path: string;
    categories: string[];
}

export interface ATOZSettings {
	quickSlots: (string | string[] | null)[];
	commandSlots: (string | null)[];
	commandSlotCount: number;
    isCursorCenterEnabled: boolean;
    isAllFoldersHidden: boolean;
    isMobileStickyRibbonEnabled: boolean;
    snippetTrigger: string;
    snippetLimit: number;
    snippets: string[];
    recentSnippets: Record<string, number>;
    symbolTrigger: string;
    symbolLimit: number;
    symbols: SymbolItem[];
    recentSymbols: Record<string, number>;
    workFilePath: string;
    clipboardHistory: ClipboardEntry[];
    clipboardHistoryLimit: number;
    clipboardPreviewLength: number;
    moveLineTargetFolder: string;
    blogFolders: BlogFolder[];
}

export type SnippetsItem =
    | { kind: 'snippet'; content: string }
    | { kind: 'add'; content: string };

export interface SymbolItem {
    id: string;
    symbol: string;
    closing?: string;
}

export const DEFAULT_SETTINGS: ATOZSettings = {
	quickSlots: [null, null, null, null],
	commandSlots: [],
	commandSlotCount: 4,
    isCursorCenterEnabled: false,
    isAllFoldersHidden: false,
    isMobileStickyRibbonEnabled: false,
    snippetTrigger: '@',
    snippetLimit: 5,
    snippets: [],
    recentSnippets: {},
    symbolTrigger: '~',
    symbolLimit: 5,
    symbols: [
        { id: '"', symbol: '"', closing: '"' },
        { id: "'", symbol: "'", closing: "'" },
        { id: '...', symbol: '…' },
        { id: '-', symbol: '—' },
        { id: ',', symbol: '‚' },
        { id: '>>', symbol: '《', closing: '》' },
        { id: 'end>', symbol: '》' },
        { id: '[[', symbol: '「', closing: '」' },
        { id: 'end]]', symbol: '」' },
        { id: '(', symbol: '（', closing: '）' },
        { id: 'end)', symbol: '）' },
    ],
    recentSymbols: {},
    workFilePath: 'work.md',
    clipboardHistory: [],
    clipboardHistoryLimit: 30,
    clipboardPreviewLength: 50,
    moveLineTargetFolder: '',
    blogFolders: [],
};
