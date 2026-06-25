export interface ClipboardEntry {
    id: string;
    text: string;
    pinned?: boolean;
}

export interface ATOZSettings {
	linePrefixSymbol: string;
	quickSlots: (string | null)[];
    isCursorCenterEnabled: boolean;
    projectPath: string;
    isProjectFolderHidden: boolean;
    snippetTrigger: string;
    snippetLimit: number;
    snippets: string[];
    recentSnippets: Record<string, number>;
    symbolTrigger: string;
    symbolLimit: number;
    symbols: SymbolItem[];
    recentSymbols: Record<string, number>;
    workFilePath: string;
    laterFilePath: string;
    workTimestampFormat: string;
    clipboardHistory: ClipboardEntry[];
    clipboardHistoryLimit: number;
    clipboardPreviewLength: number;
    moveLineSuffix: string;
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
	linePrefixSymbol: '○ ',
	quickSlots: [null, null, null, null],
    isCursorCenterEnabled: false,
    projectPath: '',
    isProjectFolderHidden: false,
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
    laterFilePath: 'later.md',
    workTimestampFormat: 'MM/DD HH:mm:ss',
    clipboardHistory: [],
    clipboardHistoryLimit: 30,
    clipboardPreviewLength: 50,
    moveLineSuffix: '_later.md',
};
