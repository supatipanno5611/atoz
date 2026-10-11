import {
    AbstractInputSuggest,
    App,
    ItemView,
    Menu,
    Modal,
    Notice,
    Setting,
    TAbstractFile,
    TFile,
    TFolder,
    ViewStateResult,
    WorkspaceLeaf,
    normalizePath,
    setIcon,
} from 'obsidian';
import type ATOZPlugin from '../main';
import type { BudgetFixedExpense } from '../types';
import { t } from '../locales';
import { isRecord } from '../utils';

const VIEW_TYPE_BUDGET = 'atoz-budget-view';
const DEFAULT_FOLDER = 'budget';

type LedgerKind = 'income' | 'expense';

const KIND_INCOME: LedgerKind = 'income';
const KIND_EXPENSE: LedgerKind = 'expense';

// 파일 형식(열 이름·프론트매터 키)은 표시 언어와 무관하게 고정한다.
const COL_DATE = 'Date';
const COL_TITLE = 'Item';
const COL_CATEGORY = 'Category';
const COL_AMOUNT = 'Amount';
const COL_MEMO = 'Memo';

const DEFAULT_HEADERS = [COL_DATE, COL_TITLE, COL_CATEGORY, COL_AMOUNT, COL_MEMO];

const FM_KIND = 'type';
const FM_MONTH = 'month';
// 예산은 카테고리마다 'budget-이름' 속성 하나로 쓴다. 속성 화면은 중첩된 값을
// 다루지 못해서, 예전의 'budget:' 맵은 읽기만 하고 다시 쓸 때 새 형식으로 바꾼다.
const FM_BUDGET = 'budget';
const BUDGET_PREFIX = 'budget-';
// 카테고리가 아니라 한 달 전체 예산을 뜻하는 이름.
const BUDGET_TOTAL = 'total';

function kindLabel(kind: LedgerKind): string {
    return t(kind === KIND_INCOME ? 'budget.income' : 'budget.expense');
}

function recordTitle(kind: LedgerKind): string {
    return t(kind === KIND_INCOME ? 'budget.recordIncome' : 'budget.recordExpense');
}

/* ------------------------------------------------------------------ *
 * 유틸 — 숫자 / 날짜 / 문자열
 * ------------------------------------------------------------------ */

/** 12,000 / 12000원 / ₩12,000 / -38,000 을 모두 받아들인다. */
export function parseAmount(raw: string): number | null {
    const cleaned = raw
        .replace(/[,\s]/g, '')
        .replace(/[₩원]/g, '')
        .trim();
    if (cleaned.length === 0) return null;
    if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    if (!isFinite(value)) return null;
    return value;
}

/** 소수 금액은 둘째 자리까지 보존한다. 정수면 소수부를 붙이지 않는다. */
export function formatAmount(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    const negative = rounded < 0;
    const [digits = '0', fraction = '00'] = Math.abs(rounded).toFixed(2).split('.');
    let out = '';
    let count = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        out = digits.charAt(i) + out;
        count++;
        if (count % 3 === 0 && i > 0) out = ',' + out;
    }
    if (fraction !== '00') out += '.' + fraction;
    return (negative ? '-' : '') + out;
}

// 설정의 통화 표기. 설정이 바뀔 때마다 BudgetFeature가 다시 채운다.
let currencyPrefix = '';
let currencySuffix = '';

function formatWon(value: number): string {
    return currencyPrefix + formatAmount(value) + currencySuffix;
}

function pad2(value: number): string {
    return value < 10 ? '0' + value : String(value);
}

function toISODate(date: Date): string {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function todayISO(): string {
    return toISODate(new Date());
}

function currentMonth(): string {
    const now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1);
}

/** YYYY-MM-DD 형식이면서 실제로 존재하는 날짜인지. */
function isValidDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (month < 1 || month > 12) return false;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year
        && date.getMonth() === month - 1
        && date.getDate() === day;
}

function isValidMonth(value: string): boolean {
    if (!/^\d{4}-\d{2}$/.test(value)) return false;
    const month = Number(value.slice(5, 7));
    return month >= 1 && month <= 12;
}

function monthOfDate(value: string): string {
    return value.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
    const year = Number(month.slice(0, 4));
    const index = Number(month.slice(5, 7)) - 1 + delta;
    const nextYear = year + Math.floor(index / 12);
    const nextMonth = ((index % 12) + 12) % 12;
    return nextYear + '-' + pad2(nextMonth + 1);
}

function daysInMonth(month: string): number {
    const year = Number(month.slice(0, 4));
    const index = Number(month.slice(5, 7));
    return new Date(year, index, 0).getDate();
}

/** 소스에서 표를 눈으로 봐도 정렬돼 보이도록, 한글·한자를 2칸으로 센다. */
function displayWidth(text: string): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const wide = (code >= 0x1100 && code <= 0x115f)
            || (code >= 0x2e80 && code <= 0xa4cf)
            || (code >= 0xac00 && code <= 0xd7a3)
            || (code >= 0xf900 && code <= 0xfaff)
            || (code >= 0xfe30 && code <= 0xfe6f)
            || (code >= 0xff00 && code <= 0xff60)
            || (code >= 0xffe0 && code <= 0xffe6);
        width += wide ? 2 : 1;
    }
    return width;
}

function padRight(text: string, width: number): string {
    let out = text;
    let current = displayWidth(text);
    while (current < width) {
        out += ' ';
        current++;
    }
    return out;
}

function repeat(text: string, count: number): string {
    let out = '';
    for (let i = 0; i < count; i++) out += text;
    return out;
}

const BACKSLASH = String.fromCharCode(92);
const PIPE = '|';

function escapeCell(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        if (char === BACKSLASH || char === PIPE) out += BACKSLASH + char;
        else if (char === '\n' || char === '\r') out += ' ';
        else out += char;
    }
    return out;
}

function unescapeCell(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        if (char === BACKSLASH && i + 1 < text.length) {
            const next = text.charAt(i + 1);
            if (next === PIPE || next === BACKSLASH) {
                out += next;
                i++;
                continue;
            }
        }
        out += char;
    }
    return out;
}

function uniqueStrings(values: string[]): string[] {
    const seen: Record<string, boolean> = {};
    const out: string[] = [];
    for (const value of values) {
        const key = value.trim();
        if (key.length === 0) continue;
        if (seen[key]) continue;
        seen[key] = true;
        out.push(key);
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * 파싱 — 프론트매터
 * ------------------------------------------------------------------ */

interface LedgerFrontMatter {
    kind: LedgerKind | null;
    month: string | null;
    budgets: Record<string, number>;
    totalBudget: number | null;
    /** 프론트매터 블록이 차지하는 줄 수 (없으면 0). */
    lineCount: number;
}

function stripQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed.charAt(0);
        const last = trimmed.charAt(trimmed.length - 1);
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1);
        }
    }
    return trimmed;
}

/**
 * 메타데이터 캐시는 파일 변경 직후 잠깐 낡을 수 있어서, 우리가 쓰는 모양
 * (평평한 key: value + 한 단계 중첩된 예산 맵)만 직접 읽는다.
 */
function parseFrontMatter(lines: string[]): LedgerFrontMatter {
    const result: LedgerFrontMatter = { kind: null, month: null, budgets: {}, totalBudget: null, lineCount: 0 };
    if (lines.length === 0 || (lines[0] ?? '').trim() !== '---') return result;

    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if ((lines[i] ?? '').trim() === '---') {
            end = i;
            break;
        }
    }
    if (end === -1) return result;
    result.lineCount = end + 1;

    let inBudget = false;
    for (let i = 1; i < end; i++) {
        const line = lines[i] ?? '';
        if (line.trim().length === 0) continue;

        const indented = /^\s+\S/.test(line);
        if (inBudget && indented) {
            // 따옴표로 감싼 카테고리 이름에 콜론이 있을 수 있어 마지막 콜론에서 나눈다.
            const match = /^\s+(?:-\s*)?(.+)\s*:\s*(.*)$/.exec(line);
            if (match) {
                const key = stripQuotes(match[1] ?? '');
                const amount = parseAmount(stripQuotes(match[2] ?? ''));
                if (amount === null) continue;
                if (key === BUDGET_TOTAL) result.totalBudget = amount;
                else if (key.length > 0) result.budgets[key] = amount;
            }
            continue;
        }
        inBudget = false;

        // 콜론이 든 속성 이름은 따옴표로 감싸여 있으므로 따옴표 안은 통째로 이름으로 본다.
        const match = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+)\s*:\s*(.*)$/.exec(line);
        if (!match) continue;
        const key = stripQuotes(match[1] ?? '');
        const value = stripQuotes(match[2] ?? '');

        if (key.startsWith(BUDGET_PREFIX)) {
            const name = key.slice(BUDGET_PREFIX.length);
            const amount = parseAmount(value);
            if (amount === null) continue;
            if (name === BUDGET_TOTAL) result.totalBudget = amount;
            else if (name.length > 0) result.budgets[name] = amount;
            continue;
        }

        if (key === FM_KIND) {
            if (value === KIND_INCOME || value === KIND_EXPENSE) result.kind = value;
        } else if (key === FM_MONTH) {
            if (isValidMonth(value)) result.month = value;
        } else if (key === FM_BUDGET) {
            inBudget = true;
        }
    }

    return result;
}

/* ------------------------------------------------------------------ *
 * 파싱 — 표
 * ------------------------------------------------------------------ */

interface Entry {
    date: string;
    title: string;
    category: string;
    amount: number;
    memo: string;
    /** 우리가 모르는 열이 있어도 다시 쓸 때 잃지 않도록 보관한다. */
    extra: Record<string, string>;
    /** Ledger.rows 안에서의 위치. */
    rowIndex: number;
    /** 충돌 감지에 쓰는 원본 줄. */
    raw: string;
    /** 파일 안에서의 실제 줄 번호(0-based). */
    lineIndex: number;
}

interface LedgerRow {
    raw: string;
    lineIndex: number;
    entry: Entry | null;
    /** 파싱하지 못한 이유. entry가 있으면 null. */
    issue: string | null;
}

interface Ledger {
    path: string;
    kind: LedgerKind;
    month: string;
    budgets: Record<string, number>;
    /** 카테고리와 별개로 잡은 한 달 전체 예산. 없으면 null. */
    totalBudget: number | null;
    headers: string[];
    /** 헤더 줄의 파일 내 위치. 표가 없으면 -1. */
    tableStart: number;
    /** 표의 마지막 줄(데이터 행 포함) 위치. */
    tableEnd: number;
    rows: LedgerRow[];
    entries: Entry[];
    issues: LedgerRow[];
    /** 파일의 월과 다른 달에 속한 항목. */
    strayEntries: Entry[];
    lines: string[];
}

function isTableRow(line: string): boolean {
    return /^\s*\|/.test(line);
}

function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return false;
    return /^\|[\s:|-]+$/.test(trimmed) && trimmed.indexOf('-') !== -1;
}

/** 이스케이프된 파이프를 존중하며 셀을 쪼갠다. */
function splitRow(line: string): string[] {
    const trimmed = line.trim();
    const cells: string[] = [];
    let current = '';
    let started = false;

    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed.charAt(i);
        if (char === '\\' && i + 1 < trimmed.length) {
            current += char + trimmed.charAt(i + 1);
            i++;
            continue;
        }
        if (char === '|') {
            if (!started) {
                started = true;
                current = '';
                continue;
            }
            cells.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    if (current.trim().length > 0) cells.push(current);

    const out: string[] = [];
    for (const cell of cells) out.push(unescapeCell(cell.trim()));
    return out;
}

function cellAt(headers: string[], cells: string[], name: string): string | null {
    for (let i = 0; i < headers.length; i++) {
        if ((headers[i] ?? '') === name) return cells[i] ?? '';
    }
    return null;
}

/** 성공하면 Entry, 실패하면 사람이 읽을 수 있는 이유 문자열. */
function buildEntry(
    headers: string[],
    cells: string[],
    rowIndex: number,
    raw: string,
    lineIndex: number,
): Entry | string {
    const dateCell = cellAt(headers, cells, COL_DATE);
    const amountCell = cellAt(headers, cells, COL_AMOUNT);

    if (dateCell === null) return t('budget.issue.noDateColumn');
    if (amountCell === null) return t('budget.issue.noAmountColumn');
    if (!isValidDate(dateCell)) {
        return dateCell.length === 0
            ? t('budget.issue.emptyDate')
            : t('budget.issue.invalidDate', { value: dateCell });
    }

    const amount = parseAmount(amountCell);
    if (amount === null) {
        return amountCell.length === 0
            ? t('budget.issue.emptyAmount')
            : t('budget.issue.invalidAmount', { value: amountCell });
    }

    const extra: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
        const name = headers[i] ?? '';
        if (name === COL_DATE || name === COL_TITLE || name === COL_CATEGORY
            || name === COL_AMOUNT || name === COL_MEMO) continue;
        if (name.length === 0) continue;
        extra[name] = cells[i] ?? '';
    }

    return {
        date: dateCell,
        title: cellAt(headers, cells, COL_TITLE) ?? '',
        category: cellAt(headers, cells, COL_CATEGORY) ?? '',
        amount,
        memo: cellAt(headers, cells, COL_MEMO) ?? '',
        extra,
        rowIndex,
        raw,
        lineIndex,
    };
}

function parseLedger(path: string, content: string): Ledger | null {
    const lines = content.split('\n');
    const fm = parseFrontMatter(lines);
    if (fm.kind === null) return null;
    if (fm.month === null || !isValidMonth(fm.month)) return null;
    const month = fm.month;

    // 첫 번째 표를 데이터 표로 본다.
    let headerIndex = -1;
    for (let i = fm.lineCount; i < lines.length - 1; i++) {
        const line = lines[i] ?? '';
        const next = lines[i + 1] ?? '';
        if (isTableRow(line) && !isSeparatorRow(line) && isSeparatorRow(next)) {
            headerIndex = i;
            break;
        }
    }

    const headers = headerIndex === -1
        ? DEFAULT_HEADERS.slice()
        : splitRow(lines[headerIndex] ?? '');

    const rows: LedgerRow[] = [];
    const entries: Entry[] = [];
    const issues: LedgerRow[] = [];
    const strayEntries: Entry[] = [];

    let tableEnd = headerIndex === -1 ? -1 : headerIndex + 1;

    if (headerIndex !== -1) {
        for (let i = headerIndex + 2; i < lines.length; i++) {
            const line = lines[i] ?? '';
            if (!isTableRow(line)) break;
            tableEnd = i;

            const row: LedgerRow = { raw: line, lineIndex: i, entry: null, issue: null };
            const parsed = buildEntry(headers, splitRow(line), rows.length, line, i);
            if (typeof parsed === 'string') {
                row.issue = parsed;
                issues.push(row);
            } else {
                row.entry = parsed;
                entries.push(parsed);
                if (monthOfDate(parsed.date) !== month) strayEntries.push(parsed);
            }
            rows.push(row);
        }
    }

    return {
        path,
        kind: fm.kind,
        month,
        budgets: fm.budgets,
        totalBudget: fm.totalBudget,
        headers,
        tableStart: headerIndex,
        tableEnd,
        rows,
        entries,
        issues,
        strayEntries,
        lines,
    };
}

/* ------------------------------------------------------------------ *
 * 직렬화
 * ------------------------------------------------------------------ */

function entryCells(headers: string[], entry: Entry): string[] {
    const cells: string[] = [];
    for (const header of headers) {
        if (header === COL_DATE) cells.push(entry.date);
        else if (header === COL_TITLE) cells.push(escapeCell(entry.title));
        else if (header === COL_CATEGORY) cells.push(escapeCell(entry.category));
        else if (header === COL_AMOUNT) cells.push(formatAmount(entry.amount));
        else if (header === COL_MEMO) cells.push(escapeCell(entry.memo));
        else cells.push(escapeCell(entry.extra[header] ?? ''));
    }
    return cells;
}

/** 열 폭을 맞춰 표 전체를 다시 그린다. 파싱 못한 행은 원문 그대로 둔다. */
function renderTable(headers: string[], rows: LedgerRow[]): string[] {
    const widths: number[] = [];
    for (const header of headers) widths.push(Math.max(3, displayWidth(header)));

    const rendered: string[][] = [];
    for (const row of rows) {
        if (row.entry === null) {
            rendered.push([]);
            continue;
        }
        const cells = entryCells(headers, row.entry);
        rendered.push(cells);
        for (let i = 0; i < cells.length && i < widths.length; i++) {
            widths[i] = Math.max(widths[i] ?? 3, displayWidth(cells[i] ?? ''));
        }
    }

    const compose = (cells: string[]): string => {
        let line = '|';
        for (let i = 0; i < headers.length; i++) {
            line += ' ' + padRight(cells[i] ?? '', widths[i] ?? 3) + ' |';
        }
        return line;
    };

    const out: string[] = [];
    out.push(compose(headers));

    let separator = '|';
    for (let i = 0; i < headers.length; i++) {
        separator += ' ' + repeat('-', widths[i] ?? 3) + ' |';
    }
    out.push(separator);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        if (row.entry === null) out.push(row.raw);
        else out.push(compose(rendered[i] ?? []));
    }

    return out;
}

/** 표 영역만 갈아끼우고 나머지 줄은 손대지 않는다. */
function serializeLedger(ledger: Ledger, rows: LedgerRow[]): string {
    const table = renderTable(ledger.headers, rows);

    if (ledger.tableStart === -1) {
        const before = ledger.lines.slice();
        while (before.length > 0 && (before[before.length - 1] ?? '').trim().length === 0) {
            before.pop();
        }
        before.push('');
        return before.concat(table).join('\n');
    }

    const before = ledger.lines.slice(0, ledger.tableStart);
    const after = ledger.lines.slice(ledger.tableEnd + 1);
    return before.concat(table).concat(after).join('\n');
}

/* ------------------------------------------------------------------ *
 * 저장소 — 파일 찾기 / 만들기 / 고치기
 * ------------------------------------------------------------------ */

interface EntryDraft {
    date: string;
    title: string;
    category: string;
    amount: number;
    memo: string;
}

interface LedgerFileRef {
    file: TFile;
    kind: LedgerKind;
    month: string;
}

class LedgerStore {
    private plugin: ATOZPlugin;

    constructor(plugin: ATOZPlugin) {
        this.plugin = plugin;
    }

    private get app(): App {
        return this.plugin.app;
    }

    folderPath(): string {
        const raw = this.plugin.settings.budgetFolder.trim();
        return normalizePath(raw.length === 0 ? DEFAULT_FOLDER : raw);
    }

    fileName(kind: LedgerKind, month: string): string {
        return month + '_' + kind + '.md';
    }

    filePath(kind: LedgerKind, month: string): string {
        return normalizePath(this.folderPath() + '/' + this.fileName(kind, month));
    }

    /**
     * 폴더 안에서 가계부 파일을 훑는다. 파일명이 아니라 프론트매터로 판단하므로
     * 사용자가 이름을 바꿔도 따라간다.
     */
    scan(): LedgerFileRef[] {
        const folder = this.app.vault.getAbstractFileByPath(this.folderPath());
        if (!(folder instanceof TFolder)) return [];

        const out: LedgerFileRef[] = [];
        const walk = (dir: TFolder): void => {
            for (const child of dir.children) {
                if (child instanceof TFolder) {
                    walk(child);
                    continue;
                }
                if (!(child instanceof TFile)) continue;
                if (child.extension !== 'md') continue;

                const fm: Record<string, unknown> | undefined =
                    this.app.metadataCache.getFileCache(child)?.frontmatter;
                if (!fm) continue;
                const kind = fm[FM_KIND];
                const month = fm[FM_MONTH];
                if (typeof kind !== 'string' || typeof month !== 'string') continue;
                if (kind !== KIND_INCOME && kind !== KIND_EXPENSE) continue;
                if (!isValidMonth(month)) continue;
                out.push({ file: child, kind, month });
            }
        };
        walk(folder);
        return out;
    }

    findFile(kind: LedgerKind, month: string): TFile | null {
        const direct = this.app.vault.getFileByPath(this.filePath(kind, month));
        if (direct) return direct;
        for (const ref of this.scan()) {
            if (ref.kind === kind && ref.month === month) return ref.file;
        }
        return null;
    }

    /** 알려진 모든 달을 최신순으로. */
    knownMonths(): string[] {
        const months = uniqueStrings(this.scan().map((ref) => ref.month));
        months.sort();
        months.reverse();
        return months;
    }

    async load(kind: LedgerKind, month: string): Promise<Ledger | null> {
        const file = this.findFile(kind, month);
        if (!file) return null;
        const content = await this.app.vault.cachedRead(file);
        const ledger = parseLedger(file.path, content);
        if (ledger) this.plugin.budget.rememberCategories(ledger);
        return ledger;
    }

    private template(kind: LedgerKind, month: string): string {
        const lines: string[] = [];
        lines.push('---');
        lines.push(FM_KIND + ': ' + kind);
        lines.push(FM_MONTH + ': ' + month);
        lines.push('---');
        lines.push('');
        lines.push('# ' + month + ' ' + kind);
        lines.push('');

        const rows: LedgerRow[] = [];
        for (const line of renderTable(DEFAULT_HEADERS, rows)) lines.push(line);
        lines.push('');

        return lines.join('\n');
    }

    /** 없으면 만든다. 지출부는 설정에 따라 직전 달 예산을 물어보고 이월한다. */
    async ensureFile(kind: LedgerKind, month: string, carryOver = true): Promise<TFile> {
        const existing = this.findFile(kind, month);
        if (existing) return existing;

        const folderPath = this.folderPath();
        if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            await this.app.vault.createFolder(folderPath);
        }

        let carried: Ledger | null = null;
        if (carryOver && kind === KIND_EXPENSE && this.plugin.settings.budgetCarryOver !== 'never') {
            const previous = await this.load(KIND_EXPENSE, shiftMonth(month, -1));
            if (previous && (previous.totalBudget !== null || Object.keys(previous.budgets).length > 0)) {
                const carry = this.plugin.settings.budgetCarryOver === 'always'
                    ? true
                    : await confirmModal(
                        this.app,
                        t('budget.carryOver.title'),
                        t('budget.carryOver.message', { from: shiftMonth(month, -1), to: month }),
                    );
                if (carry) carried = previous;
            }
        }

        const file = await this.app.vault.create(this.filePath(kind, month), this.template(kind, month));
        // 카테고리 이름에 YAML 특수문자가 있어도 깨지지 않도록 예산은 따로 쓴다.
        if (carried) await this.writeBudgets(file, carried.budgets, carried.totalBudget);
        return file;
    }

    /**
     * 파일을 다시 읽어 파싱한 뒤 행을 고친다. mutate가 false를 돌려주면 쓰지 않는다.
     * 반환값은 실패 사유(성공이면 null).
     */
    private async mutate(
        file: TFile,
        mutate: (ledger: Ledger, rows: LedgerRow[]) => string | null,
    ): Promise<string | null> {
        let failure: string | null = null;
        await this.app.vault.process(file, (data) => {
            const ledger = parseLedger(file.path, data);
            if (!ledger) {
                failure = t('budget.notice.notLedger');
                return data;
            }
            const rows = ledger.rows.slice();
            failure = mutate(ledger, rows);
            if (failure !== null) return data;
            return serializeLedger(ledger, rows);
        });
        return failure;
    }

    /** 대상 행을 다시 찾는다. 내용이 바뀌었으면 null. */
    private locate(rows: LedgerRow[], target: Entry): number {
        const atIndex = rows[target.rowIndex];
        if (atIndex && atIndex.raw === target.raw) return target.rowIndex;

        let found = -1;
        for (let i = 0; i < rows.length; i++) {
            if ((rows[i]?.raw ?? '') !== target.raw) continue;
            if (found !== -1) return -1;
            found = i;
        }
        return found;
    }

    /** 날짜가 더 뒤인 첫 행 앞에 넣는다. 같은 날짜끼리는 기존 순서를 지킨다. */
    private insertionIndex(rows: LedgerRow[], date: string): number {
        for (let i = 0; i < rows.length; i++) {
            const entry = rows[i]?.entry;
            if (!entry) continue;
            if (entry.date > date) return i;
        }
        return rows.length;
    }

    private draftToRow(draft: EntryDraft, extra: Record<string, string>): LedgerRow {
        const entry: Entry = {
            date: draft.date,
            title: draft.title,
            category: draft.category,
            amount: draft.amount,
            memo: draft.memo,
            extra,
            rowIndex: -1,
            raw: '',
            lineIndex: -1,
        };
        return { raw: '', lineIndex: -1, entry, issue: null };
    }

    async addEntries(kind: LedgerKind, month: string, drafts: EntryDraft[]): Promise<boolean> {
        if (drafts.length === 0) return true;
        const file = await this.ensureFile(kind, month);
        const failure = await this.mutate(file, (ledger, rows) => {
            for (const draft of drafts) {
                rows.splice(this.insertionIndex(rows, draft.date), 0, this.draftToRow(draft, {}));
            }
            return null;
        });
        if (failure !== null) {
            new Notice(failure);
            return false;
        }
        return true;
    }

    async addEntry(kind: LedgerKind, month: string, draft: EntryDraft): Promise<boolean> {
        return await this.addEntries(kind, month, [draft]);
    }

    async updateEntry(
        kind: LedgerKind,
        month: string,
        target: Entry,
        draft: EntryDraft,
    ): Promise<boolean> {
        const file = this.findFile(kind, month);
        if (!file) {
            new Notice(t('budget.notice.fileNotFound'));
            return false;
        }

        const failure = await this.mutate(file, (ledger, rows) => {
            const index = this.locate(rows, target);
            if (index === -1) return CONFLICT_MESSAGE;

            const row = this.draftToRow(draft, target.extra);
            if (draft.date === target.date) {
                rows.splice(index, 1, row);
            } else {
                rows.splice(index, 1);
                rows.splice(this.insertionIndex(rows, draft.date), 0, row);
            }
            return null;
        });

        if (failure !== null) {
            new Notice(failure);
            return false;
        }
        return true;
    }

    async deleteEntry(kind: LedgerKind, month: string, target: Entry): Promise<boolean> {
        const file = this.findFile(kind, month);
        if (!file) {
            new Notice(t('budget.notice.fileNotFound'));
            return false;
        }

        const failure = await this.mutate(file, (ledger, rows) => {
            const index = this.locate(rows, target);
            if (index === -1) return CONFLICT_MESSAGE;
            rows.splice(index, 1);
            return null;
        });

        if (failure !== null) {
            new Notice(failure);
            return false;
        }
        return true;
    }

    /**
     * 해당 종류의 모든 파일에서 카테고리 이름을 바꾼다. 이미 있는 이름으로 바꾸면
     * 두 카테고리가 합쳐지고 예산도 더해진다. 바꾼 내역 수를 돌려준다.
     */
    async renameCategory(kind: LedgerKind, from: string, to: string): Promise<number> {
        let count = 0;
        for (const ref of this.scan()) {
            if (ref.kind !== kind) continue;
            const ledger = parseLedger(ref.file.path, await this.app.vault.cachedRead(ref.file));
            if (!ledger) continue;

            // 바꿀 것이 없는 파일은 다시 쓰지 않는다.
            if (ledger.entries.some((entry) => entry.category.trim() === from)) {
                await this.mutate(ref.file, (current, rows) => {
                    for (let i = 0; i < rows.length; i++) {
                        const entry = rows[i]?.entry;
                        if (!entry || entry.category.trim() !== from) continue;
                        rows[i] = this.draftToRow({ ...entry, category: to }, entry.extra);
                        count++;
                    }
                    return null;
                });
            }

            const moved = ledger.budgets[from];
            if (typeof moved === 'number') {
                const budgets = { ...ledger.budgets };
                delete budgets[from];
                budgets[to] = (budgets[to] ?? 0) + moved;
                await this.writeBudgets(ref.file, budgets, ledger.totalBudget);
            }
        }
        return count;
    }

    /** 예산은 해당 월 지출부의 프론트매터에 'budget-이름' 속성으로 산다. */
    async setBudgets(month: string, budgets: Record<string, number>, total: number | null): Promise<void> {
        // 곧바로 새 예산을 쓰므로 직전 달 예산을 이월할지 묻지 않는다.
        const file = await this.ensureFile(KIND_EXPENSE, month, false);
        await this.writeBudgets(file, budgets, total);
    }

    private async writeBudgets(file: TFile, budgets: Record<string, number>, total: number | null): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (raw) => {
            const fm = raw as Record<string, unknown>;
            // 예전 맵과 지난 예산 속성을 모두 지우고 새로 쓴다.
            delete fm[FM_BUDGET];
            for (const key of Object.keys(fm)) {
                if (key.startsWith(BUDGET_PREFIX)) delete fm[key];
            }
            if (total !== null) fm[BUDGET_PREFIX + BUDGET_TOTAL] = total;
            for (const key of Object.keys(budgets)) fm[BUDGET_PREFIX + key] = budgets[key] ?? 0;
        });
    }
}

const CONFLICT_MESSAGE = t('budget.notice.conflict');

/* ------------------------------------------------------------------ *
 * 통계
 * ------------------------------------------------------------------ */

interface CategoryStat {
    category: string;
    amount: number;
    count: number;
    budget: number | null;
}

interface MonthStats {
    month: string;
    income: number;
    expense: number;
    balance: number;
    /** 수입이 0이면 null. */
    savingRate: number | null;
    incomeByCategory: CategoryStat[];
    expenseByCategory: CategoryStat[];
    /** 1일부터 말일까지의 일별 지출. */
    dailyExpense: number[];
}

function groupByCategory(entries: Entry[], budgets: Record<string, number>): CategoryStat[] {
    const map: Record<string, CategoryStat> = {};
    for (const entry of entries) {
        const key = entry.category.trim().length === 0 ? t('budget.uncategorized') : entry.category.trim();
        const stat = map[key] ?? { category: key, amount: 0, count: 0, budget: null };
        stat.amount += entry.amount;
        stat.count += 1;
        map[key] = stat;
    }

    // 지출이 하나도 없어도 예산이 잡힌 카테고리는 보여준다.
    for (const key of Object.keys(budgets)) {
        if (!map[key]) map[key] = { category: key, amount: 0, count: 0, budget: null };
    }

    const out: CategoryStat[] = [];
    for (const key of Object.keys(map)) {
        const stat = map[key];
        if (!stat) continue;
        const budget = budgets[key];
        stat.budget = typeof budget === 'number' ? budget : null;
        out.push(stat);
    }
    out.sort((a, b) => b.amount - a.amount);
    return out;
}

/** 전체 예산을 따로 잡았으면 그 값, 아니면 카테고리 예산의 합. */
function totalBudgetOf(ledger: Ledger | null): number {
    if (!ledger) return 0;
    if (ledger.totalBudget !== null) return ledger.totalBudget;
    let sum = 0;
    for (const key of Object.keys(ledger.budgets)) sum += ledger.budgets[key] ?? 0;
    return sum;
}

function sumAmounts(entries: Entry[]): number {
    let total = 0;
    for (const entry of entries) total += entry.amount;
    return total;
}

function computeStats(
    month: string,
    income: Ledger | null,
    expense: Ledger | null,
): MonthStats {
    const incomeEntries = income?.entries ?? [];
    const expenseEntries = expense?.entries ?? [];
    const budgets = expense?.budgets ?? {};

    const incomeTotal = sumAmounts(incomeEntries);
    const expenseTotal = sumAmounts(expenseEntries);
    const balance = incomeTotal - expenseTotal;

    const dayCount = daysInMonth(month);
    const dailyExpense: number[] = [];
    for (let i = 0; i < dayCount; i++) dailyExpense.push(0);
    for (const entry of expenseEntries) {
        if (monthOfDate(entry.date) !== month) continue;
        const day = Number(entry.date.slice(8, 10));
        if (day >= 1 && day <= dayCount) {
            dailyExpense[day - 1] = (dailyExpense[day - 1] ?? 0) + entry.amount;
        }
    }

    return {
        month,
        income: incomeTotal,
        expense: expenseTotal,
        balance,
        savingRate: incomeTotal > 0 ? balance / incomeTotal : null,
        incomeByCategory: groupByCategory(incomeEntries, {}),
        expenseByCategory: groupByCategory(expenseEntries, budgets),
        dailyExpense,
    };
}

/* ------------------------------------------------------------------ *
 * 고정지출
 * ------------------------------------------------------------------ */

interface MissingFixed {
    fixed: BudgetFixedExpense;
    date: string;
}

/** 같은 달 지출부에 같은 이름의 항목이 있으면 입력된 것으로 본다. */
function missingFixedExpenses(
    fixedExpenses: BudgetFixedExpense[],
    month: string,
    expense: Ledger | null,
): MissingFixed[] {
    const recorded: Record<string, boolean> = {};
    for (const entry of expense?.entries ?? []) {
        recorded[entry.title.trim()] = true;
    }

    const out: MissingFixed[] = [];
    const lastDay = daysInMonth(month);
    for (const fixed of fixedExpenses) {
        const title = fixed.title.trim();
        if (title.length === 0) continue;
        if (recorded[title]) continue;
        const day = Math.min(Math.max(1, fixed.day), lastDay);
        out.push({ fixed, date: month + '-' + pad2(day) });
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * UI — 공용 조각
 * ------------------------------------------------------------------ */

function confirmModal(app: App, title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const modal = new ConfirmModal(app, title, message, resolve);
        modal.open();
    });
}

class ConfirmModal extends Modal {
    private message: string;
    private resolve: (value: boolean) => void;
    private answered = false;

    constructor(app: App, title: string, message: string, resolve: (value: boolean) => void) {
        super(app);
        this.message = message;
        this.resolve = resolve;
        this.setTitle(title);
    }

    onOpen(): void {
        this.contentEl.createEl('p', { text: this.message });

        new Setting(this.contentEl)
            .addButton((button) => button
                .setButtonText(t('budget.no'))
                .onClick(() => this.finish(false)))
            .addButton((button) => button
                .setButtonText(t('budget.yes'))
                .setCta()
                .onClick(() => this.finish(true)));
    }

    private finish(value: boolean): void {
        this.answered = true;
        this.resolve(value);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.answered) this.resolve(false);
    }
}

export class CategorySuggest extends AbstractInputSuggest<string> {
    private inputEl: HTMLInputElement;
    private items: () => string[];

    constructor(app: App, inputEl: HTMLInputElement, items: () => string[]) {
        super(app, inputEl);
        this.inputEl = inputEl;
        this.items = items;
    }

    protected getSuggestions(query: string): string[] {
        const needle = query.trim().toLowerCase();
        const out: string[] = [];
        for (const item of this.items()) {
            if (needle.length === 0 || item.toLowerCase().indexOf(needle) !== -1) out.push(item);
        }
        return out;
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    selectSuggestion(value: string): void {
        this.inputEl.value = value;
        this.inputEl.trigger('input');
        this.close();
    }
}

/** 라벨 + 입력 한 줄. */
function fieldRow(parent: HTMLElement, label: string): HTMLElement {
    const row = parent.createDiv({ cls: 'atoz-budget-field' });
    row.createDiv({ cls: 'atoz-budget-field-label', text: label });
    return row.createDiv({ cls: 'atoz-budget-field-control' });
}

function textInput(parent: HTMLElement, value: string, placeholder: string): HTMLInputElement {
    const input = parent.createEl('input', { type: 'text' });
    input.value = value;
    input.placeholder = placeholder;
    return input;
}

function amountInput(parent: HTMLElement, value: string): HTMLInputElement {
    const input = textInput(parent, value, '0');
    input.inputMode = 'numeric';
    input.addClass('atoz-budget-amount-input');
    return input;
}

/* ------------------------------------------------------------------ *
 * UI — 빠른 입력 / 수정 모달
 * ------------------------------------------------------------------ */

interface EntryModalOptions {
    kind: LedgerKind;
    /** 수정 모드일 때의 원본. */
    entry?: Entry;
    /** 수정 모드일 때 원본이 들어 있는 파일의 달. */
    sourceMonth?: string;
    defaultDate?: string;
    onDone?: () => void;
}

class EntryModal extends Modal {
    private plugin: ATOZPlugin;
    private options: EntryModalOptions;
    private kind: LedgerKind;

    private amountEl: HTMLInputElement | null = null;
    private titleInputEl: HTMLInputElement | null = null;
    private categoryEl: HTMLInputElement | null = null;
    private dateEl: HTMLInputElement | null = null;
    private memoEl: HTMLInputElement | null = null;
    private kindButtons = new Map<LedgerKind, HTMLElement>();
    private isSaving = false;

    constructor(plugin: ATOZPlugin, options: EntryModalOptions) {
        super(plugin.app);
        this.plugin = plugin;
        this.options = options;
        this.kind = options.kind;
        this.setTitle(options.entry ? t('budget.editEntry') : recordTitle(this.kind));
    }

    private get editing(): boolean {
        return this.options.entry !== undefined;
    }

    onOpen(): void {
        const entry = this.options.entry;
        this.contentEl.addClass('atoz-budget-entry-modal');

        const toggle = this.contentEl.createDiv({ cls: 'atoz-budget-kind-toggle' });
        for (const kind of [KIND_EXPENSE, KIND_INCOME]) {
            const button = toggle.createEl('button', { text: kindLabel(kind), cls: 'atoz-budget-kind-button' });
            button.addEventListener('click', () => {
                this.kind = kind;
                if (!this.editing) this.setTitle(recordTitle(kind));
                this.syncKindButtons();
            });
            this.kindButtons.set(kind, button);
        }
        this.syncKindButtons();

        this.amountEl = amountInput(
            fieldRow(this.contentEl, t('budget.amount')),
            entry ? formatAmount(entry.amount) : '',
        );
        this.titleInputEl = textInput(fieldRow(this.contentEl, t('budget.item')), entry?.title ?? '', t('budget.itemPlaceholder'));
        this.categoryEl = textInput(fieldRow(this.contentEl, t('budget.category')), entry?.category ?? '', t('budget.categoryPlaceholder'));
        new CategorySuggest(this.app, this.categoryEl, () => this.plugin.budget.categoriesFor(this.kind));

        const dateHolder = fieldRow(this.contentEl, t('budget.date'));
        this.dateEl = dateHolder.createEl('input', { type: 'date' });
        this.dateEl.value = entry?.date ?? this.options.defaultDate ?? todayISO();

        this.memoEl = textInput(fieldRow(this.contentEl, t('budget.memo')), entry?.memo ?? '', t('budget.optional'));

        for (const input of [this.amountEl, this.titleInputEl, this.categoryEl, this.dateEl, this.memoEl]) {
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void this.submit();
            });
        }

        const footer = new Setting(this.contentEl).setClass('atoz-budget-modal-footer');
        if (this.editing) {
            footer.addExtraButton((button) => button
                .setIcon('trash-2')
                .setTooltip(t('budget.delete'))
                .onClick(() => void this.remove()));
        }
        footer.addButton((button) => button.setButtonText(t('budget.cancel')).onClick(() => this.close()));
        if (!this.editing) {
            footer.addButton((button) => button
                .setButtonText(t('budget.saveAndContinue'))
                .onClick(() => void this.submit(true)));
        }
        footer.addButton((button) => button
            .setButtonText(t('budget.save'))
            .setCta()
            .onClick(() => void this.submit()));

        window.setTimeout(() => this.amountEl?.focus(), 0);
    }

    private syncKindButtons(): void {
        this.kindButtons.forEach((button, kind) => {
            button.toggleClass('is-active', kind === this.kind);
        });
    }

    private draft(): EntryDraft | null {
        const amount = parseAmount(this.amountEl?.value ?? '');
        if (amount === null) {
            new Notice(t('budget.notice.amountRequired'));
            this.amountEl?.focus();
            return null;
        }

        const date = (this.dateEl?.value ?? '').trim();
        if (!isValidDate(date)) {
            new Notice(t('budget.notice.dateInvalid'));
            this.dateEl?.focus();
            return null;
        }

        const title = (this.titleInputEl?.value ?? '').trim();
        if (title.length === 0) {
            new Notice(t('budget.notice.itemRequired'));
            this.titleInputEl?.focus();
            return null;
        }

        return {
            date,
            title,
            category: (this.categoryEl?.value ?? '').trim(),
            amount,
            memo: (this.memoEl?.value ?? '').trim(),
        };
    }

    /** keepOpen이면 저장한 뒤 닫지 않고 날짜·종류만 남긴 채 다음 입력을 받는다. */
    private async submit(keepOpen = false): Promise<void> {
        // 저장이 끝나기 전에 다시 누르면 같은 내역이 두 번 들어간다.
        if (this.isSaving) return;
        const draft = this.draft();
        if (!draft) return;

        this.isSaving = true;
        try {
            await this.save(draft, keepOpen);
        } finally {
            this.isSaving = false;
        }
    }

    private async save(draft: EntryDraft, keepOpen: boolean): Promise<void> {
        const store = this.plugin.budget.store;
        const entry = this.options.entry;
        const targetMonth = monthOfDate(draft.date);

        let ok = false;
        if (!entry) {
            ok = await store.addEntry(this.kind, targetMonth, draft);
        } else {
            const sourceMonth = this.options.sourceMonth ?? monthOfDate(entry.date);
            const sourceKind = this.options.kind;
            if (sourceKind === this.kind && sourceMonth === targetMonth) {
                ok = await store.updateEntry(this.kind, sourceMonth, entry, draft);
            } else {
                // 달이나 종류를 바꿨으면 원본 파일에서 먼저 빼고 새 파일에 넣는다.
                // 원본이 그새 바뀌었으면 여기서 멈추므로 양쪽에 중복으로 남지 않는다.
                ok = await store.deleteEntry(sourceKind, sourceMonth, entry);
                if (ok) {
                    ok = await store.addEntry(this.kind, targetMonth, draft);
                    // 넣지 못했으면 뺀 내역을 원래 자리에 되돌린다.
                    if (!ok) await store.addEntry(sourceKind, sourceMonth, entry);
                }
            }
        }

        if (!ok) return;
        new Notice(t(entry ? 'budget.notice.updated' : 'budget.notice.recorded', {
            kind: kindLabel(this.kind),
            amount: formatWon(draft.amount),
        }));
        this.options.onDone?.();
        if (!keepOpen) {
            this.close();
            return;
        }
        for (const input of [this.amountEl, this.titleInputEl, this.categoryEl, this.memoEl]) {
            if (input) input.value = '';
        }
        this.amountEl?.focus();
    }

    private async remove(): Promise<void> {
        const entry = this.options.entry;
        if (!entry) return;
        const sourceMonth = this.options.sourceMonth ?? monthOfDate(entry.date);
        const confirmed = await confirmModal(
            this.app,
            t('budget.deleteEntry.title'),
            t('budget.deleteEntry.message', { title: entry.title, amount: formatWon(entry.amount) }),
        );
        if (!confirmed) return;
        const ok = await this.plugin.budget.store.deleteEntry(this.options.kind, sourceMonth, entry);
        if (!ok) return;
        this.options.onDone?.();
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* ------------------------------------------------------------------ *
 * UI — 예산 편집 모달
 * ------------------------------------------------------------------ */

class BudgetEditModal extends Modal {
    private plugin: ATOZPlugin;
    private month: string;
    private budgets: Record<string, number>;
    private total: number | null;
    private categories: string[];
    private onDone: () => void;
    private inputs: Record<string, HTMLInputElement> = {};
    private totalEl: HTMLInputElement | null = null;

    constructor(
        plugin: ATOZPlugin,
        month: string,
        budgets: Record<string, number>,
        total: number | null,
        usedCategories: string[],
        onDone: () => void,
    ) {
        super(plugin.app);
        this.plugin = plugin;
        this.month = month;
        this.budgets = budgets;
        this.total = total;
        this.onDone = onDone;
        this.categories = uniqueStrings(
            plugin.settings.budgetExpenseCategories
                .concat(usedCategories)
                .concat(Object.keys(budgets)),
        ).filter((category) => category !== BUDGET_TOTAL);
        this.setTitle(t('budget.limits.title', { month }));
    }

    onOpen(): void {
        this.contentEl.addClass('atoz-budget-edit-modal');
        this.contentEl.createEl('p', {
            cls: 'atoz-budget-hint',
            text: t('budget.limits.hint'),
        });

        const list = this.contentEl.createDiv({ cls: 'atoz-budget-edit-list' });
        this.totalEl = amountInput(
            fieldRow(list, t('budget.limits.total')),
            this.total === null ? '' : formatAmount(this.total),
        );
        for (const category of this.categories) this.addRow(list, category);

        // 목록에 없는 카테고리에도 예산을 잡을 수 있게 한다.
        const adder = fieldRow(this.contentEl, t('budget.category'));
        const nameEl = textInput(adder, '', t('budget.limits.addCategory'));
        const add = (): void => {
            const name = nameEl.value.trim();
            if (name.length === 0) return;
            if (name === BUDGET_TOTAL) {
                new Notice(t('budget.limits.reserved'));
                return;
            }
            if (!this.inputs[name]) this.addRow(list, name);
            nameEl.value = '';
            this.inputs[name]?.focus();
        };
        nameEl.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
        });
        adder.createEl('button', { text: t('budget.limits.add') }).addEventListener('click', add);

        new Setting(this.contentEl)
            .setClass('atoz-budget-modal-footer')
            .addButton((button) => button.setButtonText(t('budget.cancel')).onClick(() => this.close()))
            .addButton((button) => button
                .setButtonText(t('budget.save'))
                .setCta()
                .onClick(() => void this.submit()));
    }

    private addRow(list: HTMLElement, category: string): void {
        const existing = this.budgets[category];
        this.inputs[category] = amountInput(
            fieldRow(list, category),
            typeof existing === 'number' ? formatAmount(existing) : '',
        );
    }

    private async submit(): Promise<void> {
        const totalRaw = (this.totalEl?.value ?? '').trim();
        const total = totalRaw.length === 0 ? null : parseAmount(totalRaw);
        if (totalRaw.length > 0 && total === null) {
            new Notice(t('budget.limits.invalid', { category: t('budget.limits.total') }));
            return;
        }

        const next: Record<string, number> = {};
        for (const category of Object.keys(this.inputs)) {
            const raw = this.inputs[category]?.value ?? '';
            if (raw.trim().length === 0) continue;
            const amount = parseAmount(raw);
            if (amount === null) {
                new Notice(t('budget.limits.invalid', { category }));
                return;
            }
            next[category] = amount;
        }

        await this.plugin.budget.store.setBudgets(this.month, next, total);
        new Notice(t('budget.limits.saved', { month: this.month }));
        this.onDone();
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* ------------------------------------------------------------------ *
 * UI — 카테고리 이름 바꾸기 모달
 * ------------------------------------------------------------------ */

class RenameCategoryModal extends Modal {
    private inputEl: HTMLInputElement | null = null;
    private isSaving = false;

    constructor(
        private plugin: ATOZPlugin,
        private kind: LedgerKind,
        private from: string,
        private onDone: () => void,
    ) {
        super(plugin.app);
        this.setTitle(t('budget.renameCategory.title', { category: from }));
    }

    onOpen(): void {
        this.contentEl.createEl('p', { cls: 'atoz-budget-hint', text: t('budget.renameCategory.hint') });

        const input = textInput(fieldRow(this.contentEl, t('budget.category')), this.from, '');
        new CategorySuggest(this.app, input, () => this.plugin.budget.categoriesFor(this.kind));
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void this.submit();
        });
        this.inputEl = input;

        new Setting(this.contentEl)
            .setClass('atoz-budget-modal-footer')
            .addButton((button) => button.setButtonText(t('budget.cancel')).onClick(() => this.close()))
            .addButton((button) => button
                .setButtonText(t('budget.save'))
                .setCta()
                .onClick(() => void this.submit()));

        window.setTimeout(() => input.select(), 0);
    }

    private async submit(): Promise<void> {
        if (this.isSaving) return;
        const to = (this.inputEl?.value ?? '').trim();
        if (to.length === 0) {
            new Notice(t('budget.renameCategory.empty'));
            return;
        }
        if (to === this.from) {
            this.close();
            return;
        }

        this.isSaving = true;
        try {
            const count = await this.plugin.budget.renameCategory(this.kind, this.from, to);
            new Notice(t('budget.renameCategory.done', { count }));
        } finally {
            this.isSaving = false;
        }
        this.onDone();
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* ------------------------------------------------------------------ *
 * UI — 고정지출 입력 모달
 * ------------------------------------------------------------------ */

class FixedExpenseModal extends Modal {
    private plugin: ATOZPlugin;
    private month: string;
    private missing: MissingFixed[];
    private onDone: () => void;
    private checks: HTMLInputElement[] = [];
    private amounts: HTMLInputElement[] = [];
    private dates: HTMLInputElement[] = [];
    private isSaving = false;

    constructor(plugin: ATOZPlugin, month: string, missing: MissingFixed[], onDone: () => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.month = month;
        this.missing = missing;
        this.onDone = onDone;
        this.setTitle(t('budget.fixed.title', { month }));
    }

    onOpen(): void {
        this.contentEl.addClass('atoz-budget-fixed-modal');

        if (this.missing.length === 0) {
            this.contentEl.createEl('p', { text: t('budget.fixed.allRecorded') });
            new Setting(this.contentEl)
                .addButton((button) => button.setButtonText(t('budget.close')).setCta().onClick(() => this.close()));
            return;
        }

        this.contentEl.createEl('p', {
            cls: 'atoz-budget-hint',
            text: t('budget.fixed.hint'),
        });

        const list = this.contentEl.createDiv({ cls: 'atoz-budget-fixed-list' });
        for (const item of this.missing) {
            const row = list.createDiv({ cls: 'atoz-budget-fixed-row' });

            const check = row.createEl('input', { type: 'checkbox' });
            check.checked = item.fixed.amount !== null;
            this.checks.push(check);

            const info = row.createDiv({ cls: 'atoz-budget-fixed-info' });
            info.createDiv({ cls: 'atoz-budget-fixed-title', text: item.fixed.title });
            info.createDiv({ cls: 'atoz-budget-fixed-category', text: item.fixed.category });

            const date = row.createEl('input', { type: 'date' });
            date.value = item.date;
            this.dates.push(date);

            this.amounts.push(amountInput(
                row,
                item.fixed.amount === null ? '' : formatAmount(item.fixed.amount),
            ));
        }

        new Setting(this.contentEl)
            .setClass('atoz-budget-modal-footer')
            .addButton((button) => button.setButtonText(t('budget.cancel')).onClick(() => this.close()))
            .addButton((button) => button
                .setButtonText(t('budget.record'))
                .setCta()
                .onClick(() => void this.submit()));
    }

    private async submit(): Promise<void> {
        const drafts: EntryDraft[] = [];

        for (let i = 0; i < this.missing.length; i++) {
            if (!(this.checks[i]?.checked ?? false)) continue;
            const item = this.missing[i];
            if (!item) continue;

            const amount = parseAmount(this.amounts[i]?.value ?? '');
            if (amount === null) {
                new Notice(t('budget.fixed.amountRequired', { title: item.fixed.title }));
                return;
            }
            const date = (this.dates[i]?.value ?? '').trim();
            if (!isValidDate(date)) {
                new Notice(t('budget.fixed.dateInvalid', { title: item.fixed.title }));
                return;
            }

            drafts.push({
                date,
                title: item.fixed.title,
                category: item.fixed.category,
                amount,
                memo: '',
            });
        }

        if (drafts.length === 0) {
            new Notice(t('budget.fixed.selectRequired'));
            return;
        }

        if (this.isSaving) return;
        this.isSaving = true;
        let ok = false;
        try {
            ok = await this.plugin.budget.store.addEntries(KIND_EXPENSE, this.month, drafts);
        } finally {
            this.isSaving = false;
        }
        if (!ok) return;
        new Notice(t('budget.fixed.recorded', { count: drafts.length }));
        this.onDone();
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* ------------------------------------------------------------------ *
 * UI — 대시보드 뷰
 * ------------------------------------------------------------------ */

interface TableRowModel {
    kind: LedgerKind;
    entry: Entry;
}

type SortKey = 'date' | 'amount';

type DailyMode = 'bar' | 'cumulative';

/**
 * 차트 좌표계. 종횡비를 고정해 균일 확대(xMidYMid meet)로 그린다.
 * preserveAspectRatio="none"으로 늘리면 글자와 선 기울기가 같이 찌그러진다.
 */
const CHART_W = 640;
const CHART_H = 132;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 126;

function percentText(value: number): string {
    return (value >= 0 ? '+' : '') + (value * 100).toFixed(1) + '%';
}

class BudgetView extends ItemView {
    private plugin: ATOZPlugin;

    private month: string = currentMonth();
    private income: Ledger | null = null;
    private expense: Ledger | null = null;
    private previousIncome: Ledger | null = null;
    private previousExpense: Ledger | null = null;

    private categoryFilter: string | null = null;
    private kindFilter: LedgerKind | 'all' = 'all';
    private search = '';
    private sortKey: SortKey = 'date';
    private sortAsc = true;
    private dailyMode: DailyMode = 'bar';

    constructor(leaf: WorkspaceLeaf, plugin: ATOZPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_BUDGET;
    }

    getDisplayText(): string {
        return t('budget.viewName');
    }

    getIcon(): string {
        return 'wallet';
    }

    /** 보던 달과 보기 설정은 워크스페이스에 저장해 다시 열 때 되살린다. */
    getState(): Record<string, unknown> {
        return {
            month: this.month,
            kindFilter: this.kindFilter,
            dailyMode: this.dailyMode,
            sortKey: this.sortKey,
            sortAsc: this.sortAsc,
        };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        if (isRecord(state)) {
            if (typeof state.month === 'string' && isValidMonth(state.month)) this.month = state.month;
            const kind = state.kindFilter;
            if (kind === 'all' || kind === 'income' || kind === 'expense') this.kindFilter = kind;
            if (state.dailyMode === 'bar' || state.dailyMode === 'cumulative') this.dailyMode = state.dailyMode;
            if (state.sortKey === 'date' || state.sortKey === 'amount') this.sortKey = state.sortKey;
            if (typeof state.sortAsc === 'boolean') this.sortAsc = state.sortAsc;
        }
        await super.setState(state, result);
        await this.refresh();
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass('atoz-budget-view');
        await this.refresh();
    }

    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    setMonth(month: string): void {
        this.month = month;
        // 다른 달에는 그 카테고리 내역이 없을 수 있어 필터를 풀어 둔다.
        this.categoryFilter = null;
        this.app.workspace.requestSaveLayout();
        void this.refresh();
    }

    async refresh(): Promise<void> {
        const store = this.plugin.budget.store;
        const previousMonth = shiftMonth(this.month, -1);

        this.income = await store.load(KIND_INCOME, this.month);
        this.expense = await store.load(KIND_EXPENSE, this.month);
        this.previousIncome = await store.load(KIND_INCOME, previousMonth);
        this.previousExpense = await store.load(KIND_EXPENSE, previousMonth);

        this.render();
    }

    private render(): void {
        const root = this.contentEl;
        root.empty();

        const stats = computeStats(this.month, this.income, this.expense);
        const previous = computeStats(
            shiftMonth(this.month, -1),
            this.previousIncome,
            this.previousExpense,
        );

        this.renderHeader(root);
        this.renderWarnings(root);
        this.renderSummary(root, stats, previous);
        this.renderCategories(root, stats, previous);
        this.renderDaily(root, stats);
        this.renderEntries(root);
    }

    /* -------------------------------------------------- 헤더 */

    private renderHeader(root: HTMLElement): void {
        const header = root.createDiv({ cls: 'atoz-budget-header' });

        const nav = header.createDiv({ cls: 'atoz-budget-month-nav' });
        this.iconButton(nav, 'chevron-left', t('budget.previousMonth'), () => {
            this.setMonth(shiftMonth(this.month, -1));
        });
        const picker = nav.createEl('input', { cls: 'atoz-budget-month-label', type: 'month' });
        picker.value = this.month;
        picker.addEventListener('change', () => {
            if (isValidMonth(picker.value)) this.setMonth(picker.value);
        });
        this.iconButton(nav, 'chevron-right', t('budget.nextMonth'), () => {
            this.setMonth(shiftMonth(this.month, 1));
        });

        const actions = header.createDiv({ cls: 'atoz-budget-header-actions' });
        this.iconButton(actions, 'plus', t('budget.record'), () => {
            new EntryModal(this.plugin, {
                kind: KIND_EXPENSE,
                defaultDate: this.defaultDateForMonth(),
                onDone: () => void this.refresh(),
            }).open();
        });
        this.iconButton(actions, 'target', t('budget.editLimits'), () => {
            const used: string[] = [];
            for (const entry of this.expense?.entries ?? []) used.push(entry.category.trim());
            new BudgetEditModal(
                this.plugin,
                this.month,
                this.expense?.budgets ?? {},
                this.expense?.totalBudget ?? null,
                used,
                () => void this.refresh(),
            ).open();
        });
        this.iconButton(actions, 'refresh-cw', t('budget.refresh'), () => void this.refresh());
    }

    /** 이번 달을 보고 있으면 오늘, 아니면 그 달 1일. */
    private defaultDateForMonth(): string {
        return this.month === currentMonth() ? todayISO() : this.month + '-01';
    }

    private iconButton(
        parent: HTMLElement,
        icon: string,
        tooltip: string,
        onClick: () => void,
    ): HTMLElement {
        const button = parent.createEl('button', { cls: 'atoz-budget-icon-button' });
        setIcon(button, icon);
        button.setAttribute('aria-label', tooltip);
        button.title = tooltip;
        button.addEventListener('click', onClick);
        return button;
    }

    /* -------------------------------------------------- 경고 */

    private renderWarnings(root: HTMLElement): void {
        const warnings = root.createDiv({ cls: 'atoz-budget-warnings' });
        let count = 0;

        const issueCount = (this.income?.issues.length ?? 0) + (this.expense?.issues.length ?? 0);
        if (issueCount > 0) {
            count++;
            const box = this.warningBox(warnings, 'alert-triangle', t('budget.warning.issues', { count: issueCount }));
            const list = box.createDiv({ cls: 'atoz-budget-warning-list' });
            for (const source of [this.income, this.expense]) {
                if (!source) continue;
                for (const row of source.issues) {
                    const item = list.createDiv({ cls: 'atoz-budget-warning-item' });
                    item.createSpan({ cls: 'atoz-budget-warning-reason', text: row.issue ?? '' });
                    item.createSpan({ cls: 'atoz-budget-warning-raw', text: row.raw.trim() });
                    item.addEventListener('click', () => void this.openSource(source, row.lineIndex));
                }
            }
        }

        const strays = (this.income?.strayEntries ?? []).concat(this.expense?.strayEntries ?? []);
        if (strays.length > 0) {
            count++;
            const box = this.warningBox(
                warnings,
                'calendar-x',
                t('budget.warning.strays', { count: strays.length }),
            );
            const list = box.createDiv({ cls: 'atoz-budget-warning-list' });
            for (const source of [this.income, this.expense]) {
                if (!source) continue;
                for (const entry of source.strayEntries) {
                    const item = list.createDiv({ cls: 'atoz-budget-warning-item' });
                    item.createSpan({ cls: 'atoz-budget-warning-reason', text: entry.date });
                    item.createSpan({ cls: 'atoz-budget-warning-raw', text: entry.title });
                    item.addEventListener('click', () => void this.openSource(source, entry.lineIndex));
                }
            }
        }

        const missing = missingFixedExpenses(
            this.plugin.settings.budgetFixedExpenses,
            this.month,
            this.expense,
        );
        if (missing.length > 0) {
            count++;
            const box = this.warningBox(warnings, 'repeat', t('budget.warning.fixed', { count: missing.length }));
            const names: string[] = [];
            for (const item of missing) names.push(item.fixed.title);
            box.createDiv({ cls: 'atoz-budget-warning-list', text: names.join(', ') });
            const button = box.createEl('button', { cls: 'atoz-budget-inline-button', text: t('budget.warning.fixedAction') });
            button.addEventListener('click', () => {
                new FixedExpenseModal(this.plugin, this.month, missing, () => void this.refresh()).open();
            });
        }

        if (count === 0) warnings.remove();
    }

    private warningBox(parent: HTMLElement, icon: string, title: string): HTMLElement {
        const box = parent.createDiv({ cls: 'atoz-budget-warning' });
        const head = box.createDiv({ cls: 'atoz-budget-warning-head' });
        const iconEl = head.createSpan({ cls: 'atoz-budget-warning-icon' });
        setIcon(iconEl, icon);
        head.createSpan({ text: title });
        return box;
    }

    private async openSource(ledger: Ledger, lineIndex: number): Promise<void> {
        const file = this.app.vault.getFileByPath(ledger.path);
        if (!file) return;
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file, { eState: { line: lineIndex } });
    }

    /* -------------------------------------------------- 요약 */

    private renderSummary(root: HTMLElement, stats: MonthStats, previous: MonthStats): void {
        const grid = root.createDiv({ cls: 'atoz-budget-summary' });

        this.statCard(grid, t('budget.income'), formatWon(stats.income), 'income',
            this.deltaText(stats.income, previous.income));
        this.statCard(grid, t('budget.expense'), formatWon(stats.expense), 'expense',
            this.deltaText(stats.expense, previous.expense));
        this.statCard(grid, t('budget.balance'), formatWon(stats.balance),
            stats.balance < 0 ? 'expense' : 'income', null);
        this.statCard(
            grid,
            t('budget.savingRate'),
            stats.savingRate === null ? '—' : (stats.savingRate * 100).toFixed(1) + '%',
            stats.savingRate !== null && stats.savingRate < 0 ? 'expense' : 'income',
            null,
        );

        if (stats.income > 0) {
            const ratio = stats.expense / stats.income;
            this.ratioBar(root, t('budget.expenseRatio'), ratio, (ratio * 100).toFixed(1) + '%');
        }

        const budgetTotal = totalBudgetOf(this.expense);
        if (budgetTotal > 0) {
            const ratio = stats.expense / budgetTotal;
            this.ratioBar(
                root,
                t('budget.totalRatio'),
                ratio,
                formatAmount(stats.expense) + ' / ' + formatWon(budgetTotal) + ' · ' + (ratio * 100).toFixed(1) + '%',
            );
        }
    }

    private ratioBar(root: HTMLElement, label: string, ratio: number, value: string): void {
        const bar = root.createDiv({ cls: 'atoz-budget-ratio' });
        const head = bar.createDiv({ cls: 'atoz-budget-ratio-head' });
        head.createSpan({ text: label });
        head.createSpan({ cls: 'atoz-budget-ratio-value', text: value });
        const track = bar.createDiv({ cls: 'atoz-budget-bar-track' });
        const fill = track.createDiv({ cls: 'atoz-budget-bar-fill' });
        fill.toggleClass('is-over', ratio > 1);
        fill.style.width = Math.min(100, Math.max(0, ratio * 100)) + '%';
    }

    private statCard(
        parent: HTMLElement,
        label: string,
        value: string,
        tone: string,
        delta: string | null,
    ): void {
        const card = parent.createDiv({ cls: 'atoz-budget-stat atoz-budget-tone-' + tone });
        card.createDiv({ cls: 'atoz-budget-stat-label', text: label });
        card.createDiv({ cls: 'atoz-budget-stat-value', text: value });
        if (delta !== null) card.createDiv({ cls: 'atoz-budget-stat-delta', text: delta });
    }

    private deltaText(current: number, before: number): string | null {
        if (before === 0) return before === current ? null : t('budget.noPreviousMonth');
        const ratio = (current - before) / Math.abs(before);
        return t('budget.vsPreviousMonth', { percent: percentText(ratio) });
    }

    /* -------------------------------------------------- 카테고리 */

    private renderCategories(root: HTMLElement, stats: MonthStats, previous: MonthStats): void {
        this.categoryBlock(root, KIND_EXPENSE, t('budget.expenseByCategory'), stats.expenseByCategory, stats.expense, previous.expenseByCategory);
        if (stats.incomeByCategory.length > 0) {
            this.categoryBlock(root, KIND_INCOME, t('budget.incomeByCategory'), stats.incomeByCategory, stats.income, previous.incomeByCategory);
        }
    }

    private categoryBlock(
        root: HTMLElement,
        kind: LedgerKind,
        title: string,
        stats: CategoryStat[],
        total: number,
        previous: CategoryStat[],
    ): void {
        if (stats.length === 0) return;

        const section = root.createDiv({ cls: 'atoz-budget-section' });
        section.createDiv({ cls: 'atoz-budget-section-title', text: title });

        const previousMap: Record<string, number> = {};
        for (const stat of previous) previousMap[stat.category] = stat.amount;

        for (const stat of stats) {
            const row = section.createDiv({ cls: 'atoz-budget-category' });
            row.toggleClass('is-selected', this.categoryFilter === stat.category);
            row.addEventListener('click', () => {
                this.categoryFilter = this.categoryFilter === stat.category ? null : stat.category;
                this.render();
            });
            // 미분류는 실제 카테고리 이름이 아니라서 바꿀 수 없다.
            if (stat.category !== t('budget.uncategorized')) {
                row.addEventListener('contextmenu', (event) => {
                    event.preventDefault();
                    const menu = new Menu();
                    menu.addItem((item) => item
                        .setTitle(t('budget.renameCategory'))
                        .setIcon('pencil')
                        .onClick(() => {
                            new RenameCategoryModal(this.plugin, kind, stat.category, () => {
                                if (this.categoryFilter === stat.category) this.categoryFilter = null;
                                void this.refresh();
                            }).open();
                        }));
                    menu.showAtMouseEvent(event);
                });
            }

            const head = row.createDiv({ cls: 'atoz-budget-category-head' });
            head.createSpan({ cls: 'atoz-budget-category-name', text: stat.category });
            head.createSpan({ cls: 'atoz-budget-category-count', text: t('budget.count', { count: stat.count }) });

            const amounts = head.createSpan({ cls: 'atoz-budget-category-amounts' });
            if (stat.budget !== null) {
                amounts.createSpan({
                    cls: 'atoz-budget-category-amount',
                    text: formatAmount(stat.amount) + ' / ' + formatWon(stat.budget),
                });
            } else {
                amounts.createSpan({ cls: 'atoz-budget-category-amount', text: formatWon(stat.amount) });
            }

            const share = total === 0 ? 0 : stat.amount / total;
            const track = row.createDiv({ cls: 'atoz-budget-bar-track' });
            const fill = track.createDiv({ cls: 'atoz-budget-bar-fill' });

            if (stat.budget !== null && stat.budget > 0) {
                const used = stat.amount / stat.budget;
                fill.style.width = Math.min(100, Math.max(0, used * 100)) + '%';
                fill.toggleClass('is-over', used > 1);
            } else {
                fill.style.width = Math.min(100, Math.max(0, share * 100)) + '%';
            }

            const foot = row.createDiv({ cls: 'atoz-budget-category-foot' });
            if (stat.budget !== null && stat.budget > 0) {
                const used = stat.amount / stat.budget;
                foot.createSpan({ text: t('budget.limitUsed', { percent: (used * 100).toFixed(0) }) });
            } else {
                foot.createSpan({ text: t('budget.share', { percent: (share * 100).toFixed(1) }) });
            }

            const before = previousMap[stat.category];
            if (typeof before === 'number' && before !== 0) {
                foot.createSpan({
                    cls: 'atoz-budget-category-delta',
                    text: percentText((stat.amount - before) / Math.abs(before)),
                });
            }
        }
    }

    /* -------------------------------------------------- 일별 추이 */

    private renderDaily(root: HTMLElement, stats: MonthStats): void {
        let hasData = false;
        for (const value of stats.dailyExpense) {
            if (value !== 0) hasData = true;
        }
        if (!hasData) return;

        const section = root.createDiv({ cls: 'atoz-budget-section' });
        const head = section.createDiv({ cls: 'atoz-budget-section-title has-toggle' });
        head.createSpan({ text: t('budget.dailyExpense') });

        const toggle = head.createDiv({ cls: 'atoz-budget-segment' });
        const modes: { key: DailyMode; label: string }[] = [
            { key: 'bar', label: t('budget.bars') },
            { key: 'cumulative', label: t('budget.cumulative') },
        ];
        for (const mode of modes) {
            const button = toggle.createEl('button', {
                cls: 'atoz-budget-segment-button',
                text: mode.label,
            });
            button.toggleClass('is-active', this.dailyMode === mode.key);
            button.addEventListener('click', () => {
                this.dailyMode = mode.key;
                this.app.workspace.requestSaveLayout();
                this.render();
            });
        }

        if (this.dailyMode === 'cumulative') this.renderCumulative(section, stats);
        else this.renderBars(section, stats);
    }

    private chartFrame(parent: HTMLElement): SVGSVGElement {
        const svg = parent.createSvg('svg', { cls: 'atoz-budget-chart' });
        svg.setAttribute('viewBox', '0 0 ' + CHART_W + ' ' + CHART_H);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        return svg;
    }

    private chartBaseline(svg: SVGSVGElement, y: number): void {
        const axis = svg.createSvg('line', { cls: 'atoz-budget-chart-axis' });
        axis.setAttribute('x1', '0');
        axis.setAttribute('y1', String(y));
        axis.setAttribute('x2', String(CHART_W));
        axis.setAttribute('y2', String(y));
    }

    /**
     * 날짜 축은 SVG 밖 HTML로 둔다. viewBox 안의 글자는 차트와 같이 축소돼
     * 좁은 화면에서 4px까지 작아진다.
     */
    private chartDayAxis(parent: HTMLElement, dayCount: number): void {
        const axis = parent.createDiv({ cls: 'atoz-budget-chart-days' });
        const days = [1, 10, 20, dayCount];
        for (let i = 0; i < days.length; i++) {
            const day = days[i] ?? 1;
            const mark = axis.createSpan({ text: String(day) });
            // 양 끝은 잘리지 않도록 가장자리에 붙이고, 가운데만 날짜 위치에 맞춘다.
            if (i === 0) mark.addClass('is-first');
            else if (i === days.length - 1) mark.addClass('is-last');
            else {
                mark.addClass('is-centered');
                mark.style.left = (((day - 0.5) / dayCount) * 100) + '%';
            }
        }
    }

    /** 마크보다 넓은 히트 영역. 지출이 없는 날에도 툴팁이 뜬다. */
    private chartHitAreas(
        svg: SVGSVGElement,
        month: string,
        values: number[],
        slot: number,
    ): void {
        const monthNumber = Number(month.slice(5, 7));
        for (let i = 0; i < values.length; i++) {
            const hit = svg.createSvg('rect', { cls: 'atoz-budget-chart-hit' });
            hit.setAttribute('x', String(i * slot));
            hit.setAttribute('y', String(PLOT_TOP));
            hit.setAttribute('width', String(slot));
            hit.setAttribute('height', String(PLOT_BOTTOM - PLOT_TOP));
            hit.createSvg('title').setText(t('budget.dayTooltip', {
                month: monthNumber,
                day: i + 1,
                amount: formatWon(values[i] ?? 0),
            }));
        }
    }

    private renderBars(section: HTMLElement, stats: MonthStats): void {
        const values = stats.dailyExpense;

        // 환불로 그날 순액이 음수일 수 있다. 0선을 기준으로 아래로도 그린다.
        let top = 0;
        let bottom = 0;
        for (const value of values) {
            top = Math.max(top, value);
            bottom = Math.min(bottom, value);
        }
        const span = top - bottom;
        if (span <= 0) return;

        const scaleY = (value: number): number =>
            PLOT_TOP + ((top - value) / span) * (PLOT_BOTTOM - PLOT_TOP);
        const zeroY = scaleY(0);

        const svg = this.chartFrame(section);
        const slot = CHART_W / values.length;
        const barWidth = Math.max(1, slot - 2);

        for (let i = 0; i < values.length; i++) {
            const value = values[i] ?? 0;
            if (value === 0) continue;
            const valueY = scaleY(value);
            const rect = svg.createSvg('rect', { cls: 'atoz-budget-chart-bar' });
            if (value < 0) rect.classList.add('is-negative');
            rect.setAttribute('x', String(i * slot + (slot - barWidth) / 2));
            rect.setAttribute('y', String(Math.min(zeroY, valueY)));
            rect.setAttribute('width', String(barWidth));
            rect.setAttribute('height', String(Math.max(1, Math.abs(valueY - zeroY))));
        }

        this.chartBaseline(svg, zeroY);
        this.chartHitAreas(svg, stats.month, values, slot);
        this.chartDayAxis(section, values.length);

        section.createDiv({
            cls: 'atoz-budget-chart-caption',
            text: t('budget.barsCaption', { max: formatWon(top), average: formatWon(Math.round(stats.expense / values.length)) }),
        });
    }

    private renderCumulative(section: HTMLElement, stats: MonthStats): void {
        const values = stats.dailyExpense;
        const dayCount = values.length;

        // 이번 달이면 오늘까지만 긋는다. 남은 날까지 이어 그리면 평평한 구간이
        // "그 뒤로는 안 썼다"로 읽힌다.
        const elapsed = stats.month === currentMonth()
            ? Math.min(dayCount, new Date().getDate())
            : dayCount;
        if (elapsed <= 0) return;

        const cumulative: number[] = [];
        let running = 0;
        for (let i = 0; i < elapsed; i++) {
            running += values[i] ?? 0;
            cumulative.push(running);
        }

        const budgetTotal = totalBudgetOf(this.expense);

        let top = Math.max(0, budgetTotal);
        let bottom = 0;
        for (const value of cumulative) {
            top = Math.max(top, value);
            bottom = Math.min(bottom, value);
        }
        const span = top - bottom;
        if (span <= 0) return;

        const scaleY = (value: number): number =>
            PLOT_TOP + ((top - value) / span) * (PLOT_BOTTOM - PLOT_TOP);
        const slot = CHART_W / dayCount;
        const pointX = (index: number): number => (index + 0.5) * slot;

        const svg = this.chartFrame(section);
        this.chartBaseline(svg, scaleY(0));

        // 예산 페이스: 월말에 예산을 꼭 맞게 쓰는 속도. 기준선이라 점선으로 둔다.
        const paced = budgetTotal > 0;
        if (paced) {
            const pace: string[] = [];
            for (let i = 0; i < dayCount; i++) {
                pace.push(pointX(i) + ',' + scaleY((budgetTotal * (i + 1)) / dayCount));
            }
            const paceLine = svg.createSvg('polyline', { cls: 'atoz-budget-chart-pace' });
            paceLine.setAttribute('points', pace.join(' '));
        }

        const last = cumulative[cumulative.length - 1] ?? 0;
        const over = paced && last > (budgetTotal * elapsed) / dayCount;

        const points: string[] = [];
        for (let i = 0; i < cumulative.length; i++) {
            points.push(pointX(i) + ',' + scaleY(cumulative[i] ?? 0));
        }
        const line = svg.createSvg('polyline', { cls: 'atoz-budget-chart-line' });
        if (over) line.classList.add('is-over');
        line.setAttribute('points', points.join(' '));

        const lastX = pointX(cumulative.length - 1);
        const lastY = scaleY(last);
        const dot = svg.createSvg('circle', { cls: 'atoz-budget-chart-point' });
        if (over) dot.classList.add('is-over');
        dot.setAttribute('cx', String(lastX));
        dot.setAttribute('cy', String(lastY));
        dot.setAttribute('r', '4');

        // 끝점 오른쪽이 비어 있을 때만 값을 직접 붙인다(이번 달은 오늘에서 선이
        // 끊기므로 대개 자리가 있다). 월 끝까지 찬 달은 위아래 모두 선이 지나가서
        // 무엇에든 겹치므로, 같은 값을 바로 아래 캡션이 말하게 둔다.
        if (CHART_W - lastX > 72) {
            const label = svg.createSvg('text', { cls: 'atoz-budget-chart-value' });
            label.setAttribute('x', String(lastX + 8));
            label.setAttribute('y', String(lastY + 4));
            label.setAttribute('text-anchor', 'start');
            label.setText(formatAmount(last));
        }

        const tooltipValues: number[] = [];
        for (let i = 0; i < dayCount; i++) {
            tooltipValues.push(cumulative[Math.min(i, cumulative.length - 1)] ?? 0);
        }
        this.chartHitAreas(svg, stats.month, tooltipValues, slot);
        this.chartDayAxis(section, dayCount);

        if (paced) {
            const legend = section.createDiv({ cls: 'atoz-budget-chart-legend' });
            for (const item of [
                { cls: 'is-line', text: t('budget.cumulativeExpense') },
                { cls: 'is-pace', text: t('budget.limitPace') },
            ]) {
                const entry = legend.createDiv({ cls: 'atoz-budget-legend-item' });
                const mark = entry.createSpan({ cls: 'atoz-budget-legend-mark ' + item.cls });
                if (item.cls === 'is-line' && over) mark.addClass('is-over');
                entry.createSpan({ text: item.text });
            }
        }

        const parts: string[] = [t('budget.cumulativeTotal', { amount: formatWon(last) })];
        if (paced) parts.push(t('budget.limitTotal', { amount: formatWon(budgetTotal) }));
        if (elapsed < dayCount) {
            parts.push(t('budget.projection', { amount: formatWon(Math.round((last / elapsed) * dayCount)) }));
        }
        section.createDiv({ cls: 'atoz-budget-chart-caption', text: parts.join(' · ') });
    }

    /* -------------------------------------------------- 내역 */

    private collectRows(): TableRowModel[] {
        const rows: TableRowModel[] = [];
        for (const entry of this.income?.entries ?? []) rows.push({ kind: KIND_INCOME, entry });
        for (const entry of this.expense?.entries ?? []) rows.push({ kind: KIND_EXPENSE, entry });

        const needle = this.search.trim().toLowerCase();
        const filtered: TableRowModel[] = [];
        for (const row of rows) {
            if (this.kindFilter !== 'all' && row.kind !== this.kindFilter) continue;
            if (this.categoryFilter !== null) {
                const category = row.entry.category.trim().length === 0
                    ? t('budget.uncategorized')
                    : row.entry.category.trim();
                if (category !== this.categoryFilter) continue;
            }
            if (needle.length > 0) {
                const haystack = (row.entry.title + ' ' + row.entry.category + ' ' + row.entry.memo)
                    .toLowerCase();
                if (haystack.indexOf(needle) === -1) continue;
            }
            filtered.push(row);
        }

        const direction = this.sortAsc ? 1 : -1;
        filtered.sort((a, b) => {
            if (this.sortKey === 'amount') return (a.entry.amount - b.entry.amount) * direction;
            if (a.entry.date === b.entry.date) return 0;
            return (a.entry.date < b.entry.date ? -1 : 1) * direction;
        });

        return filtered;
    }

    private renderEntries(root: HTMLElement): void {
        const section = root.createDiv({ cls: 'atoz-budget-section' });
        const head = section.createDiv({ cls: 'atoz-budget-section-title' });
        head.setText(t('budget.entries'));

        const controls = section.createDiv({ cls: 'atoz-budget-controls' });

        const kinds: (LedgerKind | 'all')[] = ['all', KIND_EXPENSE, KIND_INCOME];
        const kindGroup = controls.createDiv({ cls: 'atoz-budget-segment' });
        for (const kind of kinds) {
            const button = kindGroup.createEl('button', {
                cls: 'atoz-budget-segment-button',
                text: kind === 'all' ? t('budget.all') : kindLabel(kind),
            });
            button.toggleClass('is-active', this.kindFilter === kind);
            button.addEventListener('click', () => {
                this.kindFilter = kind;
                this.app.workspace.requestSaveLayout();
                this.render();
            });
        }

        const searchEl = controls.createEl('input', { type: 'text', cls: 'atoz-budget-search' });
        searchEl.placeholder = t('budget.search');
        searchEl.value = this.search;
        searchEl.addEventListener('input', () => {
            this.search = searchEl.value;
            this.renderEntriesOnly();
        });

        if (this.categoryFilter !== null) {
            const chip = controls.createEl('button', {
                cls: 'atoz-budget-chip',
                text: this.categoryFilter + ' ✕',
            });
            chip.addEventListener('click', () => {
                this.categoryFilter = null;
                this.render();
            });
        }

        const holder = section.createDiv({ cls: 'atoz-budget-table-holder' });
        this.renderTableInto(holder);
    }

    /** 검색 입력의 포커스를 잃지 않도록 표만 다시 그린다. */
    private renderEntriesOnly(): void {
        const holder = this.contentEl.querySelector('.atoz-budget-table-holder');
        if (!(holder instanceof HTMLElement)) {
            this.render();
            return;
        }
        holder.empty();
        this.renderTableInto(holder);
    }

    private renderTableInto(holder: HTMLElement): void {
        const rows = this.collectRows();
        if (rows.length === 0) {
            holder.createDiv({ cls: 'atoz-budget-empty', text: t('budget.noEntries') });
            return;
        }

        const table = holder.createEl('table', { cls: 'atoz-budget-table' });
        const headRow = table.createEl('thead').createEl('tr');

        const dateHead = headRow.createEl('th', { text: t('budget.date') });
        dateHead.addClass('is-sortable');
        dateHead.addEventListener('click', () => this.toggleSort('date'));

        headRow.createEl('th', { text: t('budget.item') });
        headRow.createEl('th', { text: t('budget.category') });

        const amountHead = headRow.createEl('th', { text: t('budget.amount'), cls: 'is-numeric' });
        amountHead.addClass('is-sortable');
        amountHead.addEventListener('click', () => this.toggleSort('amount'));

        const body = table.createEl('tbody');
        for (const row of rows) {
            const tr = body.createEl('tr', { cls: 'atoz-budget-row atoz-budget-row-' + (row.kind === KIND_INCOME ? 'income' : 'expense') });
            tr.createEl('td', { text: row.entry.date.slice(5) });

            const titleCell = tr.createEl('td');
            titleCell.createSpan({ text: row.entry.title });
            if (row.entry.memo.length > 0) {
                titleCell.createSpan({ cls: 'atoz-budget-row-memo', text: row.entry.memo });
            }

            tr.createEl('td', { text: row.entry.category });
            tr.createEl('td', {
                cls: 'is-numeric',
                text: (row.kind === KIND_INCOME ? '+' : '-') + formatAmount(Math.abs(row.entry.amount)),
            });

            tr.addEventListener('click', () => {
                new EntryModal(this.plugin, {
                    kind: row.kind,
                    entry: row.entry,
                    sourceMonth: this.month,
                    onDone: () => void this.refresh(),
                }).open();
            });

            tr.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                const ledger = row.kind === KIND_INCOME ? this.income : this.expense;
                if (ledger) void this.openSource(ledger, row.entry.lineIndex);
            });
        }
    }

    private toggleSort(key: SortKey): void {
        if (this.sortKey === key) this.sortAsc = !this.sortAsc;
        else {
            this.sortKey = key;
            this.sortAsc = key === 'date';
        }
        this.app.workspace.requestSaveLayout();
        this.renderEntriesOnly();
    }
}

/* ------------------------------------------------------------------ *
 * 기능
 * ------------------------------------------------------------------ */

export class BudgetFeature {
    store: LedgerStore;

    /** 파일에서 실제로 쓰인 카테고리. 자동완성 후보를 넓히는 용도. */
    private observed: Record<string, string[]> = {};
    private refreshTimer: number | null = null;

    constructor(private plugin: ATOZPlugin) {
        this.store = new LedgerStore(plugin);
        this.applyCurrency();
    }

    private applyCurrency(): void {
        currencyPrefix = this.plugin.settings.budgetCurrencyPrefix;
        currencySuffix = this.plugin.settings.budgetCurrencySuffix;
    }

    install(): void {
        this.plugin.registerView(VIEW_TYPE_BUDGET, (leaf) => new BudgetView(leaf, this.plugin));

        this.plugin.addRibbonIcon('wallet', t('ribbon.openBudgetView'), () => void this.activateView());

        this.plugin.addCommand({
            id: 'open-budget-view',
            name: t('command.openBudgetView'),
            callback: () => void this.activateView(),
        });

        this.plugin.addCommand({
            id: 'record-expense',
            name: t('command.recordExpense'),
            callback: () => this.openEntryModal(KIND_EXPENSE),
        });

        this.plugin.addCommand({
            id: 'record-income',
            name: t('command.recordIncome'),
            callback: () => this.openEntryModal(KIND_INCOME),
        });

        this.plugin.addCommand({
            id: 'record-fixed-expenses',
            name: t('command.recordFixedExpenses'),
            callback: () => void this.openFixedExpenses(),
        });

        this.plugin.addCommand({
            id: 'open-month-ledger',
            name: t('command.openMonthLedger'),
            callback: () => void this.openMonthFile(KIND_EXPENSE),
        });

        this.plugin.app.workspace.onLayoutReady(() => {
            const vault = this.plugin.app.vault;
            // 가계부 폴더 밖의 노트를 고칠 때는 대시보드를 다시 그리지 않는다.
            const isLedgerPath = (path: string): boolean =>
                path.endsWith('.md') && path.startsWith(this.store.folderPath() + '/');
            const onChange = (file: TAbstractFile): void => {
                if (isLedgerPath(file.path)) this.scheduleRefresh();
            };
            this.plugin.registerEvent(vault.on('modify', onChange));
            this.plugin.registerEvent(vault.on('create', onChange));
            this.plugin.registerEvent(vault.on('delete', onChange));
            this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
                if (isLedgerPath(file.path) || isLedgerPath(oldPath)) this.scheduleRefresh();
            }));
        });
    }

    uninstall(): void {
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    settingsChanged(): void {
        this.applyCurrency();
        this.scheduleRefresh();
    }

    /** 모든 달의 파일과 설정에서 카테고리 이름을 바꾼다. 바꾼 내역 수를 돌려준다. */
    async renameCategory(kind: LedgerKind, from: string, to: string): Promise<number> {
        const count = await this.store.renameCategory(kind, from, to);

        const settings = this.plugin.settings;
        const rename = (category: string): string => category.trim() === from ? to : category;
        if (kind === KIND_INCOME) {
            settings.budgetIncomeCategories = uniqueStrings(settings.budgetIncomeCategories.map(rename));
        } else {
            settings.budgetExpenseCategories = uniqueStrings(settings.budgetExpenseCategories.map(rename));
            for (const fixed of settings.budgetFixedExpenses) fixed.category = rename(fixed.category);
        }
        await this.plugin.saveSettings();

        // 옛 이름이 자동완성 후보에 남지 않도록 다시 모은다.
        this.observed[kind] = [];
        return count;
    }

    categoriesFor(kind: LedgerKind): string[] {
        const base = kind === KIND_INCOME
            ? this.plugin.settings.budgetIncomeCategories
            : this.plugin.settings.budgetExpenseCategories;
        return uniqueStrings(base.concat(this.observed[kind] ?? []));
    }

    /** 파싱한 원장에서 카테고리를 주워 자동완성 후보에 더한다. */
    rememberCategories(ledger: Ledger): void {
        const found: string[] = [];
        for (const entry of ledger.entries) found.push(entry.category);
        this.observed[ledger.kind] = uniqueStrings((this.observed[ledger.kind] ?? []).concat(found));
    }

    private openEntryModal(kind: LedgerKind): void {
        // 대시보드를 열지 않았어도 최근 파일에서 쓰인 카테고리가 자동완성에 나오게 읽어 둔다.
        const month = currentMonth();
        for (const target of [month, shiftMonth(month, -1)]) {
            void this.store.load(KIND_EXPENSE, target);
            void this.store.load(KIND_INCOME, target);
        }
        new EntryModal(this.plugin, {
            kind,
            defaultDate: todayISO(),
            onDone: () => this.scheduleRefresh(),
        }).open();
    }

    private async openFixedExpenses(): Promise<void> {
        const month = currentMonth();
        const expense = await this.store.load(KIND_EXPENSE, month);
        const missing = missingFixedExpenses(this.plugin.settings.budgetFixedExpenses, month, expense);
        new FixedExpenseModal(this.plugin, month, missing, () => this.scheduleRefresh()).open();
    }

    private async openMonthFile(kind: LedgerKind): Promise<void> {
        const file = await this.store.ensureFile(kind, currentMonth());
        await this.plugin.app.workspace.getLeaf(false).openFile(file);
    }

    /** 이미 열려 있으면 그 탭으로 가고, 없으면 메인 영역에 새 탭으로 연다. */
    async activateView(): Promise<void> {
        const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_BUDGET)[0];
        if (existing) {
            await this.plugin.app.workspace.revealLeaf(existing);
            return;
        }

        const leaf = this.plugin.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE_BUDGET, active: true });
        await this.plugin.app.workspace.revealLeaf(leaf);
    }

    /** 파일이 여러 번 바뀔 때 한 번만 다시 그리도록 모아둔다. */
    private scheduleRefresh(): void {
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_BUDGET)) {
                const view = leaf.view;
                if (view instanceof BudgetView) void view.refresh();
            }
        }, 300);
    }
}
