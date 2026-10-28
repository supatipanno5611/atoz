import { ItemView, Notice, TAbstractFile, TFile, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import type { MealColor, MealLegendItem } from '../types';
import { formatAmount, parseAmount, type BudgetRecord, type LedgerKind } from './Budget';
import { END_CATEGORY } from './Timeline';

export const VIEW_TYPE_DAYNIGHT = 'atoz-daynight-view';
const DEFAULT_FOLDER = 'sleep';
const FILE_NAME_PATTERN = /^sleep-\d{4}-\d{2}\.md$/;
const ROW_PATTERN = /^\|\s*(\d{4})-(\d{2})-(\d{2})\s*\|\s*(\d{2}):(\d{2})\s*\|\s*(sleep|wake)\s*\|$/;
const TABLE_HEADER = '| Date | Time | Type |\n| --- | --- | --- |\n';
const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
const RELOAD_DELAY = 100;
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
    type: DaynightType;
}

// 각 기록에서 다음 기록까지를 그 기록 종류의 구간으로 만든다. 마지막 구간은 지금까지 진행 중이다.
export function toSegments(records: DaynightRecord[], now: number): DaynightSegment[] {
    return records.map((record, index) => ({
        from: record.time,
        to: records[index + 1]?.time ?? now,
        type: record.type,
    }));
}

const SLEEP_COLOR: MealColor = { light: 'var(--interactive-accent)', dark: 'var(--interactive-accent)' };
const WAKE_COLOR: MealColor = { light: 'var(--atoz-daynight-morning)', dark: 'var(--atoz-daynight-morning)' };

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
    editable: boolean;
    save: (time: number, note: string) => Promise<void>;
    remove: () => Promise<void>;
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
    private amountKind: LedgerKind = 'expense';
    private amountPayment = '';

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

    async reloadBudget(): Promise<void> {
        this.budgetRecords = await this.plugin.budget.timedRecords();
        this.render();
    }

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
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
            const fold = list.createDiv({ cls: 'atoz-record-fold' });
            setIcon(fold.createSpan(), this.isYesterdayShown ? 'chevron-down' : 'chevron-right');
            fold.createSpan({ text: t('record.yesterday', { count: yesterday.length }) });
            fold.addEventListener('click', () => {
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

        const controls = container.createDiv({ cls: 'atoz-record-controls' });
        this.renderSpending(controls);
        this.renderMeals(controls);
        this.renderActivities(controls, now);

        const isAsleep = this.lastSleep()?.type === 'sleep';
        const toggleButton = container.createEl('button', {
            cls: `atoz-daynight-toggle ${isAsleep ? 'is-asleep' : 'is-awake'}`,
        });
        setIcon(toggleButton, isAsleep ? 'sun' : 'moon');
        toggleButton.createSpan({ text: isAsleep ? t('daynight.wakeNow') : t('daynight.sleepNow') });
        toggleButton.addEventListener('click', () => void this.toggleSleep());

        // 펼친 기록이 있으면 그 줄이 보이게 하고, 없으면 맨 아래 최신 기록을 보인다.
        const open = list.querySelector('.atoz-record-row.is-open');
        feed.scrollTop = open
            ? open.getBoundingClientRect().top - feed.getBoundingClientRect().top
            : feed.scrollHeight;
    }

    private lastSleep(): DaynightRecord | undefined {
        const records = this.plugin.daynight.records;
        return records[records.length - 1];
    }

    private renderStatus(container: HTMLElement, now: number): void {
        const hero = container.createDiv({ cls: 'atoz-daynight-hero' });
        const last = this.lastSleep();
        const isAsleep = last?.type === 'sleep';
        const current = isAsleep ? null : this.plugin.timeline.current();

        const head = hero.createDiv({ cls: 'atoz-daynight-hero-label' });
        applyColor(
            head.createSpan({ cls: 'atoz-daynight-dot' }),
            isAsleep ? SLEEP_COLOR : current ? this.plugin.settings.timelineColors[current.category] : null,
        );
        head.createSpan({
            cls: 'atoz-record-status',
            text: isAsleep ? t('daynight.asleep')
                : current ? t('record.doing', { activity: current.category })
                    : t('record.idle'),
        });

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
            if (end && (!last || end.time > last.time)) {
                since = end.time;
                sub = t('record.endedSince', {
                    activity: ended && ended.category !== END_CATEGORY ? ended.category : t('record.activity'),
                    time: at(end.time),
                });
            } else if (last) {
                since = last.time;
                sub = t('record.awakeSince', { time: at(last.time) });
            }
        }
        hero.createDiv({ cls: 'atoz-daynight-hero-value', text: since === undefined ? '—' : formatElapsed(now - since) });
        if (sub) hero.createDiv({ cls: 'atoz-daynight-hero-sub', text: sub });
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
                value: '',
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
            });
        });

        for (const meal of plugin.meal.records) {
            if (meal.time < from) continue;
            const legend = plugin.settings.mealLegend.find((item) => item.icon === meal.icon && item.color === meal.color);
            out.push({
                key: `meal:${meal.file.path}:${meal.line}`,
                time: meal.time,
                mark: { icon: 'utensils' },
                color: plugin.meal.colorOf(meal.color),
                text: legend?.label ?? t('record.meal'),
                value: '',
                isIncome: false,
                note: meal.food,
                noteLabel: t('record.food'),
                editable: true,
                save: (time, note) => plugin.meal.replace(meal, time, note),
                remove: () => plugin.meal.replace(meal, null, ''),
            });
        }

        const logs = plugin.timeline.logs;
        logs.forEach((log, index) => {
            if (log.time < from) return;
            const isEnd = log.category === END_CATEGORY;
            const previous = logs[index - 1];
            const ended = previous && previous.category !== END_CATEGORY ? previous.category : null;
            out.push({
                key: `log:${log.file.path}:${log.line}`,
                time: log.time,
                mark: isEnd ? 'ring' : 'dot',
                color: plugin.settings.timelineColors[isEnd ? ended ?? '' : log.category],
                text: !isEnd ? log.category : t('record.ended', { activity: ended ?? t('record.activity') }),
                value: '',
                isIncome: false,
                note: isEnd ? null : log.memo,
                noteLabel: t('record.memo'),
                editable: true,
                save: (time, note) => plugin.timeline.replaceLog(log, time, note),
                remove: () => plugin.timeline.replaceLog(log, null, ''),
            });
        });

        for (const record of this.budgetRecords) {
            const { entry } = record;
            const [year, month, day] = entry.date.split('-').map(Number);
            const [hour, minute] = entry.time.split(':').map(Number);
            const time = new Date(year!, month! - 1, day, hour, minute).getTime();
            if (time < from) continue;
            out.push({
                key: `budget:${record.kind}:${record.month}:${entry.lineIndex}:${entry.raw}`,
                time,
                mark: { icon: record.kind === 'income' ? 'piggy-bank' : 'wallet' },
                // 가계부 카테고리에는 색이 없다.
                color: null,
                text: entry.category || t('budget.uncategorized'),
                value: (record.kind === 'income' ? '+' : '−') + formatAmount(entry.amount),
                isIncome: record.kind === 'income',
                note: entry.title,
                noteLabel: t('budget.item'),
                editable: true,
                save: (time, note) => plugin.budget.editRecord(record, formatTime(time), note),
                remove: () => plugin.budget.deleteRecord(record),
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
        if (record.value) {
            const value = head.createSpan({ cls: 'atoz-record-value', text: record.value });
            value.toggleClass('is-income', record.isIncome);
        }
        if (!record.editable) return;

        row.addClass('is-editable');
        const editing = this.editing?.record.key === record.key ? this.editing : null;
        head.addEventListener('click', () => {
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
        this.addRecordAction(editor, 'trash-2', t('record.delete'), () => {
            this.editing = null;
            void record.remove();
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

    private pill(parent: HTMLElement, text: string, color: MealColor | null | undefined, onClick: () => void): HTMLButtonElement {
        const button = parent.createEl('button', { cls: 'atoz-record-pill' });
        applyColor(button, color);
        button.createSpan({ cls: 'atoz-record-dot' });
        button.createSpan({ text });
        button.addEventListener('click', onClick);
        return button;
    }

    // 금액 칸은 그 칸을 연 알약 묶음 바로 아래에 연다.
    private renderSpending(container: HTMLElement): void {
        const categories = this.plugin.settings.budgetPanelCategories;
        if (categories.length === 0) return;
        const pills = this.pills(container, t('record.spending'));
        for (const category of categories) {
            const button = this.pill(pills, category, null, () => this.openAmount({ category, meal: null }));
            button.toggleClass('is-open', this.amountTarget?.category === category && this.amountTarget.meal === null);
        }
        if (this.amountTarget?.meal === null) this.renderAmountForm(pills.parentElement!, this.amountTarget);
    }

    // 첫 범례(집밥)는 바로 기록하고, 나머지(배달·외식·간식)는 금액 칸을 함께 연다.
    private renderMeals(container: HTMLElement): void {
        const settings = this.plugin.settings;
        if (settings.mealLegend.length === 0) return;
        const pills = this.pills(container, t('record.meal'));
        for (const [index, item] of settings.mealLegend.entries()) {
            const hasAmount = index > 0;
            const button = this.pill(pills, item.label, this.plugin.meal.colorOf(item.color), () => {
                if (hasAmount) this.openAmount({ category: item.label, meal: item });
                else void this.plugin.meal.add(Date.now(), '', item);
            });
            button.toggleClass('is-open', this.amountTarget?.meal === item);
        }
        if (this.amountTarget?.meal) this.renderAmountForm(pills.parentElement!, this.amountTarget);
    }

    // 활성 알약을 다시 누르면 그 활동이 끝난다. 맨 끝의 추가 알약은 메인 탭에 계획 페이지를 연다.
    private renderActivities(container: HTMLElement, now: number): void {
        const pills = this.pills(container, t('record.activity'));
        const current = this.plugin.timeline.current();
        for (const name of this.plugin.timeline.blocks) {
            const isCurrent = current?.category === name;
            const button = this.pill(pills, name, this.plugin.settings.timelineColors[name], () => {
                void this.plugin.timeline.addLog(Date.now(), isCurrent ? END_CATEGORY : name);
            });
            button.toggleClass('is-active', isCurrent);
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
        this.amountKind = 'expense';
        this.amountPayment = this.plugin.settings.budgetLastPayment;
        this.render();
    }

    private renderAmountForm(container: HTMLElement, target: AmountTarget): void {
        const row = container.createDiv({ cls: 'atoz-record-amount' });
        // 식사에서 연 금액은 언제나 지출이다.
        if (target.meal === null) {
            const kind = row.createEl('button', { cls: 'atoz-record-amount-toggle' });
            const syncKind = (): void => {
                kind.setText(t(this.amountKind === 'income' ? 'budget.income' : 'budget.expense'));
                kind.toggleClass('is-income', this.amountKind === 'income');
            };
            syncKind();
            kind.addEventListener('click', () => {
                this.amountKind = this.amountKind === 'income' ? 'expense' : 'income';
                syncKind();
            });
        }
        // 결제 수단은 누를 때마다 다음 것으로 넘어가고, 마지막 다음은 비운다.
        const payments = this.plugin.settings.budgetPayments;
        if (payments.length > 0) {
            const payment = row.createEl('button', {
                cls: 'atoz-record-amount-toggle',
                attr: { 'aria-label': t('budget.payment') },
            });
            // 고르지 않았으면 좁은 패널에서도 한 줄에 들도록 아이콘만 보인다.
            const syncPayment = (): void => {
                payment.empty();
                if (this.amountPayment) payment.setText(this.amountPayment);
                else setIcon(payment, 'credit-card');
                payment.toggleClass('is-empty', !this.amountPayment);
            };
            syncPayment();
            payment.addEventListener('click', () => {
                this.amountPayment = payments[payments.indexOf(this.amountPayment) + 1] ?? '';
                syncPayment();
            });
        }
        row.createSpan({ cls: 'atoz-record-amount-title', text: target.category });

        const input = row.createEl('input', { type: 'text', cls: 'atoz-budget-amount-input' });
        // 'numeric'은 iOS 키패드에 소수점이 없다.
        input.inputMode = 'decimal';
        input.placeholder = target.meal ? t('record.amountOptional') : t('budget.amount');
        input.setAttr('aria-label', t('budget.amount'));
        input.value = this.amountDraft;
        input.addEventListener('input', () => { this.amountDraft = input.value; });
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
        const submit = row.createEl('button', { cls: 'mod-cta atoz-record-amount-submit', text: t('record.submit') });
        submit.addEventListener('click', () => void this.submitAmount());
        window.setTimeout(() => input.focus(), 0);
    }

    // 식사에서 연 금액 칸은 비워도 된다(얻어먹었을 때). 그때는 식사만 남긴다.
    private async submitAmount(): Promise<void> {
        const target = this.amountTarget;
        if (!target) return;
        const raw = this.amountDraft.trim();
        const amount = raw.length === 0 ? null : parseAmount(raw);
        if ((raw.length > 0 && amount === null) || (amount === null && target.meal === null)) {
            new Notice(t('budget.notice.amountRequired'));
            return;
        }
        this.amountTarget = null;
        this.render();
        if (target.meal) await this.plugin.meal.add(Date.now(), '', target.meal);
        if (amount !== null) {
            await this.plugin.budget.recordNow(target.meal ? 'expense' : this.amountKind, target.category, amount, this.amountPayment);
        }
    }

    // 잠들면 하던 활동도 끝낸다.
    private async toggleSleep(): Promise<void> {
        const isAsleep = this.lastSleep()?.type === 'sleep';
        if (!isAsleep && this.plugin.timeline.current()) await this.plugin.timeline.addLog(Date.now(), END_CATEGORY);
        await this.plugin.daynight.toggle();
    }

    private addRecordAction(row: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
        const button = row.createEl('button', { cls: 'atoz-daynight-action', attr: { 'aria-label': label } });
        setIcon(button, icon);
        button.addEventListener('click', (evt) => {
            evt.stopPropagation();
            onClick();
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

    async toggle(): Promise<void> {
        const last = this.records[this.records.length - 1];
        const type: DaynightType = last?.type === 'sleep' ? 'wake' : 'sleep';
        const now = new Date();
        const row = formatRow(now, type);
        const folder = this.getFolder();
        const path = normalizePath(`${folder}/sleep-${now.getFullYear()}-${pad(now.getMonth() + 1)}.md`);

        await this.write(path, async () => {
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

    // 버튼을 연달아 눌러도 기록을 다시 읽기 전에 같은 종류를 두 번 쓰지 않게 한다.
    private async write(path: string, action: () => Promise<unknown>): Promise<void> {
        if (this.isWriting) return;
        this.isWriting = true;
        try {
            await action();
            await this.enqueue(() => this.loadFiles([path]));
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
