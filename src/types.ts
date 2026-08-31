export interface ATOZSettings {
	quickSlots: (string | string[] | null)[];
	commandSlots: (string | null)[];
	commandSlotCount: number;
    isCursorCenterEnabled: boolean;
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
    moveLineTargetFolder: string;
    versionFolder: string;
    readingTimeCharacterBasis: 'with-spaces' | 'without-spaces';
    readingCharactersPerMinute: number;
    writingTargetPresets: WritingTargetPreset[];
}

export type SnippetsItem =
    | { kind: 'snippet'; content: string }
    | { kind: 'add'; content: string };

export interface SymbolItem {
    id: string;
    symbol: string;
    closing?: string;
}

export interface WritingTargetPreset {
    target: number;
    tolerance: number;
}

export const DEFAULT_SETTINGS: ATOZSettings = {
	quickSlots: [null, null, null, null],
	commandSlots: [],
	commandSlotCount: 4,
    isCursorCenterEnabled: false,
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
    moveLineTargetFolder: '',
    versionFolder: '',
    readingTimeCharacterBasis: 'without-spaces',
    readingCharactersPerMinute: 500,
    writingTargetPresets: [
        { target: 1000, tolerance: 50 },
        { target: 1500, tolerance: 75 },
        { target: 2000, tolerance: 100 },
        { target: 3000, tolerance: 150 },
    ],
};
