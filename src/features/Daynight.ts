import { ItemView, Notice, TAbstractFile, TFile, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import type { MealLegendItem } from '../types';
import { formatWon, parseAmount, renderPaymentToggle, type BudgetRecord, type LedgerKind } from './Budget';
import { createMealMarker } from './Meal';
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

function sleptBetween(segments: DaynightSegment[], start: number, end: number): number {
    let total = 0;
    for (const { from, to, type } of segments) {
        if (type !== 'sleep') continue;
        total += Math.max(0, Math.min(to, end) - Math.max(from, start));
    }
    return total;
}

// 목록의 한 줄. 수면·식사·활동·지출을 같은 모양으로 섞어 보인다.
interface PanelRecord {
    key: string;
    time: number;
    icon: string;
    text: string;
    // 금액처럼 줄 끝에 붙는 값
    value: string;
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
    // 펼친 기록과 고치는 중인 값
    private editingKey: string | null = null;
    private editTime = '';
    private editNote = '';
    private amountTarget: AmountTarget | null = null;
    private amountDraft = '';
    private amountKind: LedgerKind = 'expense';
    private amountPayment = '';

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_DAYNIGHT; }
    getDisplayText(): string { return t('daynight.viewName'); }
    getIcon(): string { return 'moon'; }

    async onOpen(): Promise<void> {
        // 고치거나 금액을 넣는 중에는 다시 그리면 입력이 닫히므로 건너뛴다.
        this.registerInterval(window.setInterval(() => {
            if (this.editingKey === null && this.amountTarget === null) this.render();
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
        if (!records.some((record) => record.key === this.editingKey)) this.editingKey = null;

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
            if (this.isYesterdayShown) yesterday.forEach((record) => this.renderRecord(list, record));
        }
        if (today.length === 0) list.createDiv({ cls: 'atoz-record-empty', text: t('record.empty') });
        today.forEach((record) => this.renderRecord(list, record));

        const controls = container.createDiv({ cls: 'atoz-record-controls' });
        if (this.amountTarget) this.renderAmountForm(controls, this.amountTarget);
        this.renderSpending(controls);
        this.renderMeals(controls);
        this.renderActivities(controls);

        const isAsleep = this.lastSleep()?.type === 'sleep';
        const toggleButton = container.createEl('button', {
            cls: `atoz-daynight-toggle ${isAsleep ? 'is-asleep' : 'is-awake'}`,
        });
        setIcon(toggleButton, isAsleep ? 'sun' : 'moon');
        toggleButton.createSpan({ text: isAsleep ? t('daynight.wakeNow') : t('daynight.sleepNow') });
        toggleButton.addEventListener('click', () => void this.toggleSleep());

        feed.scrollTop = feed.scrollHeight;
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
        head.createSpan({ cls: `atoz-daynight-dot ${isAsleep ? 'is-asleep' : 'is-awake'}` });
        head.createSpan({
            cls: 'atoz-record-status',
            text: isAsleep ? t('daynight.asleep')
                : current ? t('record.doing', { activity: current.category })
                    : t('daynight.awake'),
        });
        const links = head.createDiv({ cls: 'atoz-daynight-links' });
        const addLink = (icon: string, label: string, onClick: () => void): void => {
            const button = links.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
            setIcon(button, icon);
            button.addEventListener('click', onClick);
        };
        // 월초에 아직 이번 달 기록이 없어도 빈 파일을 만들지 않도록 마지막 기록이 든 파일을 연다.
        if (last) addLink('file-text', t('daynight.openFile'), () => void this.app.workspace.getLeaf(false).openFile(last.file));
        addLink('layout-dashboard', t('daynight.openDashboard'), () => void this.plugin.dashboard.open('daynight'));

        const since = current?.time ?? last?.time;
        hero.createDiv({ cls: 'atoz-daynight-hero-value', text: since === undefined ? '—' : formatDuration(now - since) });
        if (!last) return;
        const lastTime = formatShortDate(last.time) === formatShortDate(now)
            ? formatTime(last.time)
            : formatShortDateTime(last.time);
        const lastText = t(isAsleep ? 'daynight.sleptAt' : 'daynight.wokeAt', { time: lastTime });
        const segments = toSegments(this.plugin.daynight.records, now);
        const totalText = t('daynight.last24h', { duration: formatDuration(sleptBetween(segments, now - DAY, now)) });
        hero.createDiv({ cls: 'atoz-daynight-hero-sub', text: `${lastText} · ${totalText}` });
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
                icon: record.type === 'sleep' ? 'moon' : 'sun',
                text: t(record.type === 'sleep' ? 'daynight.sleep' : 'daynight.wake'),
                value: '',
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
                icon: 'utensils',
                text: legend?.label ?? t('record.meal'),
                value: '',
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
            out.push({
                key: `log:${log.file.path}:${log.line}`,
                time: log.time,
                icon: isEnd ? 'square' : 'play',
                text: !isEnd ? log.category
                    : t('record.ended', { activity: previous && previous.category !== END_CATEGORY ? previous.category : t('record.activity') }),
                value: '',
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
                icon: record.kind === 'income' ? 'piggy-bank' : 'wallet',
                text: entry.category || t('budget.uncategorized'),
                value: (record.kind === 'income' ? '+' : '') + formatWon(entry.amount),
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
        const head = row.createDiv({ cls: 'atoz-record-head' });
        head.createSpan({ cls: 'atoz-record-time', text: formatTime(record.time) });
        setIcon(head.createSpan({ cls: 'atoz-record-icon' }), record.icon);
        head.createSpan({ cls: 'atoz-record-text', text: record.note ? `${record.text} · ${record.note}` : record.text });
        if (record.value) head.createSpan({ cls: 'atoz-record-value', text: record.value });
        if (!record.editable) return;

        row.addClass('is-editable');
        const isEditing = this.editingKey === record.key;
        head.addEventListener('click', () => {
            this.editingKey = isEditing ? null : record.key;
            this.editTime = formatTime(record.time);
            this.editNote = record.note ?? '';
            this.render();
        });
        if (!isEditing) return;

        // 날짜는 그대로 두고 시각과 메모만 고친다.
        row.addClass('is-open');
        const editor = row.createDiv({ cls: 'atoz-record-editor' });
        const timeInput = editor.createEl('input', { cls: 'atoz-daynight-time-input', type: 'time' });
        timeInput.value = this.editTime;
        timeInput.addEventListener('input', () => { this.editTime = timeInput.value; });
        const inputs = [timeInput];
        if (record.note !== null) {
            const noteInput = editor.createEl('input', {
                cls: 'atoz-record-note-input',
                type: 'text',
                attr: { placeholder: record.noteLabel },
            });
            noteInput.value = this.editNote;
            noteInput.addEventListener('input', () => { this.editNote = noteInput.value; });
            inputs.push(noteInput);
        }

        const save = async (): Promise<void> => {
            const match = /^(\d{2}):(\d{2})$/.exec(this.editTime);
            if (!match) return;
            const date = new Date(record.time);
            date.setHours(Number(match[1]), Number(match[2]), 0, 0);
            this.editingKey = null;
            await record.save(date.getTime(), this.editNote.trim());
            this.render();
        };
        for (const input of inputs) {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.isComposing) {
                    event.preventDefault();
                    void save();
                }
            });
        }
        this.addRecordAction(editor, 'check', t('daynight.save'), () => void save());
        this.addRecordAction(editor, 'trash-2', t('record.delete'), () => {
            this.editingKey = null;
            void record.remove();
        });
        this.addRecordAction(editor, 'x', t('daynight.cancel'), () => {
            this.editingKey = null;
            this.render();
        });
    }

    private pills(container: HTMLElement, title: string): HTMLElement {
        const section = container.createDiv({ cls: 'atoz-record-section' });
        section.createDiv({ cls: 'atoz-record-section-title', text: title });
        return section.createDiv({ cls: 'atoz-record-pills' });
    }

    private pill(parent: HTMLElement, text: string, isActive: boolean, onClick: () => void): HTMLButtonElement {
        const button = parent.createEl('button', { cls: 'atoz-record-pill' });
        button.toggleClass('is-active', isActive);
        button.createSpan({ text });
        button.addEventListener('click', onClick);
        return button;
    }

    private renderSpending(container: HTMLElement): void {
        const categories = this.plugin.settings.budgetPanelCategories;
        if (categories.length === 0) return;
        const pills = this.pills(container, t('record.spending'));
        for (const category of categories) {
            const isActive = this.amountTarget?.category === category && this.amountTarget.meal === null;
            this.pill(pills, category, isActive, () => this.openAmount({ category, meal: null }));
        }
    }

    // 가계부 지출 카테고리와 이름이 같은 식사(외식·배달·간식)는 금액 칸을 함께 연다.
    private renderMeals(container: HTMLElement): void {
        const settings = this.plugin.settings;
        if (settings.mealLegend.length === 0) return;
        const pills = this.pills(container, t('record.meal'));
        for (const item of settings.mealLegend) {
            const hasAmount = settings.budgetExpenseCategories.includes(item.label);
            const isActive = this.amountTarget?.meal === item;
            const button = this.pill(pills, item.label, isActive, () => {
                if (hasAmount) this.openAmount({ category: item.label, meal: item });
                else void this.plugin.meal.add(Date.now(), '', item);
            });
            button.prepend(createMealMarker(button, this.plugin, item));
        }
    }

    // 활성 알약을 다시 누르면 그 활동이 끝난다.
    private renderActivities(container: HTMLElement): void {
        const pills = this.pills(container, t('record.activity'));
        const blocks = this.plugin.timeline.blocks;
        if (blocks.length === 0) {
            const button = this.pill(pills, t('record.addBlocks'), false, () => void this.plugin.timeline.openBlocks());
            setIcon(button.createSpan({ cls: 'atoz-record-pill-icon' }), 'plus');
            return;
        }
        const current = this.plugin.timeline.current()?.category;
        for (const name of blocks) {
            this.pill(pills, name, current === name, () => {
                void this.plugin.timeline.addLog(Date.now(), current === name ? END_CATEGORY : name);
            });
        }
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
        const form = container.createDiv({ cls: 'atoz-record-amount' });
        const head = form.createDiv({ cls: 'atoz-record-amount-head' });
        head.createSpan({ cls: 'atoz-record-amount-title', text: target.category });
        // 식사에서 연 금액은 언제나 지출이다.
        if (target.meal === null) {
            const kinds = head.createDiv({ cls: 'atoz-budget-segment' });
            for (const kind of ['expense', 'income'] as const) {
                const button = kinds.createEl('button', {
                    cls: 'atoz-budget-segment-button',
                    text: t(kind === 'income' ? 'budget.income' : 'budget.expense'),
                });
                button.toggleClass('is-active', this.amountKind === kind);
                button.addEventListener('click', () => {
                    this.amountKind = kind;
                    kinds.querySelectorAll('button').forEach((el) => el.toggleClass('is-active', el === button));
                });
            }
        }
        renderPaymentToggle(
            form,
            this.plugin.settings.budgetPayments,
            () => this.amountPayment,
            (payment) => { this.amountPayment = payment; },
        );

        const row = form.createDiv({ cls: 'atoz-record-amount-row' });
        const input = row.createEl('input', { type: 'text', cls: 'atoz-budget-amount-input' });
        // 'numeric'은 iOS 키패드에 소수점이 없다.
        input.inputMode = 'decimal';
        input.placeholder = target.meal ? t('record.amountOptional') : '0';
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
        this.addRecordAction(row, 'check', t('daynight.save'), () => void this.submitAmount());
        this.addRecordAction(row, 'x', t('daynight.cancel'), () => {
            this.amountTarget = null;
            this.render();
        });
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
