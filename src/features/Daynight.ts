import { ItemView, Menu, Notice, TAbstractFile, TFile, WorkspaceLeaf, getIcon, normalizePath, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { makeClickable } from '../utils';
import type { MealColor, MealLegendItem } from '../types';
import { formatAmount, formatWon, parseAmount, type BudgetRecord } from './Budget';
import type { MealRecord } from './Meal';
import { END_CATEGORY, type LogRecord } from './Timeline';

export const VIEW_TYPE_DAYNIGHT = 'atoz-daynight-view';
const DEFAULT_FOLDER = 'sleep';
const FILE_NAME_PATTERN = /^sleep-\d{4}-\d{2}\.md$/;
const ROW_PATTERN = /^\|\s*(\d{4})-(\d{2})-(\d{2})\s*\|\s*(\d{2}):(\d{2})\s*\|\s*(sleep|wake)\s*\|$/;
const TABLE_HEADER = '| Date | Time | Type |\n| --- | --- | --- |\n';
const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
const RELOAD_DELAY = 100;
// 되돌리기 토스트가 떠 있는 시간
const TOAST_DURATION = 6000;
// 알약을 누른 뒤 쓰기가 끝나도 이만큼은 다시 눌러도 무시한다.
const PILL_LOCK = 600;
// 식사와 지출이 이만큼 가까우면 같은 끼니로 보고 한 줄로 합친다.
export const MEAL_SPENDING_GAP = 60 * 1000;
// 이보다 긴 깨어 있음·잠은 기록이 끊긴 것으로 본다.
const WAKE_LIMIT = 20 * HOUR;
const SLEEP_LIMIT = 18 * HOUR;
// 평소 잘 시각 2시간 전부터 6시간 뒤까지는 수면 버튼을 채워 눈에 띄게 한다. 평소 잘 시각은 지난 7일의 3시간 넘는 잠으로 본다.
const BEDTIME_BEFORE = 2 * HOUR;
const BEDTIME_AFTER = 6 * HOUR;
const BEDTIME_DAYS = 7;
const MAIN_SLEEP = 3 * HOUR;
// 활동 칸은 두 줄(8칸)까지. 블록이 더 많으면 마지막 칸이 '전체'다.
const MAX_ACTIVITY_TILES = 8;
// aria-labelledby·aria-describedby로 이을 보이는 라벨의 id. Obsidian은 aria-label을 툴팁으로 띄워 아래 칸을 덮는다.
let labelCount = 0;
function labelId(el: HTMLElement): string {
    if (!el.id) el.id = `atoz-record-label-${++labelCount}`;
    return el.id;
}
type DaynightType = 'sleep' | 'wake';

interface DaynightRecord {
    time: number;
    type: DaynightType;
    file: TFile;
    line: string;
}

export const pad = (value: number): string => String(value).padStart(2, '0');

function isoDate(time: number): string {
    const date = new Date(time);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 1시간이 안 되면 '0시간 25분' 대신 '25분'처럼 분만 보인다. */
export function formatDuration(ms: number): string {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    if (minutes < 60) return t('record.minutes', { minutes });
    return t('daynight.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60, paddedMinutes: pad(minutes % 60) });
}

/** 칸처럼 좁은 자리에 쓰는 '1:27' 꼴 길이 */
function formatClockDuration(ms: number): string {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

export function formatShortDate(time: number): string {
    const date = new Date(time);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatTime(time: number): string {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatShortDateTime(time: number): string {
    return `${formatShortDate(time)} ${formatTime(time)}`;
}

function formatRow(date: Date, type: DaynightType): string {
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return `| ${day} | ${pad(date.getHours())}:${pad(date.getMinutes())} | ${type} |`;
}

export interface DaynightSegment {
    from: number;
    to: number;
    // gap은 기록이 끊겨 상태를 모르는 구간이다. 파일에는 없고 읽을 때 가른다.
    type: DaynightType | 'gap';
}

// 각 기록에서 다음 기록까지를 그 기록 종류의 구간으로 만든다. 마지막 구간은 지금까지 진행 중이다.
export function toSegments(records: DaynightRecord[], now: number): DaynightSegment[] {
    return records.map((record, index) => ({
        from: record.time,
        to: records[index + 1]?.time ?? now,
        type: record.type,
    }));
}

/**
 * 너무 긴 구간은 믿을 수 있는 앞부분만 남기고 나머지를 '기록 없음'(gap)으로 가른다.
 * 깨어 있음이 20시간을 넘으면 처음 20시간 안의 마지막 다른 기록까지, 잠이 18시간을 넘으면 그 안의 첫 다른 기록까지만 믿는다.
 * events는 수면 밖의 기록(식사·활동·지출) 시각이다.
 */
export function splitGaps(segments: DaynightSegment[], events: number[]): DaynightSegment[] {
    const out: DaynightSegment[] = [];
    const push = (segment: DaynightSegment): void => {
        const last = out[out.length - 1];
        if (last?.type === 'gap' && segment.type === 'gap') last.to = segment.to;
        else out.push(segment);
    };
    for (const segment of segments) {
        const { from, to, type } = segment;
        const limit = type === 'sleep' ? SLEEP_LIMIT : WAKE_LIMIT;
        if (type === 'gap' || to - from <= limit) {
            push(segment);
            continue;
        }
        const inside = events.filter((time) => time > from && time < from + limit);
        const known = inside.length === 0 ? from : type === 'sleep' ? Math.min(...inside) : Math.max(...inside);
        if (known > from) push({ from, to: known, type });
        push({ from: known, to, type: 'gap' });
    }
    return out;
}

/** 끊긴 길이. 하루가 넘으면 날 수로 줄인다. */
export function formatGapLength(ms: number): string {
    return ms < DAY ? formatDuration(ms) : t('daynight.dashboard.days', { days: Math.floor(ms / DAY) });
}

export function entryTime(entry: BudgetRecord['entry']): number {
    const [year, month, day] = entry.date.split('-').map(Number);
    const [hour, minute] = entry.time.split(':').map(Number);
    return new Date(year!, month! - 1, day, hour, minute).getTime();
}

const ACCENT_COLOR: MealColor = { light: 'var(--interactive-accent)', dark: 'var(--interactive-accent)' };
const SLEEP_COLOR = ACCENT_COLOR;
const WAKE_COLOR: MealColor = { light: 'var(--atoz-daynight-morning)', dark: 'var(--atoz-daynight-morning)' };

// 지출 알약 아이콘. 표에 없는 카테고리는 지갑이다.
const SPENDING_ICONS: Record<string, string> = {
    장보기: 'shopping-cart', Groceries: 'shopping-cart',
    카페: 'coffee', Cafe: 'coffee',
    교통: 'bus', Transport: 'bus',
    생활: 'home', Living: 'home',
};

/** 범례 아이콘. 알 수 없는 이름이면 포크·나이프다. */
function mealIcon(icon: string): string {
    return getIcon(icon) ? icon : 'utensils';
}

/** 상태 점·기록 줄·알약에 색을 붙인다. 색이 정해지지 않았으면 회색으로 그린다. */
function applyColor(el: HTMLElement, color: MealColor | null | undefined): void {
    el.addClass('atoz-record-colored');
    if (!color) return;
    el.style.setProperty('--atoz-record-light', color.light);
    el.style.setProperty('--atoz-record-dark', color.dark);
}

// 목록의 한 줄. 수면·식사·활동·지출을 같은 모양으로 섞어 보인다.
interface PanelRecord {
    key: string;
    time: number;
    // 목록에서 줄이 놓이는 시각. 없으면 time이다. 잠은 깬 시각에 놓인다.
    at?: number;
    // 줄 앞 표시. 활동은 점, 그 밖은 아이콘이다.
    mark: 'dot' | { icon: string };
    color: MealColor | null | undefined;
    text: string;
    // 이름 뒤에 흐리게 붙는 설명('00:22부터'). 고치는 값이 아니다.
    detail?: string;
    // 아직 끝나지 않은 활동·잠. 줄을 칠하고 값은 흐리게 둔다.
    isLive?: boolean;
    // 금액처럼 줄 끝에 붙는 값
    value: string;
    isIncome: boolean;
    // null이면 메모 칸이 없다.
    note: string | null;
    noteLabel: string;
    // 메모가 비었을 때 줄 끝에 보이는 쓰기 안내. 줄을 누르면 고치기가 열린다.
    notePrompt?: string;
    // 고치기에서 바꿀 수 있는 종류(식사 종류·지출 카테고리·활동 블록)
    choices?: { label: string; value: string; options: EditChoice[] };
    // 고른 종류에서 최근에 쓴 메모(메뉴·항목). 누르면 키보드 없이 들어간다.
    recentNotes?: (choice: string) => string[];
    // 금액·결제 수단을 고칠 수 있는 줄(지출, 지출과 짝인 식사)
    amount?: { value: number; payment: string };
    // 끝 시각을 고칠 수 있는 줄(다음 기록이 있는 활동)
    end?: number;
    deletable: boolean;
    save: (values: EditValues) => Promise<void>;
    remove: () => Promise<void>;
    // 지운 기록을 다시 넣는다(되돌리기).
    restore: () => Promise<unknown>;
}

interface EditChoice {
    label: string;
    // null이면 색 점
    icon: string | null;
    color: MealColor | null | undefined;
}

interface EditValues {
    time: number;
    note: string;
    choice: string;
    amount: number | null;
    payment: string;
    end: number | null;
}

// 고치는 중인 값. 입력 칸의 글자 그대로 둔다.
interface Editing {
    record: PanelRecord;
    time: string;
    note: string;
    choice: string;
    amount: string;
    payment: string;
    end: string;
    error?: string;
}

const sleepKey = (record: DaynightRecord): string => `sleep:${record.time}`;
export const mealKey = (meal: MealRecord): string => `meal:${meal.file.path}:${meal.line}`;
const logKey = (log: LogRecord): string => `log:${log.file.path}:${log.line}`;
const budgetKey = ({ kind, month, entry }: BudgetRecord): string => `budget:${kind}:${month}:${entry.lineIndex}:${entry.raw}`;

/** 'HH:MM'을 분만큼 옮긴다. 자정을 넘으면 돌아간다. */
function shiftClock(value: string, minutes: number): string {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return value;
    const total = ((Number(match[1]) * 60 + Number(match[2]) + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

interface ToastAction {
    label: string;
    run: () => Promise<unknown> | void;
    // [고치기]가 여는 줄. 토스트가 떠 있는 동안 그 줄을 칠한다.
    key?: string;
}

// 금액 칸을 연 알약. 식사 알약에서 열었으면 금액을 비워도 식사는 남긴다.
interface AmountTarget {
    category: string;
    meal: MealLegendItem | null;
}

export class DaynightView extends ItemView {
    private budgetRecords: BudgetRecord[] = [];
    private isYesterdayShown = false;
    // 펼친 기록과 고치는 중인 값. 줄을 다시 누르거나 다른 줄을 펼치면 저장한다.
    private editing: Editing | null = null;
    private amountTarget: AmountTarget | null = null;
    private amountDraft = '';
    private amountPayment = '';
    private amountTitle = '';
    // 시트를 막 열었을 때만 금액 칸에 초점을 준다(최근 금액이 없을 때). 다시 그릴 때마다 키보드를 띄우지 않는다.
    private shouldFocusAmount = false;
    // 금액 칸 바로 아래에 보이는 오류
    private amountError = '';
    // 방금 한 일과 되돌리기. 다시 그려도 사라지지 않게 여기에 둔다.
    private toast: { text: string; actions: ToastAction[] } | null = null;
    // 토스트가 새 기록을 알리는가. 그 동안 목록 마지막 줄(방금 남긴 줄)을 칠한다.
    private isToastFresh = false;
    private toastTimer: number | null = null;
    // 쓰는 중인 버튼(data-lock 값). 그동안 같은 버튼을 다시 눌러도 무시한다.
    private pending = new Set<string>();
    // 처음 열 때와 방금 기록했을 때만 맨 아래(최신 기록)로 스크롤한다. 그 밖에는 보던 자리를 지킨다.
    private scrollToEnd = true;
    private isRendering = false;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_DAYNIGHT; }
    getDisplayText(): string { return t('record.viewName'); }
    getIcon(): string { return 'clock'; }

    async onOpen(): Promise<void> {
        // 고치거나 금액을 넣는 중에는 다시 그리면 입력이 닫히고, 키보드로 초점을 옮기는 중에는 초점이 사라지므로
        // 상태 카드만 새로 그려 경과 시간이 멈추지 않게 한다.
        this.registerInterval(window.setInterval(() => {
            const focused = activeDocument.activeElement;
            const isKeyboard = focused instanceof HTMLElement && this.containerEl.contains(focused) && focused.matches(':focus-visible');
            if (isKeyboard || this.editing !== null || this.amountTarget !== null) this.refreshStatus();
            else this.render();
        }, 60 * 1000));
        this.render();
        await this.reloadBudget();
    }

    async onClose(): Promise<void> {
        if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    }

    async reloadBudget(): Promise<void> {
        this.budgetRecords = await this.plugin.budget.timedRecords();
        this.render();
    }

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        // 패널은 [지금 줄] / [오늘 목록] / [아래 묶음]이고 오늘 목록만 스크롤한다.
        const oldFeed = container.querySelector<HTMLElement>('.atoz-record-feed');
        const previousScroll = oldFeed?.scrollTop ?? 0;
        // 처음 그릴 때와 맨 아래(최신 기록)를 보고 있었을 때는 다시 그린 뒤에도 맨 아래를 보인다.
        const wasAtEnd = !oldFeed || previousScroll + oldFeed.clientHeight >= oldFeed.scrollHeight - 4;
        // 다시 그려도 키보드 초점이 같은 줄·버튼에 남게, 초점이 있던 요소를 기억한다(고치기 안은 빼고).
        const focused = activeDocument.activeElement;
        let focusSelector: string | null = null;
        if (focused instanceof HTMLElement && container.contains(focused) && !focused.closest('.atoz-record-editor')) {
            if (focused.dataset.focus) focusSelector = `[data-focus="${CSS.escape(focused.dataset.focus)}"]`;
            else if (focused.dataset.lock) focusSelector = `[data-lock="${CSS.escape(focused.dataset.lock)}"]`;
        }
        // 초점이 있던 칸을 지울 때 나는 focusout은 고치기를 닫는 뜻이 아니다.
        this.isRendering = true;
        container.empty();
        this.isRendering = false;
        container.addClass('atoz-daynight');

        const now = Date.now();
        // 하루 시작 시각 전의 기록은 어제다.
        const startHour = this.plugin.settings.timelineDayStartHour;
        const shifted = new Date(now - startHour * HOUR);
        const todayStart = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), startHour).getTime();
        const yesterdayStart = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() - 1, startHour).getTime();
        const records = this.collect(yesterdayStart);
        // 다시 읽은 기록으로 바꿔 끼우고, 사라진 기록이면 닫는다.
        const editingKey = this.editing?.record.key;
        const editingRecord = records.find((record) => record.key === editingKey);
        // 고치는 동안 활동이 끝났으면 비어 있던 끝 칸을 채운다.
        this.editing = this.editing && editingRecord ? {
            ...this.editing,
            record: editingRecord,
            end: this.editing.end || (editingRecord.end === undefined ? '' : formatTime(editingRecord.end)),
        } : null;

        this.renderStatus(container, now);

        // 기록은 아래에서부터 쌓아 최신 기록이 아래 묶음 바로 위에 온다.
        const feed = container.createDiv({ cls: 'atoz-record-feed' });
        const list = feed.createDiv({ cls: 'atoz-record-list' });
        const yesterday = records.filter((record) => (record.at ?? record.time) < todayStart);
        const today = records.filter((record) => (record.at ?? record.time) >= todayStart);
        if (yesterday.length > 0) {
            const fold = list.createDiv({ cls: 'atoz-record-fold', attr: { 'aria-expanded': String(this.isYesterdayShown), 'data-focus': 'fold' } });
            setIcon(fold.createSpan(), this.isYesterdayShown ? 'chevron-down' : 'chevron-right');
            fold.createSpan({ text: t('record.yesterday', { count: yesterday.length }) });
            makeClickable(fold, () => {
                this.isYesterdayShown = !this.isYesterdayShown;
                this.render();
            });
            if (this.isYesterdayShown) {
                yesterday.forEach((record) => this.renderRecord(list, record));
                list.createDiv({ cls: 'atoz-record-divider', text: t('record.today') });
            }
        }
        if (today.length === 0) list.createDiv({ cls: 'atoz-record-empty', text: t('record.empty') });
        today.forEach((record) => this.renderRecord(list, record));
        // 토스트는 목록 끝에 겹쳐 뜨므로 그만큼 아래를 비워 방금 남긴 줄이 토스트 위에 보이게 한다.
        feed.toggleClass('has-toast', this.toast !== null);
        // 방금 남긴 줄: [고치기]가 여는 줄, 없으면(지출·다시 시작) 맨 아래 줄
        if (this.toast && this.isToastFresh && today.length > 0) {
            const key = this.toast.actions.find((action) => action.key)?.key;
            const fresh = key ? list.querySelector(`[data-focus="${CSS.escape(`row:${key}`)}"]`)?.parentElement : list.lastElementChild;
            fresh?.addClass('is-fresh');
        }

        // 알약과 수면 버튼은 아래에 고정되어 늘 보인다.
        const dock = container.createDiv({ cls: 'atoz-record-dock' });
        const controls = dock.createDiv({ cls: 'atoz-record-controls' });
        // 휴대폰에서는 금액 시트가 알약 줄을 대신해 키보드 바로 위에 붙는다.
        controls.toggleClass('has-sheet', this.amountTarget !== null);
        // 평소 잘 시각 무렵에만 격자 위에 잠 띠를 띄운다. 시트가 열려 있으면 숨긴다.
        if (this.amountTarget === null && this.lastSleep()?.type !== 'sleep' && this.plugin.daynight.isBedtime(now)) {
            this.renderBedtime(controls, now);
        }
        this.renderSpending(controls, todayStart);
        this.renderMeals(controls, todayStart);
        this.renderActivities(controls, todayStart, now);

        if (this.toast) this.renderToast(dock, this.toast);

        this.syncPending();

        // 펼친 기록이 있으면 그 줄이 보이게 하고, 방금 기록했거나 맨 아래를 보고 있었으면 맨 아래 최신 기록을, 아니면 보던 자리를 보인다.
        const open = list.querySelector('.atoz-record-row.is-open');
        if (open) {
            // 목록 칸 안에 보이게 한다.
            feed.scrollTop = previousScroll;
            const view = feed.getBoundingClientRect();
            const { top, bottom } = open.getBoundingClientRect();
            if (top < view.top) feed.scrollTop -= view.top - top;
            else if (bottom > view.bottom) feed.scrollTop += bottom - view.bottom;
        } else if (this.scrollToEnd || wasAtEnd) {
            feed.scrollTop = feed.scrollHeight;
            this.scrollToEnd = false;
        } else {
            feed.scrollTop = previousScroll;
        }
        if (focusSelector) container.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
    }

    private refreshStatus(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        const hero = container.querySelector('.atoz-daynight-hero');
        // 상태 카드 안의 버튼에 초점이 있으면 바꿔 끼울 때 초점이 사라지므로 이번에는 건너뛴다.
        if (!hero || hero.contains(activeDocument.activeElement)) return;
        const fresh = createDiv();
        this.renderStatus(fresh, Date.now());
        hero.replaceWith(...Array.from(fresh.childNodes));
    }

    private lastSleep(): DaynightRecord | undefined {
        const records = this.plugin.daynight.records;
        return records[records.length - 1];
    }

    private renderStatus(container: HTMLElement, now: number): void {
        const segments = this.plugin.daynight.segments(now, this.budgetRecords.map(({ entry }) => entryTime(entry)));
        const tail = segments[segments.length - 1];
        if (tail?.type === 'gap') {
            this.renderGap(container, tail, now);
            return;
        }

        const hero = container.createDiv({ cls: 'atoz-daynight-hero' });
        const last = this.lastSleep();
        const isAsleep = last?.type === 'sleep';
        const current = isAsleep ? null : this.plugin.timeline.current();

        const head = hero.createDiv({ cls: 'atoz-daynight-hero-label' });
        applyColor(
            head.createSpan({ cls: 'atoz-daynight-dot' }),
            isAsleep ? SLEEP_COLOR : current ? this.plugin.timeline.colorOf(current.category) ?? ACCENT_COLOR : null,
        );
        const status = head.createSpan({
            cls: 'atoz-record-status',
            text: isAsleep ? t('daynight.asleep') : current ? current.category : t('record.idle'),
        });
        // 오른쪽 버튼 칸. '다시 누르면 끝'을 외우지 않아도 되게 끝내기 버튼을 둔다.
        const actions = hero.createDiv({ cls: 'atoz-daynight-hero-actions' });
        if (current) {
            const key = `activity:${current.category}`;
            const end = actions.createEl('button', { cls: 'atoz-daynight-hero-button', attr: { 'data-lock': key } });
            setIcon(end, 'square');
            end.createSpan({ text: t('record.end') });
            end.addEventListener('click', () => void this.lock(key, () => this.toggleActivity(current.category)));
        }
        // 잠 버튼은 맨 아래 큰 버튼이 아니라 여기 작은 버튼이다. 서랍 메뉴를 닫는 탭이 새어 눌리지 않게 위에 둔다.
        // 금액 시트가 열려 있는 동안은 숨긴다.
        if (this.amountTarget === null) {
            const sleep = actions.createEl('button', {
                cls: `atoz-daynight-hero-button atoz-daynight-hero-sleep ${isAsleep ? 'is-asleep' : 'is-awake'}`,
                attr: { 'data-lock': 'sleep' },
            });
            setIcon(sleep, isAsleep ? 'sun' : 'moon');
            sleep.createSpan({ text: isAsleep ? t('daynight.wakeShort') : t('daynight.sleepShort') });
            sleep.addEventListener('click', () => void this.lock('sleep', () => this.toggleSleep()));
        }

        const at = (time: number): string =>
            formatShortDate(time) === formatShortDate(now) ? formatTime(time) : formatShortDateTime(time);
        let since: number | undefined;
        let sub = '';
        if (isAsleep) {
            since = last.time;
            sub = t('daynight.sleptAt', { time: at(last.time) });
        } else if (current) {
            since = current.time;
            sub = t('record.since', { time: at(current.time) });
            if (current.memo) sub += ` · ${current.memo}`;
        } else {
            // 일어난 뒤에 끝낸 활동이 있으면 그때부터, 없으면 일어난 때부터 센다.
            const logs = this.plugin.timeline.logs.filter((log) => log.time <= now);
            const end = logs[logs.length - 1];
            const ended = logs[logs.length - 2];
            // 활동이 없을 때 큰 숫자는 '끝난 지'나 '깬 지'라서 라벨을 그 뜻으로 바꾼다.
            if (end && (!last || end.time > last.time)) {
                since = end.time;
                status.setText(t('record.endedFor', {
                    activity: ended && ended.category !== END_CATEGORY ? ended.category : t('record.activity'),
                }));
            } else if (last) {
                since = last.time;
                status.setText(t('record.awakeFor'));
            }
            if (since !== undefined) sub = t('record.since', { time: at(since) });
        }
        hero.createDiv({ cls: 'atoz-daynight-hero-value', text: since === undefined ? '—' : formatDuration(now - since) });
        if (sub) hero.createDiv({ cls: 'atoz-daynight-hero-sub', text: sub });
    }

    // 기록이 끊겨 지금 상태를 모르면 경과 시간 대신 다시 시작할 길을 보인다.
    private renderGap(container: HTMLElement, gap: DaynightSegment, now: number): void {
        const hero = container.createDiv({ cls: 'atoz-daynight-hero is-gap' });
        const head = hero.createDiv({ cls: 'atoz-daynight-hero-label' });
        setIcon(head.createSpan({ cls: 'atoz-daynight-gap-icon' }), 'alert-triangle');
        head.createSpan({ cls: 'atoz-record-status', text: t('daynight.gap.title', { length: formatGapLength(now - gap.from) }) });

        const last = this.lastSleep()!;
        hero.createDiv({
            cls: 'atoz-daynight-gap-last',
            text: t('daynight.gap.last', {
                time: formatShortDateTime(last.time),
                type: t(last.type === 'sleep' ? 'daynight.sleep' : 'daynight.wake'),
            }),
        });
        hero.createDiv({ cls: 'atoz-daynight-hero-sub', text: t('daynight.gap.desc') });

        const actions = hero.createDiv({ cls: 'atoz-daynight-gap-actions' });
        const restart = actions.createEl('button', { cls: 'mod-cta', text: t('daynight.gap.restart'), attr: { 'data-lock': 'sleep' } });
        restart.addEventListener('click', () => void this.lock('sleep', () => this.restart()));
        const fill = actions.createEl('button', { text: t('daynight.gap.fill') });
        fill.addEventListener('click', () => void this.app.workspace.getLeaf('tab').openFile(last.file));
    }

    /** from 이후의 네 가지 기록을 시간순으로 모은다. */
    private collect(from: number): PanelRecord[] {
        const plugin = this.plugin;
        const settings = plugin.settings;
        const out: PanelRecord[] = [];

        const sleeps = plugin.daynight.records;
        sleeps.forEach((record, index) => {
            const previous = sleeps[index - 1];
            const next = sleeps[index + 1];
            const last = sleeps[sleeps.length - 1];
            // 잠과 그 뒤 기상은 깬 시각에 한 줄로 보인다. 기상은 잠 줄의 끝 시각으로 고친다.
            if (record.type === 'wake' && previous?.type === 'sleep') return;
            if (record.type === 'sleep') {
                const wake = next?.type === 'wake' ? next : undefined;
                const after = wake ? sleeps[index + 2] : undefined;
                if ((wake?.time ?? record.time) < from) return;
                const length = wake ? wake.time - record.time : 0;
                out.push({
                    key: sleepKey(record),
                    time: record.time,
                    at: wake?.time,
                    mark: { icon: 'moon' },
                    color: SLEEP_COLOR,
                    text: t(wake && length <= MAIN_SLEEP ? 'record.nap' : 'record.sleepMain'),
                    detail: wake ? t('record.sleepFrom', { time: formatTime(record.time) }) : undefined,
                    value: wake ? formatDuration(length) : t('daynight.asleep'),
                    isLive: !wake,
                    isIncome: false,
                    note: null,
                    noteLabel: '',
                    end: wake?.time,
                    // 지우기는 마지막 기록이 들어 있는 줄만 해서 기록은 항상 취침과 기상이 번갈아 나온다.
                    deletable: (wake ?? record) === last,
                    save: async ({ time, end }) => {
                        // 앞뒤 기록 사이여야 순서가 유지된다. 지금보다 뒤인지, 시작이 끝보다 앞인지는 commitEdit에서 본다.
                        if (previous && time <= previous.time) {
                            new Notice(t('daynight.editTooEarly', { time: formatShortDateTime(previous.time) }));
                        } else if (after && end !== null && end >= after.time) {
                            new Notice(t('daynight.editTooLate', { time: formatShortDateTime(after.time) }));
                        } else {
                            if (time !== record.time) await plugin.daynight.editRecord(record, time);
                            if (wake && end !== null && end !== wake.time) await plugin.daynight.editRecord(wake, end);
                        }
                    },
                    remove: async () => {
                        if (wake) await plugin.daynight.deleteLast();
                        await plugin.daynight.deleteLast();
                    },
                    restore: async () => {
                        await plugin.daynight.restore(record);
                        if (wake) await plugin.daynight.restore(wake);
                    },
                });
                return;
            }
            // 잠 없이 남은 기상(처음 기록이나 끊긴 뒤 다시 시작)은 따로 한 줄이다.
            if (record.time < from) return;
            out.push({
                key: sleepKey(record),
                time: record.time,
                mark: { icon: 'sun' },
                color: WAKE_COLOR,
                text: t('daynight.wake'),
                value: '',
                isIncome: false,
                note: null,
                noteLabel: '',
                deletable: record === last,
                save: async ({ time }) => {
                    if (previous && time <= previous.time) {
                        new Notice(t('daynight.editTooEarly', { time: formatShortDateTime(previous.time) }));
                    } else if (next && time >= next.time) {
                        new Notice(t('daynight.editTooLate', { time: formatShortDateTime(next.time) }));
                    } else {
                        await plugin.daynight.editRecord(record, time);
                    }
                },
                remove: () => plugin.daynight.deleteLast(),
                restore: () => plugin.daynight.restore(record),
            });
        });

        // 지출과 합칠 식사 줄
        const meals: { meal: MealRecord; record: PanelRecord }[] = [];
        const legendOf = (label: string): MealLegendItem | undefined => settings.mealLegend.find((item) => item.label === label);
        const mealChoices = settings.mealLegend.map((item) => ({ label: item.label, icon: mealIcon(item.icon), color: plugin.meal.colorOf(item.color) }));
        for (const meal of plugin.meal.records) {
            if (meal.time < from) continue;
            const legend = settings.mealLegend.find((item) => item.icon === meal.icon && item.color === meal.color);
            const record: PanelRecord = {
                key: mealKey(meal),
                time: meal.time,
                mark: { icon: mealIcon(meal.icon) },
                color: plugin.meal.colorOf(meal.color),
                text: legend?.label ?? t('record.meal'),
                value: '',
                isIncome: false,
                note: meal.food,
                noteLabel: t('record.food'),
                notePrompt: t('record.toast.writeMenu'),
                choices: { label: t('record.kind'), value: legend?.label ?? '', options: mealChoices },
                recentNotes: (choice) => {
                    const pick = legendOf(choice);
                    if (!pick) return [];
                    const foods = plugin.meal.records
                        .filter((item) => item.food && item.icon === pick.icon && item.color === pick.color)
                        .sort((a, b) => b.time - a.time)
                        .map((item) => item.food);
                    return [...new Set(foods)].slice(0, 4);
                },
                deletable: true,
                save: ({ time, note, choice }) => plugin.meal.replace(meal, time, note, legendOf(choice) ?? meal),
                remove: () => plugin.meal.replace(meal, null, ''),
                restore: () => plugin.meal.add(meal.time, meal.food, meal),
            };
            out.push(record);
            meals.push({ meal, record });
        }

        const logs = plugin.timeline.logs;
        const blockChoices = (current: string): EditChoice[] => [...new Set([...plugin.timeline.blocks, current])]
            .map((name) => ({ label: name, icon: null, color: plugin.timeline.colorOf(name) }));
        logs.forEach((log, index) => {
            // 끝 기록은 따로 그리지 않고 활동 줄의 끝 시각으로 고친다.
            if (log.time < from || log.category === END_CATEGORY) return;
            const next = logs[index + 1];
            const ending = next?.category === END_CATEGORY ? next : undefined;
            out.push({
                key: logKey(log),
                time: log.time,
                mark: 'dot',
                color: plugin.timeline.colorOf(log.category),
                text: log.category,
                // 활동 줄에는 다음 기록까지의 길이를 붙여 빼기를 대신한다.
                value: next ? formatDuration(next.time - log.time) : t('record.ongoing'),
                isLive: !next,
                isIncome: false,
                note: log.memo,
                noteLabel: t('record.memo'),
                choices: { label: t('record.blockLabel'), value: log.category, options: blockChoices(log.category) },
                // 끝 시각은 다음 기록(끝 기록이나 다음 활동)의 시각이다.
                end: next?.time,
                deletable: true,
                save: async ({ time, note, choice, end }) => {
                    await plugin.timeline.replaceLog(log, time, note, choice || log.category);
                    if (next && end !== null && end !== next.time) await plugin.timeline.replaceLog(next, end, next.memo);
                },
                // 활동을 지우면 그 끝 기록도 함께 지운다.
                remove: async () => {
                    await plugin.timeline.replaceLog(log, null, '');
                    if (ending) await plugin.timeline.replaceLog(ending, null, '');
                },
                restore: async () => {
                    await plugin.timeline.addLog(log.time, log.category, log.memo);
                    if (ending) await plugin.timeline.addLog(ending.time, END_CATEGORY);
                },
            });
        });

        // 그 카테고리에서 최근에 쓴 항목
        for (const record of this.budgetRecords) {
            const { entry } = record;
            const time = entryTime(entry);
            if (time < from) continue;
            const amount = (record.kind === 'income' ? '+' : '−') + formatAmount(entry.amount);
            // 식사 알약에서 금액과 함께 남긴 지출은 그 식사 줄에 금액만 붙인다. 고치고 지울 때도 함께한다.
            const pair = record.kind === 'expense'
                ? meals.find(({ record: mealRecord }) => !mealRecord.value
                    && mealRecord.text === entry.category && Math.abs(mealRecord.time - time) <= MEAL_SPENDING_GAP)
                : undefined;
            if (pair) {
                const { record: mealRecord, meal } = pair;
                mealRecord.value = amount;
                mealRecord.amount = { value: entry.amount, payment: entry.payment };
                // 식사 종류를 바꾸면 지출 카테고리도 그 이름으로 바꾼다.
                mealRecord.save = async ({ time: newTime, note, choice, amount: newAmount, payment }) => {
                    if (!this.isSameMonth(record, newTime)) return;
                    await plugin.meal.replace(meal, newTime, note, legendOf(choice) ?? meal);
                    await plugin.budget.editRecord(record, formatTime(newTime), entry.title, {
                        date: isoDate(newTime),
                        category: choice || entry.category,
                        amount: newAmount ?? entry.amount,
                        payment,
                    });
                };
                mealRecord.remove = async () => {
                    await plugin.meal.replace(meal, null, '');
                    await plugin.budget.deleteRecord(record);
                };
                mealRecord.restore = async () => {
                    await plugin.meal.add(meal.time, meal.food, meal);
                    await plugin.budget.restoreRecord(record);
                };
                continue;
            }
            const categories = [...new Set([...settings.budgetPanelCategories, entry.category])].filter(Boolean);
            out.push({
                key: budgetKey(record),
                time,
                mark: { icon: record.kind === 'income' ? 'piggy-bank' : SPENDING_ICONS[entry.category] ?? 'wallet' },
                // 가계부 카테고리에는 색이 없다.
                color: null,
                text: entry.category || t('budget.uncategorized'),
                value: amount,
                isIncome: record.kind === 'income',
                note: entry.title,
                noteLabel: t('budget.item'),
                choices: record.kind === 'expense' ? {
                    label: t('record.categoryLabel'),
                    value: entry.category,
                    options: categories.map((category) => ({ label: category, icon: SPENDING_ICONS[category] ?? 'wallet', color: null })),
                } : undefined,
                recentNotes: record.kind === 'expense' ? (category) => this.recentTitles(category) : undefined,
                amount: { value: entry.amount, payment: entry.payment },
                deletable: true,
                save: async ({ time: newTime, note, choice, amount: newAmount, payment }) => {
                    if (!this.isSameMonth(record, newTime)) return;
                    await plugin.budget.editRecord(record, formatTime(newTime), note, {
                        date: isoDate(newTime),
                        category: choice || entry.category,
                        amount: newAmount ?? entry.amount,
                        payment,
                    });
                },
                remove: () => plugin.budget.deleteRecord(record),
                restore: () => plugin.budget.restoreRecord(record),
            });
        }

        // 같은 시각이면 모은 순서(수면, 식사, 활동, 지출)를 지킨다.
        return out.sort((a, b) => (a.at ?? a.time) - (b.at ?? b.time));
    }

    // 가계부는 달마다 파일이 따로라, 고친 시각이 다른 달로 넘어가면 옮기지 않고 알린다.
    private isSameMonth(record: BudgetRecord, time: number): boolean {
        if (isoDate(time).slice(0, 7) === record.month) return true;
        new Notice(t('record.editOtherMonth'));
        return false;
    }

    private startEdit(record: PanelRecord): Editing {
        return {
            record,
            time: formatTime(record.time),
            note: record.note ?? '',
            choice: record.choices?.value ?? '',
            amount: record.amount ? String(record.amount.value) : '',
            payment: record.amount?.payment ?? '',
            end: record.end === undefined ? '' : formatTime(record.end),
        };
    }

    /** 그 기록의 고치기를 연다(토스트의 [고치기], 홈의 [쓰기]). */
    openEditor(key: string, time: number): void {
        // 패널과 같은 범위(어제부터)로 모아야 조금 앞서 남긴 짝 지출도 함께 묶인다.
        const startHour = this.plugin.settings.timelineDayStartHour;
        const shifted = new Date(Date.now() - startHour * HOUR);
        const todayStart = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), startHour).getTime();
        const record = this.collect(Math.min(time, todayStart - DAY)).find((item) => item.key === key);
        if (!record) return;
        this.commitEdit();
        this.editing = this.startEdit(record);
        // 어제 기록이면 접힌 어제 묶음을 펼쳐야 고치기가 보인다.
        if (record.time < todayStart) this.isYesterdayShown = true;
        this.render();
        this.containerEl.querySelector('.atoz-record-editor')?.scrollIntoView({ block: 'nearest' });
    }

    private editAction(key: string, time: number): ToastAction {
        return { label: t('record.toast.edit'), run: () => this.openEditor(key, time), key };
    }

    // 가계부는 다시 읽은 내역에서 같은 날짜·시각·카테고리·금액인 줄을 찾아 연다.
    private editSpending(spent: BudgetRecord): ToastAction {
        const { entry } = spent;
        return {
            label: t('record.toast.edit'),
            run: () => {
                const found = this.budgetRecords.find((record) => record.kind === spent.kind && record.entry.date === entry.date
                    && record.entry.time === entry.time && record.entry.category === entry.category && record.entry.amount === entry.amount);
                if (found) this.openEditor(budgetKey(found), entryTime(found.entry));
            },
        };
    }

    private renderRecord(list: HTMLElement, record: PanelRecord): void {
        const row = list.createDiv({ cls: 'atoz-record-row is-editable' });
        if (record.isLive) {
            row.addClass('is-live');
            applyColor(row, record.color);
        }
        const head = row.createDiv({ cls: 'atoz-record-head', attr: { 'data-focus': `row:${record.key}` } });
        head.createSpan({ cls: 'atoz-record-time', text: formatTime(record.at ?? record.time) });
        this.renderMark(head, record);
        const text = head.createSpan({ cls: 'atoz-record-text', text: record.text });
        const detail = record.note || record.detail;
        if (detail) text.createSpan({ cls: 'atoz-record-note', text: ` · ${detail}` });
        else if (record.notePrompt) head.createSpan({ cls: 'atoz-record-prompt', text: record.notePrompt });
        if (record.value) {
            const value = head.createSpan({ cls: 'atoz-record-value', text: record.value });
            value.toggleClass('is-income', record.isIncome);
        }

        const editing = this.editing?.record.key === record.key ? this.editing : null;
        head.setAttr('aria-expanded', String(editing !== null));
        makeClickable(head, () => {
            // 고친 값이 틀렸으면 그 줄을 펼친 채 오류를 보인다.
            if (!this.commitEdit()) {
                this.render();
                return;
            }
            if (!editing) this.editing = this.startEdit(record);
            this.render();
        });
        if (!editing) return;

        // 휴대폰은 바텀 시트, PC는 줄 아래 펼침. 내용은 같다.
        row.addClass('is-open');
        if (activeDocument.body.hasClass('is-mobile')) {
            const container = this.containerEl.children[1] as HTMLElement;
            const scrim = container.createDiv({ cls: 'atoz-record-scrim' });
            scrim.addEventListener('click', () => {
                this.commitEdit();
                this.render();
            });
            this.renderEditor(container.createDiv({ cls: 'atoz-record-editor is-sheet', attr: { role: 'dialog' } }), record, editing);
        } else {
            this.renderEditor(row.createDiv({ cls: 'atoz-record-editor' }), record, editing);
        }
    }

    private renderMark(parent: HTMLElement, record: PanelRecord): void {
        const mark = parent.createSpan({ cls: 'atoz-record-mark' });
        applyColor(mark, record.color);
        if (typeof record.mark === 'string') mark.createSpan({ cls: `atoz-record-${record.mark}` });
        else setIcon(mark, record.mark.icon);
    }

    // 고치기: 머리, 종류 칩, 메모와 최근 칩, 금액·결제, 시각(±5분), 아래 [지우기] [완료].
    // 시각은 그 기록이 속한 하루 안에서 읽는다. 날짜는 고르지 않는다.
    private renderEditor(editor: HTMLElement, record: PanelRecord, editing: Editing): void {
        const field = (label: string): HTMLElement => {
            const el = editor.createDiv({ cls: 'atoz-record-field' });
            el.createDiv({ cls: 'atoz-record-field-label', text: label });
            return el;
        };
        const labelOf = (box: HTMLElement): string => labelId(box.querySelector<HTMLElement>('.atoz-record-field-label')!);
        const inputs: HTMLInputElement[] = [];

        const head = editor.createDiv({ cls: 'atoz-record-editor-head' });
        this.renderMark(head, record);
        head.createSpan({ cls: 'atoz-record-editor-title', text: record.text });
        head.createSpan({
            cls: 'atoz-record-editor-sub',
            text: [formatShortDateTime(record.time), record.value].filter(Boolean).join(' · '),
        });
        this.addRecordAction(head, 'x', t('record.close'), () => {
            this.editing = null;
            this.render();
        });

        if (record.choices) {
            const box = field(record.choices.label);
            const chips = box.createDiv({ cls: 'atoz-record-chips', attr: { role: 'group', 'aria-labelledby': labelOf(box) } });
            for (const option of record.choices.options) {
                const chip = chips.createEl('button', { cls: 'atoz-record-chip' });
                applyColor(chip, option.color);
                if (option.icon) setIcon(chip.createSpan({ cls: 'atoz-record-chip-icon' }), option.icon);
                else chip.createSpan({ cls: 'atoz-record-dot' });
                chip.createSpan({ text: option.label });
                const isActive = editing.choice === option.label;
                chip.toggleClass('is-active', isActive);
                chip.setAttr('aria-pressed', String(isActive));
                // 최근 메뉴·항목이 종류에 따라 바뀌므로 다시 그린다.
                chip.addEventListener('click', () => {
                    editing.choice = option.label;
                    this.render();
                });
            }
        }

        if (record.note !== null) {
            const box = field(record.noteLabel);
            const noteInput = box.createEl('input', {
                cls: 'atoz-record-note-input',
                type: 'text',
                attr: { placeholder: record.noteLabel, 'aria-label': record.noteLabel },
            });
            noteInput.value = editing.note;
            noteInput.addEventListener('input', () => { editing.note = noteInput.value; });
            inputs.push(noteInput);
            const recent = record.recentNotes?.(editing.choice) ?? [];
            if (recent.length > 0) {
                const chips = box.createDiv({ cls: 'atoz-record-chips' });
                for (const value of recent) {
                    const chip = chips.createEl('button', { cls: 'atoz-record-chip', text: value });
                    chip.toggleClass('is-active', editing.note === value);
                    // 키보드를 띄우지 않고 값만 넣는다.
                    chip.addEventListener('click', () => {
                        editing.note = value;
                        noteInput.value = value;
                        chips.querySelectorAll('.atoz-record-chip').forEach((el) => el.toggleClass('is-active', el === chip));
                    });
                }
            }
        }

        if (record.amount) {
            const box = field(t('record.amountPayment'));
            const amountInput = box.createEl('input', { cls: 'atoz-record-amount-input', type: 'text', attr: { 'aria-label': t('budget.amount') } });
            amountInput.inputMode = 'numeric';
            amountInput.value = editing.amount;
            amountInput.addEventListener('input', () => { editing.amount = amountInput.value; });
            inputs.push(amountInput);
            const payments = this.plugin.settings.budgetPayments;
            if (payments.length > 0) {
                const group = box.createDiv({ cls: 'atoz-record-amount-payments', attr: { role: 'group', 'aria-labelledby': labelOf(box) } });
                for (const name of payments) {
                    const button = group.createEl('button', { cls: 'atoz-record-amount-payment', text: name });
                    const sync = (): void => {
                        group.querySelectorAll('button').forEach((el) => {
                            el.toggleClass('is-active', el.textContent === editing.payment);
                            el.setAttr('aria-pressed', String(el.textContent === editing.payment));
                        });
                    };
                    button.addEventListener('click', () => {
                        editing.payment = name;
                        sync();
                    });
                    button.toggleClass('is-active', editing.payment === name);
                    button.setAttr('aria-pressed', String(editing.payment === name));
                }
            }
        }

        const stepper = (label: string, get: () => string, set: (value: string) => void): void => {
            const box = field(label).createDiv({ cls: 'atoz-record-stepper' });
            const minus = box.createEl('button', { text: t('record.minus5') });
            const input = box.createEl('input', { cls: 'atoz-daynight-time-input', type: 'time', attr: { 'aria-label': label } });
            const plus = box.createEl('button', { text: t('record.plus5') });
            input.value = get();
            const change = (value: string): void => {
                set(value);
                input.value = value;
                editing.error = undefined;
                error.setText('');
            };
            input.addEventListener('input', () => change(input.value));
            minus.addEventListener('click', () => change(shiftClock(get(), -5)));
            plus.addEventListener('click', () => change(shiftClock(get(), 5)));
            inputs.push(input);
        };
        const hasEnd = record.end !== undefined;
        stepper(hasEnd ? t('record.startLabel') : t('record.timeLabel'), () => editing.time, (value) => { editing.time = value; });
        if (hasEnd) stepper(t('record.endLabel'), () => editing.end, (value) => { editing.end = value; });

        // 지금보다 뒤로 고치거나 값이 틀리면 아래에 알린다.
        const error = editor.createDiv({ cls: 'atoz-record-edit-error', text: editing.error ?? '', attr: { role: 'alert' } });
        const foot = editor.createDiv({ cls: 'atoz-record-editor-foot' });
        if (record.deletable) {
            const remove = foot.createEl('button', { cls: 'atoz-record-delete', text: t('record.delete') });
            remove.addEventListener('click', () => {
                this.editing = null;
                void this.lock('delete', async () => {
                    await record.remove();
                    this.showToast(t('record.toast.deleted'), [this.undo(() => record.restore())], false);
                });
            });
        }
        const done = foot.createEl('button', { cls: 'mod-cta atoz-record-done', text: t('record.done') });
        done.addEventListener('click', () => {
            this.commitEdit();
            this.render();
        });

        // Enter는 저장하고 닫고, Esc는 고친 값을 버리고 닫는다.
        for (const input of inputs) {
            input.addEventListener('keydown', (event) => {
                if (event.isComposing || event.key !== 'Enter') return;
                event.preventDefault();
                this.commitEdit();
                this.render();
            });
        }
        editor.addEventListener('keydown', (event) => {
            if (event.isComposing || event.key !== 'Escape') return;
            event.preventDefault();
            this.editing = null;
            this.render();
        });
        // 서랍을 닫거나 다른 곳을 누르면 고친 값을 저장한다. 다른 줄을 누른 경우는 그 줄이 저장한다.
        editor.addEventListener('focusout', (event) => {
            if (this.isRendering) return;
            const next = event.relatedTarget;
            if (next instanceof HTMLElement && (editor.contains(next) || next.closest('.atoz-record-head, .menu'))) return;
            if (this.editing?.record.key !== record.key) return;
            this.commitEdit();
            // 패널 안의 버튼으로 옮겨 갔으면 그 클릭이 사라지지 않게 지금 다시 그리지 않는다. 다음에 그릴 때 닫힌다.
            if (!(next instanceof Node && this.containerEl.contains(next))) this.render();
        });
    }

    /** 고친 값이 있으면 저장하고 고치기를 닫는다. 값이 틀리면 저장하지 않고 연 채 오류를 남기고 false를 돌려준다. */
    private commitEdit(): boolean {
        const editing = this.editing;
        if (!editing) return true;
        const { record } = editing;
        const time = this.readClock(record.time, editing.time);
        const end = record.end === undefined ? null : this.readClock(record.end, editing.end);
        const note = editing.note.trim();
        const amount = record.amount ? parseAmount(editing.amount.trim()) : null;
        if (record.amount && amount === null) {
            editing.error = t('budget.notice.amountRequired');
            return false;
        }
        if (time > Date.now() || (end !== null && end > Date.now())) {
            editing.error = t('daynight.editFuture');
            return false;
        }
        if (end !== null && end <= time) {
            editing.error = t('record.editEndBeforeStart');
            return false;
        }
        this.editing = null;
        const isSame = time === record.time && note === (record.note ?? '') && editing.choice === (record.choices?.value ?? '')
            && end === (record.end ?? null)
            && (!record.amount || (amount === record.amount.value && editing.payment === record.amount.payment));
        if (isSame) return true;
        void record.save({ time, note, choice: editing.choice, amount, payment: editing.payment, end }).then(() => this.render());
        return true;
    }

    // 'HH:MM'을 base가 속한 하루 안의 시각으로 읽는다. 읽을 수 없으면 base 그대로다.
    private readClock(base: number, value: string): number {
        const match = /^(\d{2}):(\d{2})$/.exec(value);
        return match ? this.timeInDay(base, Number(match[1]), Number(match[2])) : base;
    }

    // 하루가 05시에 시작하면 00:30 기록을 23:50으로 고칠 때 그 전날 23:50이다. 하루 시작 시각보다 이르면 다음 날로 읽는다.
    private timeInDay(recordTime: number, hour: number, minute: number): number {
        const startHour = this.plugin.settings.timelineDayStartHour;
        const day = new Date(recordTime - startHour * HOUR);
        return new Date(day.getFullYear(), day.getMonth(), day.getDate() + (hour < startHour ? 1 : 0), hour, minute).getTime();
    }

    // '잘 시간이에요 · 평소 00:30 · 10분 남음 [지금 자기]'
    private renderBedtime(container: HTMLElement, now: number): void {
        const bedtime = this.plugin.daynight.usualBedtime(now);
        if (bedtime === null) return;
        const band = container.createDiv({ cls: 'atoz-record-bedtime' });
        const text = band.createDiv({ cls: 'atoz-record-bedtime-text' });
        text.createDiv({ cls: 'atoz-record-bedtime-title', text: t('record.bedtime') });
        const date = new Date(now);
        let diff = (date.getHours() * 60 + date.getMinutes()) * 60 * 1000 - bedtime;
        if (diff < -DAY / 2) diff += DAY;
        else if (diff >= DAY / 2) diff -= DAY;
        const minutes = Math.round(bedtime / 60000);
        text.createDiv({
            text: t(diff < 0 ? 'record.bedtimeLeft' : 'record.bedtimePast', {
                time: `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`,
                duration: formatDuration(Math.abs(diff)),
            }),
        });
        const button = band.createEl('button', { cls: 'atoz-record-bedtime-button', attr: { 'data-lock': 'sleep' } });
        setIcon(button, 'moon');
        button.createSpan({ text: t('daynight.sleepNow') });
        button.addEventListener('click', () => void this.lock('sleep', () => this.toggleSleep()));
    }

    // 묶음 하나: 이름 줄(왼쪽 이름, 오른쪽 오늘 합계)과 4칸 격자. 고를 것은 가로로 숨기지 않고 모두 보인다.
    private tiles(container: HTMLElement, title: string, summary: string): HTMLElement {
        const section = container.createDiv({ cls: 'atoz-record-section' });
        const cap = section.createDiv({ cls: 'atoz-record-section-title' });
        cap.createSpan({ text: title });
        if (summary) cap.createSpan({ cls: 'atoz-record-section-sum', text: summary });
        return section.createDiv({ cls: 'atoz-record-tiles' });
    }

    // 아이콘(없으면 색 점) 위, 이름 아래.
    private tile(
        parent: HTMLElement,
        text: string,
        color: MealColor | null | undefined,
        icon: string | null,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = parent.createEl('button', { cls: 'atoz-record-tile' });
        applyColor(button, color);
        if (icon) setIcon(button.createSpan({ cls: 'atoz-record-tile-icon' }), icon);
        else button.createSpan({ cls: 'atoz-record-dot' });
        button.createSpan({ cls: 'atoz-record-tile-name', text });
        button.addEventListener('click', onClick);
        return button;
    }

    // 금액 칸은 그 칸을 연 묶음 바로 아래에 연다.
    private renderSpending(container: HTMLElement, todayStart: number): void {
        const categories = this.plugin.settings.budgetPanelCategories;
        if (categories.length === 0) return;
        const spent = this.budgetRecords
            .filter(({ kind, entry }) => kind === 'expense' && entryTime(entry) >= todayStart)
            .reduce((sum, { entry }) => sum + entry.amount, 0);
        const tiles = this.tiles(container, t('record.spending'), spent > 0 ? t('record.todaySpent', { amount: `−${formatAmount(spent)}` }) : '');
        for (const category of categories) {
            const button = this.tile(tiles, category, null, SPENDING_ICONS[category] ?? 'wallet', () => {
                this.openAmount({ category, meal: null });
            });
            // 금액 칸이 열린다는 표시
            button.createSpan({ cls: 'atoz-record-tile-won', text: '₩' });
            const isOpen = this.amountTarget?.category === category && this.amountTarget.meal === null;
            button.toggleClass('is-open', isOpen);
            button.setAttr('aria-expanded', String(isOpen));
        }
        if (this.amountTarget?.meal === null) this.renderAmountForm(container, this.amountTarget);
    }

    // 첫 범례(집밥)는 바로 기록하고, 나머지(배달·외식·간식)는 금액 칸을 함께 연다.
    private renderMeals(container: HTMLElement, todayStart: number): void {
        const settings = this.plugin.settings;
        if (settings.mealLegend.length === 0) return;
        const count = this.plugin.meal.records.filter((meal) => meal.time >= todayStart).length;
        const tiles = this.tiles(container, t('record.meal'), count > 0 ? t('record.todayMeals', { count }) : '');
        for (const [index, item] of settings.mealLegend.entries()) {
            const hasAmount = index > 0;
            const key = `meal:${item.label}`;
            const button = this.tile(tiles, item.label, this.plugin.meal.colorOf(item.color), mealIcon(item.icon), () => {
                if (hasAmount) this.openAmount({ category: item.label, meal: item });
                else void this.lock(key, () => this.recordMeal(item, null));
            });
            if (hasAmount) {
                // 바로 기록하는 집밥과 달리 금액 칸이 열린다는 표시
                button.createSpan({ cls: 'atoz-record-tile-won', text: '₩' });
                button.setAttr('aria-expanded', String(this.amountTarget?.meal === item));
            } else {
                button.dataset.lock = key;
            }
            button.toggleClass('is-open', this.amountTarget?.meal === item);
        }
        if (this.amountTarget?.meal) this.renderAmountForm(container, this.amountTarget);
    }

    // 진행 중 칸을 다시 누르면 그 활동이 끝난다. 맨 끝 '+ 블록' 칸은 메인 탭에 계획 페이지를 연다.
    // 블록이 7개를 넘으면 오늘 계획에 있는 블록, 그다음 최근에 한 블록 순으로 7개만 두고 '전체' 칸에서 나머지를 고른다.
    private renderActivities(container: HTMLElement, todayStart: number, now: number): void {
        const timeline = this.plugin.timeline;
        // 이름 줄에는 오늘 오래 한 활동 둘의 합계를 적는다.
        const totals = new Map<string, number>();
        for (const block of timeline.segments(now)) {
            const length = Math.min(block.to, now) - Math.max(block.from, todayStart);
            if (length > 0) totals.set(block.category, (totals.get(block.category) ?? 0) + length);
        }
        const summary = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 2)
            .map(([name, length]) => `${name} ${formatClockDuration(length)}`).join(' · ');
        const tiles = this.tiles(container, t('timeline.viewName'), summary);
        tiles.addClass('is-activity');

        const current = timeline.current();
        let shown = timeline.blocks;
        let rest: string[] = [];
        if (shown.length > MAX_ACTIVITY_TILES - 1) {
            const planned = new Set(timeline.plans.filter((plan) => plan.to > todayStart && plan.from < todayStart + DAY).map((plan) => plan.category));
            const recent = new Map<string, number>();
            for (const log of timeline.logs) recent.set(log.category, log.time);
            // 진행 중 활동은 늘 보이게 맨 앞에 둔다.
            const rank = (name: string): number => (name === current?.category ? 4 * now : 0)
                + (planned.has(name) ? 2 * now : 0) + (recent.get(name) ?? 0);
            const order = [...shown].sort((a, b) => rank(b) - rank(a));
            shown = order.slice(0, MAX_ACTIVITY_TILES - 1);
            rest = order.slice(MAX_ACTIVITY_TILES - 1);
        }
        for (const name of shown) {
            const isCurrent = current?.category === name;
            const key = `activity:${name}`;
            // 진행 중이면 색을 채우고 점 대신 체크와 경과를 둔다. 색이 없으면 강조색이다.
            const color = timeline.colorOf(name) ?? (isCurrent ? ACCENT_COLOR : null);
            const button = this.tile(tiles, name, color, null, () => {
                void this.lock(key, () => this.toggleActivity(name));
            });
            button.dataset.lock = key;
            button.toggleClass('is-active', isCurrent);
            button.setAttr('aria-pressed', String(isCurrent));
            if (current && isCurrent) {
                const elapsed = createSpan({ cls: 'atoz-record-elapsed' });
                setIcon(elapsed.createSpan(), 'check');
                elapsed.createSpan({ text: formatClockDuration(now - current.time) });
                button.querySelector('.atoz-record-dot')?.replaceWith(elapsed);
            }
        }
        if (rest.length > 0) {
            const all = this.tile(tiles, t('record.allActivities'), null, 'more-horizontal', () => undefined);
            all.addEventListener('click', () => {
                const menu = new Menu();
                for (const name of rest) {
                    menu.addItem((item) => item.setTitle(name).onClick(() => void this.lock(`activity:${name}`, () => this.toggleActivity(name))));
                }
                // 키보드로 눌러도 칸 옆에 뜨게 칸 위치에 띄운다.
                const { left, top } = all.getBoundingClientRect();
                menu.showAtPosition({ x: left, y: top });
            });
            return;
        }
        const add = this.tile(tiles, t('record.block'), null, 'plus', () => void this.plugin.dashboard.open('plan'));
        add.addClass('is-add');
        add.setAttr('aria-label', t('record.addActivity'));
    }

    private openAmount(target: AmountTarget): void {
        const isSame = this.amountTarget?.category === target.category && this.amountTarget.meal === target.meal;
        this.amountTarget = isSame ? null : target;
        this.amountDraft = '';
        this.amountTitle = '';
        this.amountError = '';
        this.amountPayment = this.plugin.settings.budgetLastPayment;
        this.shouldFocusAmount = true;
        this.render();
    }

    // 금액 시트: 머리(아이콘·이름·지금·닫기), 큰 금액 칸, 최근 금액, 결제 수단, 항목(지출만), 내용이 적힌 기록 버튼.
    // 휴대폰은 아래 묶음을 대신하는 시트, PC는 아래 묶음 위에 겹쳐 뜨는 카드라 목록 높이가 그대로다.
    private renderAmountForm(container: HTMLElement, target: AmountTarget): void {
        const settings = this.plugin.settings;
        const sheet = container.createDiv({ cls: 'atoz-record-amount' });
        const head = sheet.createDiv({ cls: 'atoz-record-amount-head' });
        const icon = target.meal ? mealIcon(target.meal.icon) : SPENDING_ICONS[target.category] ?? 'wallet';
        setIcon(head.createSpan({ cls: 'atoz-record-amount-icon' }), icon);
        head.createSpan({ cls: 'atoz-record-amount-title', text: target.category });
        // 시각은 늘 지금이다. 고치려면 남긴 뒤 [고치기].
        head.createSpan({ cls: 'atoz-record-amount-now', text: t('record.amountNow', { time: formatTime(Date.now()) }) });
        this.addRecordAction(head, 'x', t('record.close'), () => {
            this.amountTarget = null;
            this.render();
        });

        const input = sheet.createEl('input', { type: 'text', cls: 'atoz-budget-amount-input' });
        // 원은 소수점이 없어 숫자 키패드를 쓴다. 다른 통화는 소수점이 있는 키패드다('numeric'은 iOS에서 소수점이 없다).
        const isWon = settings.budgetCurrencySuffix.trim() === '원' || settings.budgetCurrencyPrefix.trim() === '₩';
        input.inputMode = isWon ? 'numeric' : 'decimal';
        input.placeholder = target.meal ? t('record.amountOptional') : t('budget.amount');
        input.setAttr('aria-label', t('budget.amount'));
        input.value = this.amountDraft;
        const error = sheet.createDiv({ cls: 'atoz-record-amount-error', text: this.amountError, attr: { role: 'alert' } });
        input.toggleClass('is-invalid', this.amountError !== '');

        // 그 카테고리에서 최근에 쓴 금액. 누르면 금액만 채우고 키보드는 띄우지 않는다. 기록은 아래 버튼으로 한다.
        const recent = this.recentAmounts(target.category);
        if (recent.length > 0) {
            const chips = sheet.createDiv({ cls: 'atoz-record-chips' });
            const label = chips.createSpan({ cls: 'atoz-record-field-label', text: t('record.recent') });
            for (const amount of recent) {
                const chip = chips.createEl('button', { cls: 'atoz-record-chip atoz-record-amount-chip', text: formatWon(amount) });
                chip.dataset.amount = String(amount);
                chip.setAttr('aria-describedby', labelId(label));
                chip.addEventListener('click', () => {
                    input.value = String(amount);
                    sync();
                });
            }
        }

        // 결제 수단은 이름이 보이는 분할 버튼이다. 기본은 지난번에 쓴 것이다.
        const payments = settings.budgetPayments;
        if (payments.length > 0) {
            const group = sheet.createDiv({ cls: 'atoz-record-amount-payments', attr: { role: 'group' } });
            for (const name of payments) {
                const button = group.createEl('button', { cls: 'atoz-record-amount-payment', text: name });
                const isSelected = this.amountPayment === name;
                button.toggleClass('is-active', isSelected);
                button.setAttr('aria-pressed', String(isSelected));
                // 고른 것을 다시 눌러도 풀리지 않는다.
                button.addEventListener('click', () => {
                    this.amountPayment = name;
                    group.querySelectorAll('button').forEach((el) => {
                        el.toggleClass('is-active', el.textContent === this.amountPayment);
                        el.setAttr('aria-pressed', String(el.textContent === this.amountPayment));
                    });
                });
            }
        }

        // 항목은 비워도 된다. 최근 항목을 누르면 키보드 없이 들어간다. 식사의 메뉴는 남긴 뒤 [고치기]에서 쓴다.
        const inputs = [input];
        if (!target.meal) {
            const field = sheet.createDiv({ cls: 'atoz-record-field' });
            const label = field.createDiv({ cls: 'atoz-record-field-label', text: t('record.itemOptional') });
            const titleInput = field.createEl('input', {
                type: 'text',
                cls: 'atoz-record-amount-title-input',
                attr: { placeholder: t('record.itemPrompt'), 'aria-labelledby': labelId(label) },
            });
            titleInput.value = this.amountTitle;
            inputs.push(titleInput);
            const titles = this.recentTitles(target.category).slice(0, 3);
            const chips = titles.length > 0 ? field.createDiv({ cls: 'atoz-record-chips' }) : null;
            const syncTitle = (): void => {
                chips?.querySelectorAll('.atoz-record-chip').forEach((el) => el.toggleClass('is-active', el.textContent === this.amountTitle));
            };
            titleInput.addEventListener('input', () => {
                this.amountTitle = titleInput.value;
                syncTitle();
            });
            for (const title of titles) {
                const chip = chips!.createEl('button', { cls: 'atoz-record-chip', text: title });
                chip.addEventListener('click', () => {
                    this.amountTitle = title;
                    titleInput.value = title;
                    syncTitle();
                });
            }
            syncTitle();
        }

        const submit = sheet.createEl('button', { cls: 'mod-cta atoz-record-amount-submit' });
        submit.addEventListener('click', () => void this.submitAmount());
        // 기록 버튼에 무엇이 남는지 적고, 같은 금액의 최근 칩을 고른 것으로 보인다.
        const sync = (): void => {
            this.amountDraft = input.value;
            const amount = parseAmount(input.value.trim());
            sheet.querySelectorAll<HTMLElement>('.atoz-record-amount-chip').forEach((el) => {
                el.toggleClass('is-active', amount !== null && el.dataset.amount === String(amount));
            });
            submit.setText(amount !== null
                ? t('record.submitAmount', { category: target.category, amount: formatWon(amount) })
                : target.meal && input.value.trim() === '' ? t('record.mealOnly') : t('record.submit'));
        };
        sync();
        input.addEventListener('input', () => {
            this.amountError = '';
            error.setText('');
            input.removeClass('is-invalid');
            sync();
        });
        for (const el of inputs) {
            el.addEventListener('keydown', (event) => {
                if (event.isComposing) return;
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void this.submitAmount();
                } else if (event.key === 'Escape') {
                    this.amountTarget = null;
                    this.render();
                }
            });
        }
        // 최근 금액이 있으면 칩으로 고르게 하고 키보드를 띄우지 않는다.
        const shouldFocus = this.shouldFocusAmount && recent.length === 0;
        this.shouldFocusAmount = false;
        window.setTimeout(() => {
            if (shouldFocus) input.focus();
            sheet.scrollIntoView({ block: 'nearest' });
        }, 0);
    }

    /** 그 카테고리에서 최근에 쓴 항목. 같은 항목은 한 번만, 최대 네 개. */
    private recentTitles(category: string): string[] {
        const titles = this.budgetRecords
            .filter(({ kind, entry }) => kind === 'expense' && entry.category === category && entry.title)
            .sort((a, b) => entryTime(b.entry) - entryTime(a.entry))
            .map(({ entry }) => entry.title);
        return [...new Set(titles)].slice(0, 4);
    }

    /** 그 카테고리의 최근 지출 금액. 같은 금액은 한 번만, 최대 세 개. */
    private recentAmounts(category: string): number[] {
        const amounts = this.budgetRecords
            .filter(({ kind, entry }) => kind === 'expense' && entry.category === category)
            .sort((a, b) => entryTime(b.entry) - entryTime(a.entry))
            .map(({ entry }) => entry.amount);
        return [...new Set(amounts)].slice(0, 3);
    }

    // 식사에서 연 금액 칸은 비워도 된다(얻어먹었을 때). 그때는 식사만 남긴다.
    private async submitAmount(): Promise<void> {
        const target = this.amountTarget;
        if (!target) return;
        const raw = this.amountDraft.trim();
        const amount = raw.length === 0 ? null : parseAmount(raw);
        if ((raw.length > 0 && amount === null) || (amount === null && target.meal === null)) {
            this.amountError = t('budget.notice.amountRequired');
            this.render();
            return;
        }
        this.amountTarget = null;
        this.render();
        if (target.meal) {
            await this.recordMeal(target.meal, amount);
            return;
        }
        const spent = await this.plugin.budget.recordNow('expense', target.category, amount!, this.amountPayment, this.amountTitle.trim());
        if (!spent) return;
        this.showToast(
            t('record.toast.spent', { category: target.category, amount: formatWon(amount!) }),
            [this.editSpending(spent), this.undo(() => this.plugin.budget.deleteRecord(spent))],
        );
    }

    // 식사를 남기고 토스트에서 메뉴를 쓰거나 되돌린다. 금액이 있으면 같은 이름의 지출도 함께 남기고 함께 되돌린다.
    private async recordMeal(item: MealLegendItem, amount: number | null): Promise<void> {
        const now = Date.now();
        const meal = await this.plugin.meal.add(now, '', item);
        const spent = amount === null ? null : await this.plugin.budget.recordNow('expense', item.label, amount, this.amountPayment);
        if (!meal) return;
        let text = t('record.toast.meal', { meal: item.label, time: formatTime(now) });
        if (spent) text += ` · ${formatWon(amount!)}`;
        this.showToast(text, [
            this.editAction(mealKey(meal), meal.time),
            this.undo(async () => {
                await this.plugin.meal.replace(meal, null, '');
                if (spent) await this.plugin.budget.deleteRecord(spent);
            }),
        ]);
    }

    // 누른 순간의 상태로 시작과 끝을 고른다. 그린 뒤 상태가 바뀌었어도 두 번 시작하지 않는다.
    private async toggleActivity(name: string): Promise<void> {
        const now = Date.now();
        const current = this.plugin.timeline.current();
        const isEnd = current?.category === name;
        const log = await this.plugin.timeline.addLog(now, isEnd ? END_CATEGORY : name);
        if (!log) return;
        this.showToast(
            isEnd
                ? t('record.toast.ended', { activity: name, duration: formatDuration(now - current.time) })
                : t('record.toast.started', { activity: name, time: formatTime(now) }),
            // 끝냈으면 [고치기]는 끝낸 활동 줄을 연다(끝 시각을 고친다).
            [isEnd ? this.editAction(logKey(current), current.time) : this.editAction(logKey(log), log.time), this.undoLogs([log])],
        );
    }

    /** 명령에서 부른다. 패널 버튼처럼 잠그고 되돌리기 토스트를 띄운다. */
    runToggleSleep(): Promise<void> {
        return this.lock('sleep', () => this.toggleSleep());
    }

    runEndActivity(): Promise<void> {
        const current = this.plugin.timeline.current();
        if (!current) {
            new Notice(t('record.noActivity'));
            return Promise.resolve();
        }
        return this.lock(`activity:${current.category}`, () => this.toggleActivity(current.category));
    }

    // 잠들면 하던 활동도 끝낸다.
    private async toggleSleep(): Promise<void> {
        const now = Date.now();
        const isAsleep = this.lastSleep()?.type === 'sleep';
        const current = isAsleep ? null : this.plugin.timeline.current();
        const ended = current ? await this.plugin.timeline.addLog(now, END_CATEGORY) : undefined;
        if (!await this.plugin.daynight.toggle()) return;
        const text = isAsleep ? t('record.toast.woke', { time: formatTime(now) })
            : current ? t('record.toast.sleptEnded', { activity: current.category })
                : t('record.toast.slept', { time: formatTime(now) });
        // 깨면 [고치기]는 잠과 기상을 함께 보인 잠 줄을 연다.
        const records = this.plugin.daynight.records;
        const last = records[records.length - 1];
        const before = records[records.length - 2];
        const record = last?.type === 'wake' && before?.type === 'sleep' ? before : last;
        this.showToast(text, record ? [this.editAction(sleepKey(record), record.time), this.undoSleep(ended)] : [this.undoSleep(ended)]);
    }

    // 끊긴 구간은 기록 없음으로 두고 지금부터 깨어 있는 것으로 센다. 그동안 켜져 있던 활동도 끝낸다.
    private async restart(): Promise<void> {
        const now = Date.now();
        const ended = this.plugin.timeline.current() ? await this.plugin.timeline.addLog(now, END_CATEGORY) : undefined;
        if (!await this.plugin.daynight.add('wake')) return;
        this.showToast(t('record.toast.restarted', { time: formatTime(now) }), [this.undoSleep(ended)]);
    }

    // 방금 더한 수면 기록과, 함께 끝낸 활동이 있으면 그 줄도 지운다.
    private undoSleep(ended: LogRecord | undefined): ToastAction {
        return this.undo(async () => {
            await this.plugin.daynight.deleteLast();
            if (ended) await this.plugin.timeline.replaceLog(ended, null, '');
        });
    }

    private undoLogs(logs: LogRecord[]): ToastAction {
        return this.undo(async () => {
            for (const log of logs) await this.plugin.timeline.replaceLog(log, null, '');
        });
    }

    private undo(run: () => Promise<unknown>): ToastAction {
        return { label: t('record.undo'), run };
    }

    private showToast(text: string, actions: ToastAction[], isFresh = true): void {
        if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
        this.scrollToEnd = true;
        this.toast = { text, actions };
        this.isToastFresh = isFresh;
        this.toastTimer = window.setTimeout(() => {
            this.toastTimer = null;
            this.toast = null;
            this.render();
        }, TOAST_DURATION);
        this.render();
    }

    // 수면 버튼 바로 위, 엄지가 닿는 자리에 둔다.
    private renderToast(container: HTMLElement, toast: { text: string; actions: ToastAction[] }): void {
        const el = container.createDiv({ cls: 'atoz-record-toast', attr: { role: 'status' } });
        el.createSpan({ cls: 'atoz-record-toast-text', text: toast.text });
        for (const action of toast.actions) {
            const button = el.createEl('button', { cls: 'atoz-record-toast-action', text: action.label });
            button.addEventListener('click', () => {
                if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
                this.toastTimer = null;
                this.toast = null;
                this.render();
                void action.run();
            });
        }
    }

    // 쓰기가 끝나고 PILL_LOCK이 지날 때까지 같은 버튼을 다시 눌러도 무시한다.
    private async lock(key: string, action: () => Promise<void>): Promise<void> {
        if (this.pending.has(key)) return;
        this.pending.add(key);
        this.syncPending();
        try {
            await Promise.all([action(), new Promise((resolve) => window.setTimeout(resolve, PILL_LOCK))]);
        } finally {
            this.pending.delete(key);
            this.syncPending();
        }
    }

    // 다시 그려도 쓰는 중인 버튼은 눌린 모양을 유지한다.
    private syncPending(): void {
        this.containerEl.querySelectorAll<HTMLElement>('[data-lock]').forEach((el) => {
            const isPending = this.pending.has(el.dataset.lock ?? '');
            el.toggleClass('is-pending', isPending);
            if (isPending) el.setAttr('aria-busy', 'true');
            else el.removeAttribute('aria-busy');
        });
    }

    private addRecordAction(row: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
        const button = row.createEl('button', { cls: 'atoz-daynight-action', attr: { 'aria-label': label } });
        setIcon(button, icon);
        button.addEventListener('click', (evt) => {
            evt.stopPropagation();
            onClick(evt);
        });
        return button;
    }
}

export class DaynightFeature {
    records: DaynightRecord[] = [];
    // 파일 경로별로 읽어 둔 기록. 바뀐 파일만 다시 읽어 바꿔 끼운다.
    private fileRecords = new Map<string, DaynightRecord[]>();
    private reloadTimer: number | null = null;
    private pendingPaths = new Set<string>();
    private isFullReloadPending = false;
    // 읽기를 한 줄로 세워, 늦게 끝난 이전 읽기가 새 결과를 덮어쓰지 않게 한다.
    private loadQueue: Promise<void> = Promise.resolve();
    private isWriting = false;

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.registerView(VIEW_TYPE_DAYNIGHT, (leaf) => new DaynightView(leaf, this.plugin));

        this.plugin.addCommand({
            id: 'open-daynight-view',
            name: t('command.openDaynightView'),
            callback: () => void this.activateView(),
        });

        this.plugin.addCommand({
            id: 'open-daynight-dashboard',
            name: t('command.openDaynightDashboard'),
            callback: () => void this.plugin.dashboard.open('daynight'),
        });

        // 패널의 자주 쓰는 동작에 단축키를 걸 수 있게 한다. 패널을 열어 되돌리기 토스트가 보이게 한다.
        this.plugin.addCommand({
            id: 'toggle-sleep',
            name: t('command.toggleSleep'),
            callback: () => void this.withView((view) => view.runToggleSleep()),
        });
        this.plugin.addCommand({
            id: 'end-activity',
            name: t('command.endActivity'),
            callback: () => void this.withView((view) => view.runEndActivity()),
        });

        this.plugin.app.workspace.onLayoutReady(() => {
            const vault = this.plugin.app.vault;
            this.plugin.registerEvent(vault.on('create', (file) => this.onFileEvent(file)));
            this.plugin.registerEvent(vault.on('modify', (file) => this.onFileEvent(file)));
            this.plugin.registerEvent(vault.on('delete', (file) => this.onFileEvent(file)));
            this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
                if (this.isRecordPath(oldPath)) this.scheduleReload(oldPath);
                this.onFileEvent(file);
            }));
            void this.enqueue(() => this.loadAll());
        });
    }

    uninstall(): void {
        if (this.reloadTimer !== null) {
            window.clearTimeout(this.reloadTimer);
            this.reloadTimer = null;
        }
    }

    // 입력할 때마다 바뀌므로 잠시 기다렸다가 새 폴더를 읽는다.
    settingsChanged(): void {
        this.scheduleReload();
    }

    /** 패널을 열고 그 기록의 고치기를 연다. */
    async openEditor(key: string, time: number): Promise<void> {
        // 막 연 패널은 가계부를 아직 읽지 않았을 수 있다. 짝 지출의 금액이 칸에 들어가도록 먼저 읽는다.
        await this.withView(async (view) => {
            await view.reloadBudget();
            view.openEditor(key, time);
        });
    }

    private async withView(run: (view: DaynightView) => Promise<void>): Promise<void> {
        await this.activateView();
        const view = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DAYNIGHT)[0]?.view;
        if (view instanceof DaynightView) await run(view);
    }

    async activateView(): Promise<void> {
        const existing = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DAYNIGHT);
        if (existing.length > 0) {
            void this.plugin.app.workspace.revealLeaf(existing[0]!);
            return;
        }

        const leaf = this.plugin.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: VIEW_TYPE_DAYNIGHT, active: true });
        void this.plugin.app.workspace.revealLeaf(leaf);
    }

    /** 수면 기록을 구간으로 나누고, 너무 긴 구간은 식사·활동 기록(과 extraEvents)을 보고 '기록 없음'을 가른다. */
    segments(now: number, extraEvents: number[] = []): DaynightSegment[] {
        const events = [
            ...this.plugin.meal.records.map((meal) => meal.time),
            ...this.plugin.timeline.logs.map((log) => log.time),
            ...extraEvents,
        ];
        return splitGaps(toSegments(this.records, now), events);
    }

    /** 끝난 잠을 주된 잠(3시간 넘음)과 낮잠으로 나눈다. 평소 잘 시각과 같은 기준이다. */
    finishedSleeps(now: number): { main: DaynightSegment[]; naps: DaynightSegment[] } {
        const sleeps = this.segments(now).slice(0, -1).filter(({ type }) => type === 'sleep');
        return {
            main: sleeps.filter(({ from, to }) => to - from > MAIN_SLEEP),
            naps: sleeps.filter(({ from, to }) => to - from <= MAIN_SLEEP),
        };
    }

    /** dayStart 전 7일 동안 끝난 주된 잠의 평균 길이. 홈 숫자와 수면 줄이 같이 쓴다. 없으면 null이다. */
    usualSleep(dayStart: number, now: number): number | null {
        const week = this.finishedSleeps(now).main
            .filter(({ to }) => to <= dayStart && to > dayStart - BEDTIME_DAYS * DAY)
            .map(({ from, to }) => to - from);
        return week.length > 0 ? week.reduce((sum, value) => sum + value, 0) / week.length : null;
    }

    /** 지난 7일 잠든 시각의 평균(자정부터 ms). 자정 앞뒤의 시각을 함께 평균내려고 시계를 원으로 보고 더한다. */
    usualBedtime(now: number): number | null {
        let x = 0;
        let y = 0;
        this.records.forEach((record, index) => {
            const next = this.records[index + 1];
            if (record.type !== 'sleep' || record.time < now - BEDTIME_DAYS * DAY || !next || next.time - record.time < MAIN_SLEEP) return;
            const date = new Date(record.time);
            const angle = (date.getHours() * 60 + date.getMinutes()) / (24 * 60) * 2 * Math.PI;
            x += Math.cos(angle);
            y += Math.sin(angle);
        });
        if (x === 0 && y === 0) return null;
        return (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1 * DAY;
    }

    /** 평소 잘 시각 무렵인가. 평소 잘 시각을 모르면 아니라고 본다. */
    isBedtime(now: number): boolean {
        const bedtime = this.usualBedtime(now);
        if (bedtime === null) return false;
        const date = new Date(now);
        let diff = (date.getHours() * 60 + date.getMinutes()) * 60 * 1000 - bedtime;
        if (diff < -DAY / 2) diff += DAY;
        else if (diff >= DAY / 2) diff -= DAY;
        return diff >= -BEDTIME_BEFORE && diff < BEDTIME_AFTER;
    }

    async toggle(): Promise<boolean> {
        const last = this.records[this.records.length - 1];
        return await this.add(last?.type === 'sleep' ? 'wake' : 'sleep');
    }

    /** 지금 시각으로 한 줄을 더한다. 다른 쓰기가 진행 중이라 쓰지 않았으면 false다. */
    async add(type: DaynightType): Promise<boolean> {
        const now = new Date();
        const row = formatRow(now, type);
        const folder = this.getFolder();
        const path = normalizePath(`${folder}/sleep-${now.getFullYear()}-${pad(now.getMonth() + 1)}.md`);

        return await this.write(path, async () => {
            const vault = this.plugin.app.vault;
            if (!vault.getFolderByPath(folder)) await vault.createFolder(folder);
            const file = vault.getFileByPath(path);
            if (file) {
                await vault.process(file, (data) =>
                    (data === '' || data.endsWith('\n') ? data : data + '\n') + row + '\n');
            } else {
                await vault.create(path, TABLE_HEADER + row + '\n');
            }
        });
    }

    async deleteLast(): Promise<void> {
        await this.replaceLast(() => null);
    }

    /** 지운 마지막 기록을 원래 파일 끝에 다시 붙인다. */
    async restore(record: DaynightRecord): Promise<void> {
        await this.write(record.file.path, () => this.plugin.app.vault.process(record.file, (data) =>
            (data === '' || data.endsWith('\n') ? data : data + '\n') + record.line + '\n'));
    }

    /** 한 기록의 시각을 바꾼다. 종류는 그대로다. 앞뒤 기록 사이인지는 부르는 쪽이 본다. */
    async editRecord(record: DaynightRecord, time: number): Promise<void> {
        await this.write(record.file.path, () => this.plugin.app.vault.process(record.file, (data) => {
            const lines = data.split('\n');
            const index = lines.map((line) => line.trim()).lastIndexOf(record.line);
            if (index === -1) return data;
            lines[index] = formatRow(new Date(time), record.type);
            return lines.join('\n');
        }));
    }

    // 마지막 기록의 줄을 새 줄로 바꾸고, null이면 지운다.
    private async replaceLast(replacement: (last: DaynightRecord) => string | null): Promise<void> {
        const last = this.records[this.records.length - 1];
        if (!last) return;
        const row = replacement(last);

        await this.write(last.file.path, () => this.plugin.app.vault.process(last.file, (data) => {
            const lines = data.split('\n');
            const index = lines.map((line) => line.trim()).lastIndexOf(last.line);
            if (index === -1) return data;
            if (row === null) lines.splice(index, 1);
            else lines[index] = row;
            return lines.join('\n');
        }));
    }

    // 버튼을 연달아 눌러도 기록을 다시 읽기 전에 같은 종류를 두 번 쓰지 않게 한다. 건너뛰었으면 false다.
    private async write(path: string, action: () => Promise<unknown>): Promise<boolean> {
        if (this.isWriting) return false;
        this.isWriting = true;
        try {
            await action();
            await this.enqueue(() => this.loadFiles([path]));
            return true;
        } finally {
            this.isWriting = false;
        }
    }

    private enqueue(job: () => Promise<void>): Promise<void> {
        const run = this.loadQueue.then(job);
        this.loadQueue = run.catch(() => undefined);
        return run;
    }

    // 볼트 전체가 아니라 기록 폴더 안의 파일만 읽는다.
    private async loadAll(): Promise<void> {
        const fileRecords = new Map<string, DaynightRecord[]>();
        const children = this.plugin.app.vault.getFolderByPath(this.getFolder())?.children ?? [];
        for (const file of children) {
            if (this.isRecordFile(file)) fileRecords.set(file.path, await this.readFile(file));
        }
        this.fileRecords = fileRecords;
        this.publish();
    }

    // 지워졌거나 기록 파일이 아니게 된 경로는 목록에서 뺀다.
    private async loadFiles(paths: Iterable<string>): Promise<void> {
        for (const path of paths) {
            const file = this.plugin.app.vault.getFileByPath(path);
            if (file && this.isRecordFile(file)) {
                this.fileRecords.set(path, await this.readFile(file));
            } else {
                this.fileRecords.delete(path);
            }
        }
        this.publish();
    }

    private async readFile(file: TFile): Promise<DaynightRecord[]> {
        const records: DaynightRecord[] = [];
        const content = await this.plugin.app.vault.cachedRead(file);
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            const match = ROW_PATTERN.exec(line);
            if (!match) continue;
            const [, year, month, day, hour, minute, type] = match;
            records.push({
                time: new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime(),
                type: type as DaynightType,
                file,
                line,
            });
        }
        return records;
    }

    // 파일 이름이 연·월 순이라 이름순으로 이어 붙이면 거의 정렬된 상태가 된다.
    private publish(): void {
        this.records = [...this.fileRecords.keys()].sort()
            .flatMap((path) => this.fileRecords.get(path) ?? [])
            .sort((a, b) => a.time - b.time);
        this.renderViews();
        this.plugin.dashboard.refresh('daynight');
    }

    /** 식사·활동·지출 기록이 바뀌어도 기록 패널을 다시 그린다. */
    renderViews(): void {
        this.views().forEach((view) => view.render());
    }

    /** 가계부는 파일을 읽어야 해서 패널이 다시 읽게 한다. */
    reloadBudget(): void {
        this.views().forEach((view) => void view.reloadBudget());
    }

    private views(): DaynightView[] {
        return this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DAYNIGHT)
            .map((leaf) => leaf.view)
            .filter((view): view is DaynightView => view instanceof DaynightView);
    }

    private onFileEvent(file: TAbstractFile): void {
        if (this.isRecordFile(file)) this.scheduleReload(file.path);
    }

    // 경로를 주면 그 파일만, 주지 않으면 폴더 전체를 다시 읽는다.
    private scheduleReload(path?: string): void {
        if (path === undefined) this.isFullReloadPending = true;
        else this.pendingPaths.add(path);
        if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
        this.reloadTimer = window.setTimeout(() => {
            this.reloadTimer = null;
            const isFull = this.isFullReloadPending;
            const paths = [...this.pendingPaths];
            this.isFullReloadPending = false;
            this.pendingPaths.clear();
            void this.enqueue(() => isFull ? this.loadAll() : this.loadFiles(paths));
        }, RELOAD_DELAY);
    }

    private getFolder(): string {
        return normalizePath(this.plugin.settings.daynightFolder.trim() || DEFAULT_FOLDER);
    }

    private isRecordFile(file: TAbstractFile): file is TFile {
        return file instanceof TFile && this.isRecordPath(file.path);
    }

    private isRecordPath(path: string): boolean {
        const slash = path.lastIndexOf('/');
        const parent = slash === -1 ? '/' : path.slice(0, slash);
        return parent === this.getFolder() && FILE_NAME_PATTERN.test(path.slice(slash + 1));
    }
}
