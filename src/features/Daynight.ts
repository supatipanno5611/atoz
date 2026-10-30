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
type DaynightType = 'sleep' | 'wake';

interface DaynightRecord {
    time: number;
    type: DaynightType;
    file: TFile;
    line: string;
}

export const pad = (value: number): string => String(value).padStart(2, '0');

export function formatDuration(ms: number): string {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return t('daynight.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60, paddedMinutes: pad(minutes % 60) });
}

/** 패널의 경과 시간. 1시간이 안 되면 분만 보인다. */
function formatElapsed(ms: number): string {
    return ms < HOUR ? t('record.minutes', { minutes: Math.max(0, Math.floor(ms / 60000)) }) : formatDuration(ms);
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
    // 줄 앞 표시. 활동은 점, 활동 끝은 빈 고리, 그 밖은 아이콘이다.
    mark: 'dot' | 'ring' | { icon: string };
    color: MealColor | null | undefined;
    text: string;
    // 금액처럼 줄 끝에 붙는 값
    value: string;
    isIncome: boolean;
    // null이면 메모 칸이 없다.
    note: string | null;
    noteLabel: string;
    // 메모가 비었을 때 줄 끝에 보이는 쓰기 안내. 줄을 누르면 편집이 열린다.
    notePrompt?: string;
    editable: boolean;
    save: (time: number, note: string) => Promise<void>;
    remove: () => Promise<void>;
    // 지운 기록을 다시 넣는다(되돌리기).
    restore: () => Promise<unknown>;
}

interface ToastAction {
    label: string;
    run: () => Promise<unknown> | void;
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
    private editing: { record: PanelRecord; time: string; note: string } | null = null;
    private amountTarget: AmountTarget | null = null;
    private amountDraft = '';
    private amountPayment = '';
    // 금액 칸 바로 아래에 보이는 오류
    private amountError = '';
    // 방금 한 일과 되돌리기. 다시 그려도 사라지지 않게 여기에 둔다.
    private toast: { text: string; actions: ToastAction[] } | null = null;
    private toastTimer: number | null = null;
    // 쓰는 중인 버튼(data-lock 값). 그동안 같은 버튼을 다시 눌러도 무시한다.
    private pending = new Set<string>();
    // 처음 열 때와 방금 기록했을 때만 맨 아래(최신 기록)로 스크롤한다. 그 밖에는 보던 자리를 지킨다.
    private scrollToEnd = true;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_DAYNIGHT; }
    getDisplayText(): string { return t('record.viewName'); }
    getIcon(): string { return 'clock'; }

    async onOpen(): Promise<void> {
        // 고치거나 금액을 넣는 중에는 다시 그리면 입력이 닫히므로 건너뛴다.
        this.registerInterval(window.setInterval(() => {
            if (this.editing === null && this.amountTarget === null) this.render();
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
        const previousScroll = container.scrollTop;
        container.empty();
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
        this.editing = this.editing && editingRecord ? { ...this.editing, record: editingRecord } : null;

        this.renderStatus(container, now);

        // 기록은 아래에서부터 쌓아 최신 기록이 버튼 바로 위에 온다.
        const feed = container.createDiv({ cls: 'atoz-record-feed' });
        const list = feed.createDiv({ cls: 'atoz-record-list' });
        const yesterday = records.filter((record) => record.time < todayStart);
        const today = records.filter((record) => record.time >= todayStart);
        if (yesterday.length > 0) {
            const fold = list.createDiv({ cls: 'atoz-record-fold', attr: { 'aria-expanded': String(this.isYesterdayShown) } });
            setIcon(fold.createSpan(), this.isYesterdayShown ? 'chevron-down' : 'chevron-right');
            fold.createSpan({ text: t('record.yesterday', { count: yesterday.length }) });
            makeClickable(fold, () => {
                this.isYesterdayShown = !this.isYesterdayShown;
                this.render();
                this.containerEl.querySelector<HTMLElement>('.atoz-record-fold')?.focus();
            });
            if (this.isYesterdayShown) {
                yesterday.forEach((record) => this.renderRecord(list, record));
                list.createDiv({ cls: 'atoz-record-divider', text: t('record.today') });
            }
        }
        if (today.length === 0) list.createDiv({ cls: 'atoz-record-empty', text: t('record.empty') });
        today.forEach((record) => this.renderRecord(list, record));

        // 패널 전체가 한 번에 스크롤되고, 알약과 수면 버튼은 아래에 붙어 늘 보인다.
        const dock = container.createDiv({ cls: 'atoz-record-dock' });
        const controls = dock.createDiv({ cls: 'atoz-record-controls' });
        // 휴대폰에서는 금액 시트가 알약 줄을 대신해 키보드 바로 위에 붙는다.
        controls.toggleClass('has-sheet', this.amountTarget !== null);
        this.renderSpending(controls);
        this.renderMeals(controls);
        this.renderActivities(controls, now);

        if (this.toast) this.renderToast(dock, this.toast);

        const isAsleep = this.lastSleep()?.type === 'sleep';
        const toggleButton = dock.createEl('button', {
            cls: `atoz-daynight-toggle ${isAsleep ? 'is-asleep' : 'is-awake'}`,
            attr: { 'data-lock': 'sleep' },
        });
        // 하루 두 번 쓰는 버튼이라 낮에는 테두리만 두고, 잘 무렵과 자는 중에만 채운다.
        toggleButton.toggleClass('is-light', !isAsleep && !this.plugin.daynight.isBedtime(now));
        setIcon(toggleButton, isAsleep ? 'sun' : 'moon');
        toggleButton.createSpan({ text: isAsleep ? t('daynight.wakeNow') : t('daynight.sleepNow') });
        toggleButton.addEventListener('click', () => void this.lock('sleep', () => this.toggleSleep()));
        this.syncPending();

        // 펼친 기록이 있으면 그 줄이 보이게 하고, 방금 기록했으면 맨 아래 최신 기록을, 아니면 보던 자리를 보인다.
        const open = list.querySelector('.atoz-record-row.is-open');
        if (open) {
            container.scrollTop = open.getBoundingClientRect().top - container.getBoundingClientRect().top;
        } else if (this.scrollToEnd) {
            container.scrollTop = container.scrollHeight;
            this.scrollToEnd = false;
        } else {
            container.scrollTop = previousScroll;
        }
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
            text: isAsleep ? t('daynight.asleep')
                : current ? t('record.doing', { activity: current.category })
                    : t('record.idle'),
        });
        // '다시 누르면 끝'을 외우지 않아도 되게 끝내기 버튼을 둔다.
        if (current) {
            const key = `activity:${current.category}`;
            const end = head.createEl('button', { cls: 'atoz-daynight-hero-end', text: t('record.end'), attr: { 'data-lock': key } });
            end.addEventListener('click', () => void this.lock(key, () => this.toggleActivity(current.category)));
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
            if (last) sub += ` · ${t('daynight.wokeAt', { time: at(last.time) })}`;
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
        hero.createDiv({ cls: 'atoz-daynight-hero-value', text: since === undefined ? '—' : formatElapsed(now - since) });
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
        const out: PanelRecord[] = [];

        const sleeps = plugin.daynight.records;
        sleeps.forEach((record, index) => {
            if (record.time < from) return;
            const previous = sleeps[index - 1];
            out.push({
                key: `sleep:${record.time}`,
                time: record.time,
                mark: { icon: record.type === 'sleep' ? 'moon' : 'sun' },
                color: record.type === 'sleep' ? SLEEP_COLOR : WAKE_COLOR,
                text: t(record.type === 'sleep' ? 'daynight.sleep' : 'daynight.wake'),
                value: record.type === 'wake' && previous?.type === 'sleep'
                    ? t('record.slept', { duration: formatDuration(record.time - previous.time) })
                    : '',
                isIncome: false,
                note: null,
                noteLabel: '',
                // 마지막 기록만 고치거나 지울 수 있어서 기록은 항상 취침과 기상이 번갈아 나온다.
                editable: index === sleeps.length - 1,
                save: async (time) => {
                    // 앞 기록보다 뒤, 지금보다 앞이어야 순서가 유지된다.
                    if (previous && time <= previous.time) {
                        new Notice(t('daynight.editTooEarly', { time: formatShortDateTime(previous.time) }));
                    } else if (time > Date.now()) {
                        new Notice(t('daynight.editFuture'));
                    } else {
                        await plugin.daynight.editLast(time);
                    }
                },
                remove: () => plugin.daynight.deleteLast(),
                restore: () => plugin.daynight.restore(record),
            });
        });

        // 지출과 합칠 식사 줄
        const meals: { meal: MealRecord; record: PanelRecord }[] = [];
        for (const meal of plugin.meal.records) {
            if (meal.time < from) continue;
            const legend = plugin.settings.mealLegend.find((item) => item.icon === meal.icon && item.color === meal.color);
            const record: PanelRecord = {
                key: `meal:${meal.file.path}:${meal.line}`,
                time: meal.time,
                mark: { icon: mealIcon(meal.icon) },
                color: plugin.meal.colorOf(meal.color),
                text: legend?.label ?? t('record.meal'),
                value: '',
                isIncome: false,
                note: meal.food,
                noteLabel: t('record.food'),
                notePrompt: t('record.toast.writeMenu'),
                editable: true,
                save: (time, note) => plugin.meal.replace(meal, time, note),
                remove: () => plugin.meal.replace(meal, null, ''),
                restore: () => plugin.meal.add(meal.time, meal.food, meal),
            };
            out.push(record);
            meals.push({ meal, record });
        }

        const logs = plugin.timeline.logs;
        logs.forEach((log, index) => {
            if (log.time < from) return;
            const isEnd = log.category === END_CATEGORY;
            const previous = logs[index - 1];
            const next = logs[index + 1];
            const ended = previous && previous.category !== END_CATEGORY ? previous.category : null;
            out.push({
                key: `log:${log.file.path}:${log.line}`,
                time: log.time,
                mark: isEnd ? 'ring' : 'dot',
                color: plugin.timeline.colorOf(isEnd ? ended ?? '' : log.category),
                text: !isEnd ? log.category : t('record.ended', { activity: ended ?? t('record.activity') }),
                // 활동 줄에는 다음 기록까지의 길이를 붙여 빼기를 대신한다.
                value: isEnd ? '' : next ? formatDuration(next.time - log.time) : t('record.ongoing'),
                isIncome: false,
                note: isEnd ? null : log.memo,
                noteLabel: t('record.memo'),
                editable: true,
                save: (time, note) => plugin.timeline.replaceLog(log, time, note),
                remove: () => plugin.timeline.replaceLog(log, null, ''),
                restore: () => plugin.timeline.addLog(log.time, log.category, log.memo),
            });
        });

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
                mealRecord.save = async (newTime, note) => {
                    await plugin.meal.replace(meal, newTime, note);
                    await plugin.budget.editRecord(record, formatTime(newTime), entry.title);
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
            out.push({
                key: `budget:${record.kind}:${record.month}:${entry.lineIndex}:${entry.raw}`,
                time,
                mark: { icon: record.kind === 'income' ? 'piggy-bank' : 'wallet' },
                // 가계부 카테고리에는 색이 없다.
                color: null,
                text: entry.category || t('budget.uncategorized'),
                value: amount,
                isIncome: record.kind === 'income',
                note: entry.title,
                noteLabel: t('budget.item'),
                editable: true,
                save: (time, note) => plugin.budget.editRecord(record, formatTime(time), note),
                remove: () => plugin.budget.deleteRecord(record),
                restore: () => plugin.budget.restoreRecord(record),
            });
        }

        // 같은 시각이면 모은 순서(수면, 식사, 활동, 지출)를 지킨다.
        return out.sort((a, b) => a.time - b.time);
    }

    private renderRecord(list: HTMLElement, record: PanelRecord): void {
        const row = list.createDiv({ cls: 'atoz-record-row' });
        row.toggleClass('is-end', record.mark === 'ring');
        const head = row.createDiv({ cls: 'atoz-record-head' });
        head.createSpan({ cls: 'atoz-record-time', text: formatTime(record.time) });
        const mark = head.createSpan({ cls: 'atoz-record-mark' });
        applyColor(mark, record.color);
        if (typeof record.mark === 'string') mark.createSpan({ cls: `atoz-record-${record.mark}` });
        else setIcon(mark, record.mark.icon);
        const text = head.createSpan({ cls: 'atoz-record-text', text: record.text });
        if (record.note) text.createSpan({ cls: 'atoz-record-note', text: ` · ${record.note}` });
        else if (record.notePrompt && record.editable) head.createSpan({ cls: 'atoz-record-prompt', text: record.notePrompt });
        if (record.value) {
            const value = head.createSpan({ cls: 'atoz-record-value', text: record.value });
            value.toggleClass('is-income', record.isIncome);
        }
        // 고칠 수 없는 줄은 시각을 흐리게 하고 누를 수 없다.
        if (!record.editable) {
            row.addClass('is-locked');
            return;
        }

        row.addClass('is-editable');
        const editing = this.editing?.record.key === record.key ? this.editing : null;
        head.setAttr('aria-expanded', String(editing !== null));
        makeClickable(head, () => {
            this.commitEdit();
            if (!editing) this.editing = { record, time: formatTime(record.time), note: record.note ?? '' };
            this.render();
        });
        if (!editing) return;

        // 날짜는 그대로 두고 시각과 메모만 고친다.
        row.addClass('is-open');
        const editor = row.createDiv({ cls: 'atoz-record-editor' });
        const timeInput = editor.createEl('input', { cls: 'atoz-daynight-time-input', type: 'time' });
        timeInput.value = editing.time;
        timeInput.addEventListener('input', () => { editing.time = timeInput.value; });
        const inputs = [timeInput];
        if (record.note !== null) {
            const noteInput = editor.createEl('input', {
                cls: 'atoz-record-note-input',
                type: 'text',
                attr: { placeholder: record.noteLabel, 'aria-label': record.noteLabel },
            });
            noteInput.value = editing.note;
            noteInput.addEventListener('input', () => { editing.note = noteInput.value; });
            inputs.push(noteInput);
        }
        // Enter는 저장하고 닫고, Esc는 고친 값을 버리고 닫는다.
        for (const input of inputs) {
            input.addEventListener('keydown', (event) => {
                if (event.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
                event.preventDefault();
                if (event.key === 'Enter') this.commitEdit();
                else this.editing = null;
                this.render();
            });
        }
        const done = editor.createEl('button', { cls: 'atoz-record-done', text: t('record.done') });
        done.addEventListener('click', () => {
            this.commitEdit();
            this.render();
        });
        // 지우기는 메모 칸에서 먼 ⋯ 메뉴에 두고, 지운 뒤에는 되돌리기 토스트를 띄운다.
        this.addRecordAction(editor, 'more-horizontal', t('record.more'), (event) => {
            const menu = new Menu();
            menu.addItem((item) => item.setTitle(t('record.delete')).setIcon('trash-2').setWarning(true).onClick(() => {
                this.editing = null;
                void this.lock('delete', async () => {
                    await record.remove();
                    this.showToast(t('record.toast.deleted'), [this.undo(() => record.restore())]);
                });
            }));
            menu.showAtMouseEvent(event);
        });
        // 서랍을 닫거나 다른 곳을 누르면 고친 값을 저장한다. 다른 줄을 누른 경우는 그 줄이 저장한다.
        editor.addEventListener('focusout', (event) => {
            const next = event.relatedTarget;
            if (next instanceof HTMLElement && (row.contains(next) || next.closest('.atoz-record-head, .menu'))) return;
            if (this.editing?.record.key !== record.key) return;
            this.commitEdit();
            // 패널 안의 버튼으로 옮겨 갔으면 그 클릭이 사라지지 않게 지금 다시 그리지 않는다. 다음에 그릴 때 닫힌다.
            if (!(next instanceof Node && this.containerEl.contains(next))) this.render();
        });
    }

    /** 고친 값이 있으면 저장하고 펼친 기록을 닫는다. */
    private commitEdit(): void {
        const editing = this.editing;
        this.editing = null;
        if (!editing) return;
        const { record } = editing;
        const match = /^(\d{2}):(\d{2})$/.exec(editing.time);
        if (!match) return;
        const date = new Date(record.time);
        date.setHours(Number(match[1]), Number(match[2]), 0, 0);
        const note = editing.note.trim();
        if (date.getTime() === record.time && note === (record.note ?? '')) return;
        void record.save(date.getTime(), note).then(() => this.render());
    }

    private pills(container: HTMLElement, title: string): HTMLElement {
        const section = container.createDiv({ cls: 'atoz-record-section' });
        section.createDiv({ cls: 'atoz-record-section-title', text: title });
        return section.createDiv({ cls: 'atoz-record-pills' });
    }

    // icon이 없으면 이름 앞에 색 점을 둔다.
    private pill(
        parent: HTMLElement,
        text: string,
        color: MealColor | null | undefined,
        icon: string | null,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = parent.createEl('button', { cls: 'atoz-record-pill' });
        applyColor(button, color);
        if (icon) setIcon(button.createSpan({ cls: 'atoz-record-pill-icon' }), icon);
        else button.createSpan({ cls: 'atoz-record-dot' });
        button.createSpan({ text });
        button.addEventListener('click', onClick);
        return button;
    }

    // 금액 칸은 그 칸을 연 알약 줄 바로 아래에 연다.
    private renderSpending(container: HTMLElement): void {
        const categories = this.plugin.settings.budgetPanelCategories;
        if (categories.length === 0) return;
        const pills = this.pills(container, t('record.spending'));
        for (const category of categories) {
            const button = this.pill(pills, category, null, SPENDING_ICONS[category] ?? 'wallet', () => {
                this.openAmount({ category, meal: null });
            });
            const isOpen = this.amountTarget?.category === category && this.amountTarget.meal === null;
            button.toggleClass('is-open', isOpen);
            button.setAttr('aria-expanded', String(isOpen));
        }
        if (this.amountTarget?.meal === null) this.renderAmountForm(container, this.amountTarget);
    }

    // 첫 범례(집밥)는 바로 기록하고, 나머지(배달·외식·간식)는 금액 칸을 함께 연다.
    private renderMeals(container: HTMLElement): void {
        const settings = this.plugin.settings;
        if (settings.mealLegend.length === 0) return;
        const pills = this.pills(container, t('record.meal'));
        for (const [index, item] of settings.mealLegend.entries()) {
            const hasAmount = index > 0;
            const key = `meal:${item.label}`;
            const button = this.pill(pills, item.label, this.plugin.meal.colorOf(item.color), mealIcon(item.icon), () => {
                if (hasAmount) this.openAmount({ category: item.label, meal: item });
                else void this.lock(key, () => this.recordMeal(item, null));
            });
            if (hasAmount) {
                // 바로 기록하는 집밥과 달리 금액 칸이 열린다는 표시
                button.createSpan({ cls: 'atoz-record-pill-won', text: '₩' });
                button.setAttr('aria-expanded', String(this.amountTarget?.meal === item));
            } else {
                button.dataset.lock = key;
            }
            button.toggleClass('is-open', this.amountTarget?.meal === item);
        }
        if (this.amountTarget?.meal) this.renderAmountForm(container, this.amountTarget);
    }

    // 활성 알약을 다시 누르면 그 활동이 끝난다. 맨 끝의 추가 알약은 메인 탭에 계획 페이지를 연다.
    private renderActivities(container: HTMLElement, now: number): void {
        const pills = this.pills(container, t('timeline.viewName'));
        const current = this.plugin.timeline.current();
        for (const name of this.plugin.timeline.blocks) {
            const isCurrent = current?.category === name;
            const key = `activity:${name}`;
            // 진행 중이면 색을 채우고 점 대신 체크를 둔다. 색이 없으면 강조색이다.
            const color = this.plugin.timeline.colorOf(name) ?? (isCurrent ? ACCENT_COLOR : null);
            const button = this.pill(pills, name, color, isCurrent ? 'check' : null, () => {
                void this.lock(key, () => this.toggleActivity(name));
            });
            button.dataset.lock = key;
            button.toggleClass('is-active', isCurrent);
            button.setAttr('aria-pressed', String(isCurrent));
            if (current && isCurrent) {
                button.createSpan({ cls: 'atoz-record-elapsed', text: formatElapsed(now - current.time) });
            }
        }
        const add = pills.createEl('button', { cls: 'atoz-record-pill', attr: { 'aria-label': t('record.addActivity') } });
        setIcon(add.createSpan({ cls: 'atoz-record-pill-icon' }), 'plus');
        add.addEventListener('click', () => void this.plugin.dashboard.open('plan'));
    }

    private openAmount(target: AmountTarget): void {
        const isSame = this.amountTarget?.category === target.category && this.amountTarget.meal === target.meal;
        this.amountTarget = isSame ? null : target;
        this.amountDraft = '';
        this.amountError = '';
        this.amountPayment = this.plugin.settings.budgetLastPayment;
        this.render();
    }

    // 금액 시트: 머리(아이콘·이름·닫기), 큰 금액 칸, 최근 금액, 결제 수단, 내용이 적힌 기록 버튼. 패널에서는 지출만 받는다.
    private renderAmountForm(container: HTMLElement, target: AmountTarget): void {
        const settings = this.plugin.settings;
        const sheet = container.createDiv({ cls: 'atoz-record-amount' });
        const head = sheet.createDiv({ cls: 'atoz-record-amount-head' });
        const icon = target.meal ? mealIcon(target.meal.icon) : SPENDING_ICONS[target.category] ?? 'wallet';
        setIcon(head.createSpan({ cls: 'atoz-record-amount-icon' }), icon);
        head.createSpan({ cls: 'atoz-record-amount-title', text: target.category });
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

        // 그 카테고리에서 최근에 쓴 금액. 누르면 금액 칸에 들어간다.
        const recent = this.recentAmounts(target.category);
        if (recent.length > 0) {
            const chips = sheet.createDiv({ cls: 'atoz-record-amount-chips', attr: { 'aria-label': t('record.recentAmounts') } });
            for (const amount of recent) {
                const chip = chips.createEl('button', { cls: 'atoz-record-amount-chip', text: formatWon(amount) });
                chip.addEventListener('click', () => {
                    input.value = String(amount);
                    sync();
                    input.focus();
                });
            }
        }

        // 결제 수단은 이름이 보이는 분할 버튼이다. 기본은 지난번에 쓴 것이다.
        const payments = settings.budgetPayments;
        if (payments.length > 0) {
            const group = sheet.createDiv({ cls: 'atoz-record-amount-payments', attr: { role: 'group', 'aria-label': t('budget.payment') } });
            for (const name of payments) {
                const button = group.createEl('button', { cls: 'atoz-record-amount-payment', text: name });
                const isSelected = this.amountPayment === name;
                button.toggleClass('is-active', isSelected);
                button.setAttr('aria-pressed', String(isSelected));
                button.addEventListener('click', () => {
                    this.amountPayment = this.amountPayment === name ? '' : name;
                    group.querySelectorAll('button').forEach((el) => {
                        el.toggleClass('is-active', el.textContent === this.amountPayment);
                        el.setAttr('aria-pressed', String(el.textContent === this.amountPayment));
                    });
                });
            }
        }

        const submit = sheet.createEl('button', { cls: 'mod-cta atoz-record-amount-submit' });
        submit.addEventListener('click', () => void this.submitAmount());
        // 기록 버튼에 무엇이 남는지 적는다.
        const sync = (): void => {
            this.amountDraft = input.value;
            const amount = parseAmount(input.value.trim());
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
        input.addEventListener('keydown', (event) => {
            if (event.isComposing) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.submitAmount();
            } else if (event.key === 'Escape') {
                this.amountTarget = null;
                this.render();
            }
        });
        window.setTimeout(() => {
            input.focus();
            sheet.scrollIntoView({ block: 'nearest' });
        }, 0);
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
        const spent = await this.plugin.budget.recordNow('expense', target.category, amount!, this.amountPayment);
        if (!spent) return;
        this.showToast(
            t('record.toast.spent', { category: target.category, amount: formatWon(amount!) }),
            [this.undo(() => this.plugin.budget.deleteRecord(spent))],
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
            { label: t('record.toast.writeMenu'), run: () => this.editMeal(meal) },
            this.undo(async () => {
                await this.plugin.meal.replace(meal, null, '');
                if (spent) await this.plugin.budget.deleteRecord(spent);
            }),
        ]);
    }

    /** 방금 남긴 식사 줄을 펼쳐 먹은 것을 쓰게 한다. */
    private editMeal(meal: MealRecord): void {
        const record = this.collect(meal.time).find(({ key }) => key === `meal:${meal.file.path}:${meal.line}`);
        if (!record) return;
        this.commitEdit();
        this.editing = { record, time: formatTime(record.time), note: record.note ?? '' };
        this.render();
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
                ? t('record.toast.ended', { activity: name, duration: formatElapsed(now - current.time) })
                : t('record.toast.started', { activity: name, time: formatTime(now) }),
            [this.undoLogs([log])],
        );
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
        this.showToast(text, [this.undoSleep(ended)]);
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

    private showToast(text: string, actions: ToastAction[]): void {
        if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
        this.scrollToEnd = true;
        this.toast = { text, actions };
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

    // 날짜와 종류는 그대로 두고 시각만 바꾼다.
    async editLast(time: number): Promise<void> {
        await this.replaceLast((last) => formatRow(new Date(time), last.type));
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
