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
    daynightFolder: string;
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

export type WritingTargetPreset =
    | { kind: 'range'; target: number; tolerance: number }
    | { kind: 'min'; value: number }
    | { kind: 'max'; value: number };

export function isValidWritingTarget(preset: WritingTargetPreset): boolean {
    if (preset.kind === 'range') {
        return Number.isInteger(preset.target) && Number.isInteger(preset.tolerance) &&
            preset.tolerance > 0 && preset.tolerance < preset.target;
    }
    if (preset.kind === 'min' || preset.kind === 'max') {
        return Number.isInteger(preset.value) && preset.value > 0;
    }
    return false;
}

// 같은 종류이면서 기준 글자 수가 같으면 중복 후보로 본다.
export function isSameWritingTargetKey(a: WritingTargetPreset, b: WritingTargetPreset): boolean {
    if (a.kind === 'range' && b.kind === 'range') return a.target === b.target;
    if (a.kind !== 'range' && b.kind !== 'range') return a.kind === b.kind && a.value === b.value;
    return false;
}

export function isSameWritingTarget(a: WritingTargetPreset, b: WritingTargetPreset): boolean {
    if (a.kind === 'range' && b.kind === 'range') return a.target === b.target && a.tolerance === b.tolerance;
    return isSameWritingTargetKey(a, b);
}

export function defaultWritingTolerance(target: number): number {
    return Math.max(1, Math.round(target * 0.05));
}

// 2000 / 2000 100 / 2000±100 / 1500 이상 / 3000 이하 / 1500 min / 3000 max
// 숫자만 입력하면 범위·이상·이하를 모두 돌려주고, 끝에 저장(save)을 붙이면 save가 true다.
export function parseWritingTargetInput(query: string): { presets: WritingTargetPreset[]; save: boolean } {
    let normalized = query.trim().replace(/[,자]/g, '').replace(/\s+/g, ' ');
    const saveMatch = / ?(저장|save)$/i.exec(normalized);
    if (saveMatch) normalized = normalized.slice(0, saveMatch.index);

    let presets: WritingTargetPreset[] = [];
    let match: RegExpExecArray | null;
    if ((match = /^(\d+) ?(이상|min)$/i.exec(normalized))) {
        presets = [{ kind: 'min', value: Number(match[1]) }];
    } else if ((match = /^(\d+) ?(이하|max)$/i.exec(normalized))) {
        presets = [{ kind: 'max', value: Number(match[1]) }];
    } else if ((match = /^(\d+) ?[ ±] ?(\d+)$/.exec(normalized))) {
        presets = [{ kind: 'range', target: Number(match[1]), tolerance: Number(match[2]) }];
    } else if ((match = /^(\d+)$/.exec(normalized))) {
        const value = Number(match[1]);
        presets = [
            { kind: 'range', target: value, tolerance: defaultWritingTolerance(value) },
            { kind: 'min', value },
            { kind: 'max', value },
        ];
    }
    return { presets: presets.filter(isValidWritingTarget), save: saveMatch !== null };
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
    daynightFolder: '',
    readingTimeCharacterBasis: 'without-spaces',
    readingCharactersPerMinute: 500,
    writingTargetPresets: [
        { kind: 'range', target: 1000, tolerance: 50 },
        { kind: 'range', target: 1500, tolerance: 75 },
        { kind: 'range', target: 2000, tolerance: 100 },
        { kind: 'range', target: 3000, tolerance: 150 },
    ],
};
