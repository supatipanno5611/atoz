import { isKorean } from './locales';

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
    daynightRecentCount: number;
    daynightDashboardDays: number;
    daynightDashboardThreshold: number;
    budgetFolder: string;
    budgetCurrencyPrefix: string;
    budgetCurrencySuffix: string;
    budgetExpenseCategories: string[];
    budgetIncomeCategories: string[];
    budgetFixedExpenses: BudgetFixedExpense[];
    budgetCarryOver: BudgetCarryOverMode;
    mealFolder: string;
    mealDayStartHour: number;
    mealPalette: MealColor[];
    mealLegend: MealLegendItem[];
    mealLastPick: MealPick | null;
    timelineFolder: string;
    timelineDayStartHour: number;
    // 카테고리 이름별 색. 정해지지 않은 카테고리는 회색으로 그린다.
    timelineColors: Record<string, MealColor>;
    isSupportCollapsed: boolean;
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

export type BudgetCarryOverMode = 'ask' | 'always' | 'never';

/** 식사 표시 색. 슬롯 하나에 라이트·다크 테마 색을 따로 둔다. */
export interface MealColor {
    light: string;
    dark: string;
}

/** 식사 표시. color는 팔레트 슬롯 이름(c-1 …)이다. */
export interface MealPick {
    icon: string;
    color: string;
}

export interface MealLegendItem extends MealPick {
    label: string;
}

export interface BudgetFixedExpense {
    title: string;
    category: string;
    // 금액이 매달 다른 항목(전기·가스 등)은 null로 두고 입력할 때 받는다.
    amount: number | null;
    // 예정일. 1~31.
    day: number;
}

export type WritingTargetPreset =
    | { kind: 'range'; target: number; tolerance: number }
    | { kind: 'between'; min: number; max: number }
    | { kind: 'min'; value: number }
    | { kind: 'max'; value: number };

export function isValidWritingTarget(preset: WritingTargetPreset): boolean {
    if (preset.kind === 'range') {
        return Number.isInteger(preset.target) && Number.isInteger(preset.tolerance) &&
            preset.tolerance > 0 && preset.tolerance < preset.target;
    }
    if (preset.kind === 'between') {
        return Number.isInteger(preset.min) && Number.isInteger(preset.max) &&
            preset.min > 0 && preset.min < preset.max;
    }
    if (preset.kind === 'min' || preset.kind === 'max') {
        return Number.isInteger(preset.value) && preset.value > 0;
    }
    return false;
}

// 같은 종류이면서 기준 글자 수가 같으면 중복 후보로 본다. 범위는 최소와 최대가 모두 같아야 한다.
export function isSameWritingTargetKey(a: WritingTargetPreset, b: WritingTargetPreset): boolean {
    if (a.kind === 'range' && b.kind === 'range') return a.target === b.target;
    if (a.kind === 'between' && b.kind === 'between') return a.min === b.min && a.max === b.max;
    if ((a.kind === 'min' || a.kind === 'max') && (b.kind === 'min' || b.kind === 'max')) {
        return a.kind === b.kind && a.value === b.value;
    }
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
// 800~1000 / 800-1000 / 800 이상 1000 이하 / 800 min 1000 max
// 숫자만 입력하면 목표±오차·이상·이하를 모두 돌려주고, 끝에 저장(save)을 붙이면 save가 true다.
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
    } else if ((match = /^(\d+) ?(이상|이하|min|max) ?(\d+) ?(이상|이하|min|max)$/i.exec(normalized))) {
        // 각 숫자는 뒤에 붙은 단어로 최소·최대를 정하므로 순서가 바뀌어도 된다.
        const isMinWord = (word: string): boolean => /^(이상|min)$/i.test(word);
        const first = Number(match[1]);
        const second = Number(match[3]);
        if (isMinWord(match[2]!) && !isMinWord(match[4]!)) {
            presets = [{ kind: 'between', min: first, max: second }];
        } else if (!isMinWord(match[2]!) && isMinWord(match[4]!)) {
            presets = [{ kind: 'between', min: second, max: first }];
        }
    } else if ((match = /^(\d+) ?[~-] ?(\d+)$/.exec(normalized))) {
        const values = [Number(match[1]), Number(match[2])];
        presets = [{ kind: 'between', min: Math.min(...values), max: Math.max(...values) }];
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
    daynightRecentCount: 4,
    daynightDashboardDays: 30,
    daynightDashboardThreshold: 50,
    budgetFolder: '',
    budgetCurrencyPrefix: '',
    budgetCurrencySuffix: isKorean ? '원' : '',
    budgetExpenseCategories: isKorean
        ? ['식비', '카페·간식', '교통', '주거·공과금', '통신', '생필품', '의료', '문화·여가', '의류·미용', '경조사', '교육', '기타']
        : ['Food', 'Cafe & snacks', 'Transport', 'Housing & utilities', 'Phone & internet', 'Household', 'Medical', 'Leisure', 'Clothing & beauty', 'Gifts & events', 'Education', 'Other'],
    budgetIncomeCategories: isKorean
        ? ['급여', '부수입', '용돈', '이자·배당', '환급', '기타']
        : ['Salary', 'Side income', 'Allowance', 'Interest & dividends', 'Refunds', 'Other'],
    budgetFixedExpenses: [],
    budgetCarryOver: 'ask',
    mealFolder: '',
    mealDayStartHour: 5,
    // Color Hunt 인기 팔레트에서 고른 색. 라이트는 흰 배경, 다크는 어두운 배경에서 잘 보이는 색이다.
    mealPalette: [
        { light: '#ff0000', dark: '#ff9494' },
        { light: '#df7861', dark: '#dba39a' },
        { light: '#ad8b73', dark: '#ceab93' },
        { light: '#aa8b56', dark: '#e3caa5' },
        { light: '#8a8635', dark: '#eae7b1' },
        { light: '#5f8d4e', dark: '#a7ff83' },
        { light: '#508d4e', dark: '#c6ebc5' },
        { light: '#3d8361', dark: '#bcead5' },
        { light: '#43766c', dark: '#1fab89' },
        { light: '#0d7377', dark: '#71c9ce' },
        { light: '#6096b4', dark: '#6096b4' },
        { light: '#3f72af', dark: '#769fcd' },
        { light: '#535c91', dark: '#a6b1e1' },
        { light: '#9290c3', dark: '#9896f1' },
        { light: '#5c469c', dark: '#beadfa' },
        { light: '#bc6ff1', dark: '#cca8e9' },
        { light: '#a367b1', dark: '#e5beec' },
        { light: '#b0578d', dark: '#ffabe1' },
        { light: '#be5985', dark: '#e8a0bf' },
        { light: '#ff2e63', dark: '#e6a4b4' },
    ],
    mealLegend: [
        { icon: 'house', color: 'c-7', label: isKorean ? '집밥' : 'Home-cooked' },
        { icon: 'bike', color: 'c-2', label: isKorean ? '배달' : 'Delivery' },
        { icon: 'store', color: 'c-12', label: isKorean ? '외식' : 'Eating out' },
        { icon: 'cookie', color: 'c-19', label: isKorean ? '간식' : 'Snack' },
    ],
    mealLastPick: null,
    timelineFolder: '',
    timelineDayStartHour: 5,
    timelineColors: {},
    isSupportCollapsed: false,
    readingTimeCharacterBasis: 'without-spaces',
    readingCharactersPerMinute: 500,
    writingTargetPresets: [
        { kind: 'range', target: 1000, tolerance: 50 },
        { kind: 'range', target: 1500, tolerance: 75 },
        { kind: 'range', target: 2000, tolerance: 100 },
        { kind: 'range', target: 3000, tolerance: 150 },
    ],
};
