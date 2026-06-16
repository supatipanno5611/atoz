export interface ClipboardEntry {
    id: string;
    text: string;
}

export interface ATOZSettings {
    CertainMdPath: string;
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
    symbolPairs: Record<string, string>;
    recentSymbols: Record<string, number>;
    workFilePath: string;
    laterFilePath: string;
    workTimestampFormat: string;
    clipboardHistory: ClipboardEntry[];
    clipboardHistoryLimit: number;
    clipboardPreviewLength: number;
}

export type SnippetsItem =
    | { kind: 'snippet'; content: string }
    | { kind: 'add'; content: string };

export interface SymbolItem {
    id: string;
    symbol: string;
    closing?: string;
}

export interface SwitcherItem {
    display: string;
    path: string;
}

export const DEFAULT_SETTINGS: ATOZSettings = {
    CertainMdPath: '',
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
    symbolPairs: {
        '“': '”',
        '‘': '’',
        '《': '》',
        '（': '）',
    },
    recentSymbols: {},
    workFilePath: 'work.md',
    laterFilePath: 'later.md',
    workTimestampFormat: 'MM/DD HH:mm:ss',
    clipboardHistory: [],
    clipboardHistoryLimit: 30,
    clipboardPreviewLength: 50,
};
