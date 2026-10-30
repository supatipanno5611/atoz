import { Notice, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { isKorean, t } from '../locales';
import { formatDuration, pad } from './Daynight';
import { formatDayLabel, renderPageHeader } from './PageHeader';
import { applyColor, dayRange, shiftDate, timelineToday, type BlockItem, type LaterItem } from './Timeline';

const MINUTE = 60 * 1000;
// 블록에 분이 없으면 계획에 이만큼 쌓는다.
const DEFAULT_MINUTES = 30;
const STEP = 15;
// 미리보기에서 1분의 높이
const PX_PER_MINUTE = 0.6;
// 미리보기 블록이 이보다 낮으면 이름을 뺀다.
const LABEL_MIN_HEIGHT = 14;
// 이 폭보다 좁으면 트레이 → 목록 → 접힌 미리보기 순서로 쌓는다. styles.css의 container query와 같은 값이다.
const NARROW_WIDTH = 560;
// blocks.md의 반복 요일. 한국어와 영어 약어를 모두 받는다.
const WEEKDAYS: Record<string, number> = {
    일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

// 계획에 쌓은 블록. 시각은 그 날짜 0시부터의 분이라 자정을 넘기면 1440을 넘는다.
interface PlanItem {
    name: string;
    minutes: number;
    // null이면 앞 블록 바로 뒤에 붙는다.
    pinned: number | null;
    memo: string;
    // later.md에서 가져온 할 일. 저장할 때 그 파일에서 지운다.
    later: LaterItem | null;
}

interface Draft {
    start: number;
    items: PlanItem[];
    isDirty: boolean;
}

function formatMinutes(minutes: number): string {
    const value = ((minutes % 1440) + 1440) % 1440;
    return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function formatLength(minutes: number): string {
    if (minutes < 60) return t('record.minutes', { minutes });
    return minutes % 60 === 0 ? t('plan.hours', { hours: minutes / 60 }) : formatDuration(minutes * MINUTE);
}

function weekdayOf(key: string): number {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year!, month! - 1, day).getDay();
}

function repeatsOn(block: BlockItem, weekday: number): boolean {
    return block.repeat.some((day) => WEEKDAYS[day.toLowerCase().slice(0, 3)] === weekday);
}

// 워크스페이스에 저장해 둔 초안은 믿기 전에 모양을 확인한다.
function isSavedDraft(value: unknown): value is Omit<Draft, 'isDirty'> {
    if (typeof value !== 'object' || value === null) return false;
    const { start, items } = value as Record<string, unknown>;
    return typeof start === 'number' && Array.isArray(items) && items.every((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false;
        const { name, minutes, pinned, memo, later } = item as Record<string, unknown>;
        return typeof name === 'string' && typeof minutes === 'number' && typeof memo === 'string'
            && (pinned === null || typeof pinned === 'number')
            && (later === null || (typeof later === 'object' && typeof (later as Record<string, unknown>).line === 'string'));
    });
}

export class PlanPage {
    private date = '';
    // 날짜별로 고치는 중인 계획. 저장하기 전에 다른 날을 다녀와도, 앱을 껐다 켜도 남는다.
    private drafts = new Map<string, Draft>();
    private isFormShown = false;
    private notice = '';
    // 좁은 화면에서 미리보기를 펼쳤는가. 넓은 화면에서는 늘 펼친다.
    private isPreviewOpen = false;

    constructor(private plugin: ATOZPlugin, private container: HTMLElement) {
        container.addClass('atoz-plan');
        // 좁을 때 그려 접힌 미리보기가 넓어진 뒤에도 접혀 빈 상자로 남지 않게, 넓어지면 편다.
        new ResizeObserver(() => {
            if (container.clientWidth < NARROW_WIDTH) return;
            const details = container.querySelector<HTMLDetailsElement>('.atoz-plan-preview');
            if (details && !details.open) details.open = true;
        }).observe(container);
    }

    getState(): Record<string, unknown> {
        // 저장하지 않은 오늘 이후의 초안만 남긴다. 지난 날은 고칠 수 없다.
        const today = timelineToday(this.plugin);
        const drafts: Record<string, Omit<Draft, 'isDirty'>> = {};
        for (const [date, { start, items, isDirty }] of this.drafts) {
            if (isDirty && date >= today) drafts[date] = { start, items };
        }
        return { date: this.date, drafts };
    }

    setState(state: Record<string, unknown>): void {
        if (typeof state.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.date)) this.date = state.date;
        if (typeof state.drafts === 'object' && state.drafts !== null) {
            for (const [date, draft] of Object.entries(state.drafts)) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(date) && isSavedDraft(draft)) this.drafts.set(date, { ...draft, isDirty: true });
            }
        }
    }

    /** 파일이 바뀌어 다시 그릴 때, 입력 중이면 입력이 끊기지 않게 건너뛴다. */
    render(): void {
        const active = activeDocument.activeElement;
        if (active instanceof HTMLInputElement && this.container.contains(active)) return;
        this.draw();
    }

    private draw(): void {
        const plugin = this.plugin;
        const today = timelineToday(plugin);
        if (!this.date) this.date = today;
        const container = this.container;
        container.empty();

        const moveTo = (date: string): void => {
            this.date = date;
            this.notice = '';
            plugin.app.workspace.requestSaveLayout();
            this.draw();
        };
        renderPageHeader(container, {
            label: formatDayLabel(this.date),
            previousLabel: t('timeline.previousDay'),
            nextLabel: t('timeline.nextDay'),
            onMove: (delta) => moveTo(shiftDate(this.date, delta)),
            isToday: this.date === today,
            onToday: () => moveTo(today),
            menu: [{ title: t('plan.openBlocks'), icon: 'file-text', onClick: () => void plugin.timeline.openBlocks() }],
        });

        if (this.date < today) this.renderPast(container);
        else this.renderEditor(container);
    }

    /** 그 날짜 0시. 계획 시각은 여기서부터 센다. */
    private midnight(): number {
        const [year, month, day] = this.date.split('-').map(Number);
        return new Date(year!, month! - 1, day).getTime();
    }

    private savedPlans(): { from: number; to: number; category: string; memo: string }[] {
        const [start, end] = dayRange(this.date, this.plugin.settings.timelineDayStartHour);
        return this.plugin.timeline.plans.filter((plan) => plan.from >= start && plan.from < end);
    }

    /** 고치는 중인 계획이 없으면 저장된 계획에서 만든다. */
    private draft(): Draft {
        const existing = this.drafts.get(this.date);
        if (existing?.isDirty) return existing;
        const midnight = this.midnight();
        const plans = this.savedPlans();
        let start: number;
        if (plans.length > 0) {
            start = Math.round((plans[0]!.from - midnight) / MINUTE);
        } else if (this.date === timelineToday(this.plugin)) {
            // 오늘은 지금 이후 첫 15분 단위에서 시작한다.
            start = Math.ceil((Date.now() - midnight) / MINUTE / STEP) * STEP;
        } else {
            start = 8 * 60;
        }
        let cursor = start;
        const items = plans.map((plan): PlanItem => {
            const from = Math.round((plan.from - midnight) / MINUTE);
            const minutes = Math.round((plan.to - plan.from) / MINUTE);
            const item = { name: plan.category, minutes, pinned: from === cursor ? null : from, memo: plan.memo, later: null };
            cursor = from + minutes;
            return item;
        });
        const draft = { start, items, isDirty: false };
        this.drafts.set(this.date, draft);
        return draft;
    }

    private change(draft: Draft, update: () => void): void {
        update();
        draft.isDirty = true;
        this.notice = '';
        this.plugin.app.workspace.requestSaveLayout();
        this.draw();
    }

    /** 'HH:MM'을 그 날짜의 분으로 바꾼다. 하루 시작 시각보다 이르면 자정을 넘긴 시각이다. */
    private parseTime(value: string): number | null {
        const match = /^(\d{2}):(\d{2})$/.exec(value);
        if (!match) return null;
        const minutes = Number(match[1]) * 60 + Number(match[2]);
        return minutes < this.plugin.settings.timelineDayStartHour * 60 ? minutes + 1440 : minutes;
    }

    private renderEditor(container: HTMLElement): void {
        const plugin = this.plugin;
        const draft = this.draft();

        let cursor = draft.start;
        const computed = draft.items.map((item) => {
            const from = item.pinned ?? cursor;
            const gap = item.pinned !== null && from > cursor ? from - cursor : 0;
            const overlap = item.pinned !== null && from < cursor ? cursor - from : 0;
            const to = from + item.minutes;
            cursor = to;
            return { item, from, to, gap, overlap };
        });
        const end = cursor;

        const body = container.createDiv({ cls: 'atoz-plan-body' });
        // 좁은 화면에서는 미리보기를 목록 아래로 내리고 접어 둔다(순서는 CSS).
        const details = body.createEl('details', { cls: 'atoz-plan-preview' });
        details.open = this.container.clientWidth >= NARROW_WIDTH || this.isPreviewOpen;
        details.createEl('summary', { text: t('plan.preview') });
        details.addEventListener('toggle', () => {
            if (this.container.clientWidth < NARROW_WIDTH) this.isPreviewOpen = details.open;
        });
        const preview = details.createDiv();
        const main = body.createDiv({ cls: 'atoz-plan-main' });

        // 미리보기: 쌓은 블록이 있는 시간대만 앞뒤 1시간 여유를 두고 그린다.
        const firstHour = computed.length > 0 ? Math.floor(Math.min(...computed.map((c) => c.from)) / 60) - 1 : 6;
        const lastHour = computed.length > 0 ? Math.ceil(Math.max(...computed.map((c) => c.to)) / 60) + 1 : 22;
        const lane = preview.createDiv({ cls: 'atoz-plan-lane' });
        lane.style.height = `${(lastHour - firstHour) * 60 * PX_PER_MINUTE}px`;
        for (let hour = firstHour; hour <= lastHour; hour++) {
            const tick = lane.createDiv({ cls: 'atoz-timeline-hour' });
            tick.style.top = `${(hour - firstHour) * 60 * PX_PER_MINUTE}px`;
            if (hour < lastHour) tick.createSpan({ text: pad(((hour % 24) + 24) % 24) });
        }
        for (const { item, from, to } of computed) {
            const block = lane.createDiv({ cls: 'atoz-plan-lane-block' });
            applyColor(block, plugin, item.name);
            const height = Math.max(4, (to - from) * PX_PER_MINUTE - 2);
            block.style.top = `${(from - firstHour * 60) * PX_PER_MINUTE}px`;
            block.style.height = `${height}px`;
            if (height >= LABEL_MIN_HEIGHT) block.setText(item.name);
        }

        this.renderTray(main, draft);
        this.renderList(main, draft, computed, end);
    }

    private renderTray(container: HTMLElement, draft: Draft): void {
        const plugin = this.plugin;
        const tray = container.createDiv({ cls: 'atoz-plan-tray' });
        const weekday = weekdayOf(this.date);
        const taken = new Set(draft.items.map((item) => item.name));
        const takenLater = new Set(draft.items.map((item) => item.later?.line).filter(Boolean));
        const blocks = plugin.timeline.blockItems;
        const later = plugin.timeline.later.filter((item) => !takenLater.has(item.line));
        const today = timelineToday(plugin);

        const addItem = (name: string, minutes: number | null, memo: string, laterItem: LaterItem | null): void =>
            this.change(draft, () => draft.items.push({ name, minutes: minutes ?? DEFAULT_MINUTES, pinned: null, memo, later: laterItem }));
        const pill = (parent: HTMLElement, name: string, minutes: number | null, onClick: () => void): HTMLButtonElement => {
            const button = parent.createEl('button', { cls: 'atoz-plan-pill' });
            applyColor(button.createSpan({ cls: 'atoz-timeline-dot' }), plugin, name);
            button.createSpan({ text: name });
            if (minutes !== null) button.createSpan({ cls: 'atoz-plan-muted', text: formatLength(minutes) });
            button.addEventListener('click', onClick);
            return button;
        };
        const blockPill = (parent: HTMLElement, block: BlockItem): void => {
            const button = pill(parent, block.name, block.minutes, () => addItem(block.name, block.minutes, '', null));
            if (block.repeat.length > 0) button.setAttr('title', t('plan.everyWeek', { days: block.repeat.join(',') }));
            button.toggleClass('is-taken', taken.has(block.name));
        };
        const laterPill = (parent: HTMLElement, item: LaterItem): void => {
            const button = pill(parent, item.name, item.minutes, () => addItem(item.name, item.minutes, item.memo, item));
            button.addClass('is-later');
            button.setAttr('title', item.date ? t('plan.booked', { date: item.date }) : item.memo || t('plan.deferred'));
        };
        const row = (label: string): HTMLElement => {
            const el = tray.createDiv({ cls: 'atoz-plan-tray-row' });
            el.createSpan({ cls: 'atoz-plan-tray-label', text: label });
            return el.createDiv({ cls: 'atoz-plan-pills' });
        };
        const emptyIf = (pills: HTMLElement): void => {
            if (pills.childElementCount === 0) pills.createSpan({ cls: 'atoz-plan-muted', text: t('plan.none') });
        };

        // 오늘: 그 요일 반복 블록과 그날로 예약한 일
        const todayPills = row(t('plan.today'));
        blocks.filter((block) => repeatsOn(block, weekday)).forEach((block) => blockPill(todayPills, block));
        later.filter((item) => item.date === this.date).forEach((item) => laterPill(todayPills, item));
        emptyIf(todayPills);

        // 미룬 일: 날짜가 없거나 이미 지난 예약
        const deferredPills = row(t('plan.deferred'));
        later.filter((item) => !item.date || item.date < today).forEach((item) => laterPill(deferredPills, item));
        emptyIf(deferredPills);

        const blockPills = row(t('plan.blocks'));
        blocks.filter((block) => !repeatsOn(block, weekday)).forEach((block) => blockPill(blockPills, block));
        const add = blockPills.createEl('button', { cls: 'atoz-plan-pill is-add', attr: { 'aria-label': t('plan.newBlock') } });
        setIcon(add, 'plus');
        add.addEventListener('click', () => {
            this.isFormShown = !this.isFormShown;
            this.draw();
        });

        if (this.isFormShown) this.renderBlockForm(tray);
    }

    private renderBlockForm(container: HTMLElement): void {
        const form = container.createEl('form', { cls: 'atoz-plan-form' });
        const input = (placeholder: string, cls: string): HTMLInputElement =>
            form.createEl('input', { cls, type: 'text', attr: { placeholder, 'aria-label': placeholder } });
        const name = input(t('plan.blockName'), 'atoz-plan-form-name');
        const minutes = input(t('plan.minutes'), 'atoz-plan-form-minutes');
        minutes.inputMode = 'numeric';
        // 반복 요일은 월~일 토글로 고른다. 2024-01-01은 월요일이다.
        const days = form.createDiv({ cls: 'atoz-plan-form-days', attr: { role: 'group', 'aria-label': t('plan.repeat') } });
        const picked = new Set<string>();
        const labels = Array.from({ length: 7 }, (_, i) =>
            new Date(2024, 0, 1 + i).toLocaleDateString(isKorean ? 'ko-KR' : 'en-US', { weekday: 'short' }));
        for (const label of labels) {
            const day = days.createEl('button', { type: 'button', text: label, attr: { 'aria-pressed': 'false' } });
            day.addEventListener('click', () => {
                if (picked.has(label)) picked.delete(label);
                else picked.add(label);
                day.toggleClass('is-active', picked.has(label));
                day.setAttr('aria-pressed', String(picked.has(label)));
            });
        }
        form.createEl('button', { cls: 'mod-cta', type: 'submit', text: t('plan.saveBlock') });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const value = name.value.trim();
            const parsed = Number(minutes.value.trim());
            if (!value) return;
            const length = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
            this.isFormShown = false;
            name.blur();
            void this.plugin.timeline.addBlock(value, length, labels.filter((label) => picked.has(label)).join(','));
        });
        window.setTimeout(() => name.focus(), 0);
    }

    private renderList(
        container: HTMLElement,
        draft: Draft,
        computed: { item: PlanItem; from: number; to: number; gap: number; overlap: number }[],
        end: number,
    ): void {
        const plugin = this.plugin;
        const section = container.createDiv({ cls: 'atoz-plan-list' });

        const head = section.createDiv({ cls: 'atoz-plan-list-head' });
        head.createEl('label', { text: t('plan.start'), attr: { for: 'atoz-plan-start' } });
        const start = head.createEl('input', { type: 'time', attr: { id: 'atoz-plan-start' } });
        start.value = formatMinutes(draft.start);
        start.addEventListener('change', () => {
            const value = this.parseTime(start.value);
            if (value !== null) this.change(draft, () => { draft.start = value; });
        });
        const total = draft.items.reduce((sum, item) => sum + item.minutes, 0);
        if (total > 0) {
            head.createSpan({
                cls: 'atoz-plan-muted atoz-plan-total',
                text: t('plan.total', { total: formatLength(total), end: formatMinutes(end) }),
            });
        }

        const rows = section.createDiv({ cls: 'atoz-plan-rows' });
        computed.forEach(({ item, from, to, gap, overlap }, index) => {
            const wrap = rows.createDiv({ cls: 'atoz-plan-row-wrap' });
            if (gap > 0) wrap.createDiv({ cls: 'atoz-plan-gap', text: t('plan.gap', { duration: formatLength(gap) }) });
            const row = wrap.createDiv({ cls: 'atoz-plan-row' });
            row.toggleClass('is-overlap', overlap > 0);

            const handle = row.createDiv({ cls: 'atoz-plan-handle', attr: { 'aria-label': t('plan.drag'), tabindex: 0 } });
            setIcon(handle, 'grip-vertical');
            this.makeDraggable(handle, rows, draft, index);

            const times = row.createDiv({ cls: 'atoz-plan-times' });
            if (item.pinned !== null) {
                const pin = times.createEl('input', { type: 'time', attr: { 'aria-label': t('plan.pinnedTime') } });
                pin.value = formatMinutes(from);
                pin.addEventListener('change', () => {
                    const value = this.parseTime(pin.value);
                    if (value !== null) this.change(draft, () => { item.pinned = value; });
                });
            } else {
                times.createSpan({ cls: 'atoz-plan-from', text: formatMinutes(from) });
            }
            times.createSpan({ text: formatMinutes(to) });

            applyColor(row.createSpan({ cls: 'atoz-plan-bar' }), plugin, item.name);

            const info = row.createDiv({ cls: 'atoz-plan-info' });
            info.createSpan({ cls: 'atoz-plan-name', text: item.name });
            const memo = info.createEl('input', {
                cls: 'atoz-plan-memo',
                type: 'text',
                attr: { placeholder: t('plan.memo'), 'aria-label': t('plan.memo') },
            });
            memo.value = item.memo;
            // 다시 그리지 않고 값만 바꾼다. 다시 그리면 메모를 쓰다 저장 버튼을 누를 때 버튼이 사라진다.
            memo.addEventListener('input', () => {
                item.memo = memo.value.trim();
                draft.isDirty = true;
                plugin.app.workspace.requestSaveLayout();
            });
            memo.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.isComposing) memo.blur();
            });
            if (overlap > 0) info.createSpan({ cls: 'atoz-plan-overlap', text: t('plan.overlap', { duration: formatLength(overlap) }) });

            const actions = row.createDiv({ cls: 'atoz-plan-actions' });
            const action = (icon: string, label: string, onClick: () => void): HTMLButtonElement => {
                const button = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
                setIcon(button, icon);
                button.addEventListener('click', onClick);
                return button;
            };
            action('minus', t('plan.decrease'), () => this.change(draft, () => { item.minutes = Math.max(STEP, item.minutes - STEP); }));
            actions.createSpan({ cls: 'atoz-plan-length', text: formatLength(item.minutes) });
            action('plus', t('plan.increase'), () => this.change(draft, () => { item.minutes += STEP; }));
            // 핀 아이콘만으로는 뜻을 알기 어려워 '시각 고정'을 함께 적는다.
            const pin = action('pin', item.pinned !== null ? t('plan.unpin') : t('plan.pin'), () =>
                this.change(draft, () => { item.pinned = item.pinned !== null ? null : from; }));
            pin.addClass('atoz-plan-pin');
            pin.toggleClass('is-active', item.pinned !== null);
            pin.createSpan({ text: t('plan.pinLabel') });
            action('x', t('plan.remove'), () => this.change(draft, () => { draft.items.splice(index, 1); }));
        });
        if (draft.items.length === 0) section.createDiv({ cls: 'atoz-plan-empty', text: t('plan.empty') });

        const footer = section.createDiv({ cls: 'atoz-plan-footer' });
        footer.createSpan({
            cls: 'atoz-plan-muted atoz-plan-notice',
            text: this.notice || (draft.isDirty ? t('plan.unsaved') : t('plan.saveHint')),
        });
        const save = footer.createEl('button', { cls: 'mod-cta', text: t('plan.save') });
        save.addEventListener('click', () => void this.save(draft, computed));
    }

    // 손잡이를 끌면 놓을 자리 위에 선을 긋고, 놓으면 그 자리로 옮긴다. 터치에서도 되도록 포인터 이벤트를 쓴다.
    // 키보드는 손잡이에 초점을 두고 Alt+↑/↓로 한 칸씩 옮긴다.
    private makeDraggable(handle: HTMLElement, rows: HTMLElement, draft: Draft, index: number): void {
        handle.addEventListener('keydown', (event) => {
            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            const to = index + (event.key === 'ArrowUp' ? -1 : 1);
            if (to < 0 || to >= draft.items.length) return;
            event.preventDefault();
            this.change(draft, () => {
                const [moved] = draft.items.splice(index, 1);
                draft.items.splice(to, 0, moved!);
            });
            this.container.querySelectorAll<HTMLElement>('.atoz-plan-handle')[to]?.focus();
        });
        handle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            const wraps = Array.from(rows.children) as HTMLElement[];
            wraps[index]?.addClass('is-dragging');
            let target = index;
            const mark = (): void => wraps.forEach((wrap, i) => {
                wrap.toggleClass('is-drop-before', i === target && target !== index && target !== index + 1);
                wrap.toggleClass('is-drop-after', i === wraps.length - 1 && target === wraps.length && index !== wraps.length - 1);
            });
            const onMove = (move: PointerEvent): void => {
                target = wraps.filter((wrap) => {
                    const rect = wrap.getBoundingClientRect();
                    return rect.top + rect.height / 2 < move.clientY;
                }).length;
                mark();
            };
            const onUp = (): void => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                if (target === index || target === index + 1) {
                    this.draw();
                    return;
                }
                this.change(draft, () => {
                    const [moved] = draft.items.splice(index, 1);
                    draft.items.splice(target > index ? target - 1 : target, 0, moved!);
                });
            };
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        });
    }

    private async save(draft: Draft, computed: { item: PlanItem; from: number; to: number }[]): Promise<void> {
        const midnight = this.midnight();
        const date = this.date;
        const used = draft.items.map((item) => item.later).filter((item): item is LaterItem => item !== null);
        try {
            await this.plugin.timeline.savePlan(date, computed.map(({ item, from, to }) => ({
                from: midnight + from * MINUTE,
                to: midnight + to * MINUTE,
                category: item.name,
                memo: item.memo,
            })));
            await this.plugin.timeline.removeLater(used);
        } catch (error) {
            console.error(error);
            new Notice(t('plan.saveFailed'));
            return;
        }
        // 저장한 계획을 파일에서 다시 만든다.
        this.drafts.delete(date);
        this.plugin.app.workspace.requestSaveLayout();
        if (this.date === date) this.notice = t('plan.saved');
        this.draw();
    }

    /** 지난 날: 블록마다 미루기를 눌러 later.md로 넘긴다. 원래 계획 줄은 그대로 둔다. */
    private renderPast(container: HTMLElement): void {
        const plugin = this.plugin;
        const section = container.createDiv({ cls: 'atoz-plan-list atoz-plan-past' });
        const plans = this.savedPlans();
        if (plans.length === 0) {
            section.createDiv({ cls: 'atoz-plan-empty', text: t('plan.pastEmpty') });
            return;
        }
        section.createDiv({ cls: 'atoz-plan-muted', text: t('plan.pastHint') });
        const [, month, day] = this.date.split('-').map(Number);
        const memo = t('plan.deferMemo', { date: `${pad(month!)}/${pad(day!)}` });
        for (const plan of plans) {
            const row = section.createDiv({ cls: 'atoz-plan-row' });
            const clock = (time: number): string => {
                const date = new Date(time);
                return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
            };
            row.createSpan({ cls: 'atoz-plan-range', text: `${clock(plan.from)}–${clock(plan.to)}` });
            applyColor(row.createSpan({ cls: 'atoz-plan-bar' }), plugin, plan.category);
            row.createSpan({ cls: 'atoz-plan-name', text: plan.category });
            const isDeferred = plugin.timeline.later.some((item) => !item.date && item.name === plan.category && item.memo === memo);
            const button = row.createEl('button', { text: isDeferred ? t('plan.deferDone') : t('plan.defer') });
            button.disabled = isDeferred;
            button.addEventListener('click', () => {
                button.disabled = true;
                void plugin.timeline.addLater({
                    date: '',
                    name: plan.category,
                    minutes: Math.round((plan.to - plan.from) / MINUTE),
                    memo,
                });
            });
        }
    }
}
