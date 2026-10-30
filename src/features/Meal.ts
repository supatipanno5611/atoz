import { Modal, Setting, TAbstractFile, TFile, getIcon, getIconIds, normalizePath, setIcon, setTooltip } from 'obsidian';
import type ATOZPlugin from '../main';
import { isKorean, t } from '../locales';
import { makeClickable } from '../utils';
import { formatWon } from './Budget';
import { formatMonthLabel, formatWeekLabel, renderPageHeader } from './PageHeader';
import type { MealLegendItem, MealPick } from '../types';
import { MEAL_SPENDING_GAP, entryTime, pad } from './Daynight';
import { shiftDate } from './Timeline';

const DEFAULT_FOLDER = 'meal';
const TABLE_HEADER = '| Date | Time | Food | Icon | Color |\n| --- | --- | --- | --- | --- |\n';
// 음식 칸은 가운데에 있으므로 욕심껏 잡고, 아이콘과 색 칸에는 |가 없다.
const ROW_PATTERN = /^\|\s*(\d{4})-(\d{2})-(\d{2})\s*\|\s*(\d{2}):(\d{2})\s*\|(.*)\|([^|]*)\|([^|]*)\|$/;
const FILE_NAME_PATTERN = /^meal-\d{4}-\d{2}\.md$/;
const SLOT_PATTERN = /^c-(\d+)$/;
const HOUR = 60 * 60 * 1000;
const RELOAD_DELAY = 100;
// 이 시간 안에 이어진 표시는 옆으로 밀어 겹치지 않게 한다.
const OVERLAP_HOURS = 0.75;
const ICON_RESULT_LIMIT = 60;
const SUGGESTED_ICONS = [
    'soup', 'pizza', 'sandwich', 'beef', 'drumstick', 'fish', 'egg', 'salad', 'croissant', 'cake',
    'cookie', 'ice-cream-cone', 'apple', 'coffee', 'cup-soda', 'milk', 'beer', 'wine', 'popcorn', 'candy',
    'utensils', 'house', 'bike', 'store', 'moon',
];

export function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export interface MealRecord {
    time: number;
    food: string;
    icon: string;
    color: string;
    file: TFile;
    line: string;
}

function toDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatClock(time: number): string {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRow(time: number, food: string, { icon, color }: MealPick): string {
    // 표가 깨지지 않도록 음식 이름의 |와 줄바꿈은 바꿔 적는다.
    const cell = food.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
    return `| ${toDateKey(new Date(time))} | ${formatClock(time)} | ${cell} | ${icon} | ${color} |`;
}

function shiftMonth(month: string, delta: number): string {
    const [year, mon] = month.split('-').map(Number);
    const date = new Date(year!, mon! - 1 + delta, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function samePick(a: MealPick, b: MealPick): boolean {
    return a.icon === b.icon && a.color === b.color;
}

/** 팔레트 슬롯의 라이트·다크 색을 붙인 표시를 만든다. 없는 슬롯이면 흐린 회색으로 그린다. */
export function createMealMarker(parent: HTMLElement, plugin: ATOZPlugin, { icon, color }: MealPick): HTMLElement {
    const marker = parent.createDiv({ cls: 'atoz-meal-marker' });
    const slot = plugin.meal.colorOf(color);
    if (slot) {
        marker.style.setProperty('--atoz-meal-light', slot.light);
        marker.style.setProperty('--atoz-meal-dark', slot.dark);
    } else {
        marker.addClass('is-unknown');
    }
    setIcon(marker, getIcon(icon) ? icon : 'circle-help');
    return marker;
}

/** 아이콘 검색과 팔레트로 표시를 고른다. 고를 때마다 다시 그린다. */
function renderPicker(container: HTMLElement, plugin: ATOZPlugin, pick: MealPick, onChange: () => void): void {
    container.empty();
    container.addClass('atoz-meal-picker');

    const search = container.createEl('input', { type: 'text', attr: { placeholder: t('meal.picker.search') } });
    const icons = container.createDiv({ cls: 'atoz-meal-picker-icons' });
    const drawIcons = (): void => {
        icons.empty();
        const query = search.value.trim().toLowerCase();
        const ids = query
            ? [...new Set(getIconIds().map((id) => id.replace(/^lucide-/, '')))].filter((id) => id.includes(query))
            : SUGGESTED_ICONS;
        for (const id of ids.slice(0, ICON_RESULT_LIMIT)) {
            const button = icons.createEl('button', { cls: 'clickable-icon' });
            if (id === pick.icon) button.addClass('is-active');
            setIcon(button, id);
            setTooltip(button, id);
            button.addEventListener('click', () => {
                pick.icon = id;
                drawIcons();
                onChange();
            });
        }
    };
    search.addEventListener('input', drawIcons);
    drawIcons();

    const colors = container.createDiv({ cls: 'atoz-meal-picker-colors' });
    plugin.settings.mealPalette.forEach((_, i) => {
        const name = `c-${i + 1}`;
        const swatch = createMealMarker(colors, plugin, { icon: 'circle', color: name });
        swatch.addClass('atoz-meal-swatch');
        if (name === pick.color) swatch.addClass('is-active');
        setTooltip(swatch, name);
        swatch.addEventListener('click', () => {
            pick.color = name;
            colors.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
            swatch.addClass('is-active');
            onChange();
        });
    });
}

class MealModal extends Modal {
    private pick: MealPick;
    private isCustom = false;

    constructor(private plugin: ATOZPlugin) {
        super(plugin.app);
        const settings = plugin.settings;
        const base = settings.mealLastPick ?? settings.mealLegend[0] ?? { icon: 'utensils', color: 'c-1' };
        this.pick = { icon: base.icon, color: base.color };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('atoz-meal-modal');
        this.setTitle(t('meal.modal.addTitle'));

        const now = Date.now();
        const when = contentEl.createDiv({ cls: 'atoz-meal-modal-when' });
        const dateInput = when.createEl('input', { type: 'date', value: toDateKey(new Date(now)) });
        const timeInput = when.createEl('input', { type: 'time', value: formatClock(now) });
        const foodInput = contentEl.createEl('input', {
            type: 'text',
            cls: 'atoz-meal-modal-food',
            attr: { placeholder: t('meal.modal.foodPlaceholder') },
        });

        const chips = contentEl.createDiv({ cls: 'atoz-meal-legend' });
        const custom = contentEl.createDiv({ cls: 'atoz-meal-modal-custom' });
        const picker = custom.createDiv();
        const nameInput = custom.createEl('input', { type: 'text', attr: { placeholder: t('meal.modal.legendName') } });

        const drawChips = (): void => {
            chips.empty();
            for (const item of this.plugin.settings.mealLegend) {
                const chip = chips.createDiv({ cls: 'atoz-meal-chip' });
                if (!this.isCustom && samePick(item, this.pick)) chip.addClass('is-active');
                createMealMarker(chip, this.plugin, item);
                chip.createSpan({ text: item.label });
                chip.addEventListener('click', () => {
                    this.pick = { icon: item.icon, color: item.color };
                    this.isCustom = false;
                    custom.hide();
                    drawChips();
                });
            }
            const toggle = chips.createDiv({ cls: 'atoz-meal-chip', text: t('meal.modal.custom') });
            if (this.isCustom) toggle.addClass('is-active');
            toggle.addEventListener('click', () => {
                this.isCustom = true;
                custom.show();
                renderPicker(picker, this.plugin, this.pick, () => undefined);
                drawChips();
            });
        };
        custom.hide();
        drawChips();

        const save = async (): Promise<void> => {
            const [year, month, day] = dateInput.value.split('-').map(Number);
            const [hour, minute] = timeInput.value.split(':').map(Number);
            const time = new Date(year!, month! - 1, day, hour, minute).getTime();
            if (Number.isNaN(time)) return;
            this.close();
            await this.plugin.meal.add(time, foodInput.value, this.pick);
            await this.plugin.meal.remember(this.pick, this.isCustom ? nameInput.value.trim() : null);
        };
        for (const input of [dateInput, timeInput, foodInput, nameInput]) {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.isComposing) {
                    event.preventDefault();
                    void save();
                }
            });
        }
        new Setting(contentEl).addButton((button) => button
            .setButtonText(t('meal.modal.save'))
            .setCta()
            .onClick(() => void save()));
        foodInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/** 범례 항목 하나를 고치거나 새로 만든다. item이 없으면 새 항목이다. */
class LegendModal extends Modal {
    constructor(private plugin: ATOZPlugin, private item?: MealLegendItem) {
        super(plugin.app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('atoz-meal-modal');
        this.setTitle(t(this.item ? 'meal.legend.editTitle' : 'meal.legend.addTitle'));
        const pick: MealPick = this.item ? { icon: this.item.icon, color: this.item.color } : { icon: 'utensils', color: 'c-1' };
        const nameInput = contentEl.createEl('input', {
            type: 'text',
            cls: 'atoz-meal-modal-food',
            value: this.item?.label ?? '',
            attr: { placeholder: t('meal.modal.legendName') },
        });
        renderPicker(contentEl.createDiv(), this.plugin, pick, () => undefined);

        const footer = new Setting(contentEl);
        if (this.item) {
            const item = this.item;
            footer.addButton((button) => button
                .setButtonText(t('meal.legend.delete'))
                .setDestructive()
                .onClick(async () => {
                    this.plugin.settings.mealLegend.remove(item);
                    await this.saveLegend();
                }));
        }
        footer.addButton((button) => button
            .setButtonText(t('meal.modal.save'))
            .setCta()
            .onClick(async () => {
                const label = nameInput.value.trim();
                if (this.item) Object.assign(this.item, pick, { label });
                else this.plugin.settings.mealLegend.push({ ...pick, label });
                await this.saveLegend();
            }));
        nameInput.focus();
    }

    private async saveLegend(): Promise<void> {
        this.close();
        await this.plugin.saveSettings();
        this.plugin.dashboard.refresh('meal');
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/** 팔레트 슬롯마다 라이트·다크 테마 색을 고른다. 슬롯을 쓴 기록의 색도 함께 바뀐다. */
class PaletteModal extends Modal {
    constructor(private plugin: ATOZPlugin) {
        super(plugin.app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('atoz-meal-modal');
        this.setTitle(t('meal.palette.title'));
        contentEl.createEl('p', { cls: 'setting-item-description', text: t('meal.palette.desc') });
        this.plugin.settings.mealPalette.forEach((slot, i) => {
            const setting = new Setting(contentEl).setName(`c-${i + 1}`);
            for (const theme of ['light', 'dark'] as const) {
                setting.addColorPicker((picker) => picker
                    .setValue(slot[theme])
                    .onChange((value) => {
                        slot[theme] = value;
                        this.plugin.debouncedSave();
                        this.plugin.dashboard.refresh('meal');
                    }));
            }
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

type MealBoardView = 'week' | 'month';
// 이 폭보다 좁으면 처음에 주 보기로 연다. styles.css의 container query와 같은 값이다.
const NARROW_WIDTH = 560;

/** 'YYYY-MM-DD'가 든 주의 월요일 */
function weekStartOf(key: string): string {
    const [year, month, day] = key.split('-').map(Number);
    return shiftDate(key, -((new Date(year!, month! - 1, day).getDay() + 6) % 7));
}

function legendLabel(plugin: ATOZPlugin, record: MealRecord): string {
    return plugin.settings.mealLegend.find((item) => samePick(item, record))?.label || t('record.meal');
}

/** 범례 목록. 항목마다 고치기, 맨 아래 새로 더하기. */
class LegendListModal extends Modal {
    constructor(private plugin: ATOZPlugin) {
        super(plugin.app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('atoz-meal-modal');
        this.setTitle(t('meal.legend.edit'));
        for (const item of this.plugin.settings.mealLegend) {
            const setting = new Setting(contentEl).setName(item.label);
            setting.nameEl.addClass('atoz-meal-legend-name');
            setting.nameEl.prepend(createMealMarker(contentEl, this.plugin, item));
            setting.addExtraButton((button) => button
                .setIcon('pencil')
                .setTooltip(t('meal.legend.editTitle'))
                .onClick(() => {
                    this.close();
                    new LegendModal(this.plugin, item).open();
                }));
        }
        new Setting(contentEl).addButton((button) => button
            .setButtonText(t('meal.legend.addTitle'))
            .setCta()
            .onClick(() => {
                this.close();
                new LegendModal(this.plugin).open();
            }));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * 통합 대시보드의 식사보드 페이지.
 * 달 보기는 가로가 하루 시작 시각부터 24시간, 세로가 한 달의 날짜다. 주 보기는 가로가 7일, 세로가 24시간이다.
 */
export class MealBoardPage {
    private month = '';
    // 주 보기의 첫날(월요일)
    private week = '';
    // 고르지 않았으면 폭으로 정한다.
    private view: MealBoardView | null = null;
    // 눌러서 내용을 보고 있는 식사
    private selected: MealRecord | null = null;
    private isEditing = false;
    // 달 보기를 처음 열 때만 오늘 줄로 스크롤한다.
    private scrolledMonth = '';

    constructor(private plugin: ATOZPlugin, private container: HTMLElement) {
        container.addClass('atoz-meal-board');
    }

    getState(): Record<string, unknown> {
        return { month: this.month, week: this.week, view: this.view };
    }

    setState(state: Record<string, unknown>): void {
        if (typeof state.month === 'string' && /^\d{4}-\d{2}$/.test(state.month)) this.month = state.month;
        if (typeof state.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.week)) this.week = state.week;
        if (state.view === 'week' || state.view === 'month') this.view = state.view;
    }

    render(): void {
        const plugin = this.plugin;
        const startHour = plugin.settings.mealDayStartHour;
        const today = toDateKey(new Date(Date.now() - startHour * HOUR));
        if (!this.month) this.month = today.slice(0, 7);
        if (!this.week) this.week = weekStartOf(today);
        const container = this.container;
        const width = container.clientWidth;
        const view = this.view ?? (width > 0 && width < NARROW_WIDTH ? 'week' : 'month');
        container.empty();

        const update = (): void => {
            plugin.app.workspace.requestSaveLayout();
            this.render();
        };
        const menu = [
            { title: t('meal.legend.edit'), icon: 'pencil', onClick: () => new LegendListModal(plugin).open() },
            { title: t('meal.palette.title'), icon: 'palette', onClick: () => new PaletteModal(plugin).open() },
        ];
        if (view === 'week') {
            renderPageHeader(container, {
                label: formatWeekLabel(this.week, shiftDate(this.week, 6)),
                previousLabel: t('meal.previousWeek'),
                nextLabel: t('meal.nextWeek'),
                onMove: (delta) => {
                    this.week = shiftDate(this.week, delta * 7);
                    update();
                },
                isToday: this.week === weekStartOf(today),
                onToday: () => {
                    this.week = weekStartOf(today);
                    update();
                },
                menu,
            });
        } else {
            renderPageHeader(container, {
                label: formatMonthLabel(this.month),
                previousLabel: t('meal.previousMonth'),
                nextLabel: t('meal.nextMonth'),
                onMove: (delta) => {
                    this.month = shiftMonth(this.month, delta);
                    update();
                },
                isToday: this.month === today.slice(0, 7),
                onToday: () => {
                    this.month = today.slice(0, 7);
                    update();
                },
                menu,
            });
        }

        // 범례는 설명만 한다. 고치기는 ⋯ 메뉴에 있다.
        const legend = container.createDiv({ cls: 'atoz-meal-legend' });
        for (const item of plugin.settings.mealLegend) {
            const chip = legend.createDiv({ cls: 'atoz-meal-chip' });
            createMealMarker(chip, plugin, item);
            chip.createSpan({ text: item.label });
        }
        const views = legend.createDiv({ cls: 'atoz-meal-views', attr: { role: 'group', 'aria-label': t('meal.view') } });
        for (const option of ['week', 'month'] as const) {
            const button = views.createEl('button', { text: t(option === 'week' ? 'meal.week' : 'meal.month') });
            button.toggleClass('is-active', option === view);
            button.setAttr('aria-pressed', String(option === view));
            button.addEventListener('click', () => {
                if (option === view) return;
                this.view = option;
                // 보던 때를 이어받는다. 주는 목요일이 든 달로, 달은 오늘이나 1일이 든 주로.
                if (option === 'month') this.month = shiftDate(this.week, 3).slice(0, 7);
                else this.week = weekStartOf(this.month === today.slice(0, 7) ? today : `${this.month}-01`);
                update();
            });
        }

        // 하루 시작 시각 전의 기록은 전날에 그린다.
        const byDay = new Map<string, MealRecord[]>();
        for (const record of plugin.meal.records) {
            const key = toDateKey(new Date(record.time - startHour * HOUR));
            byDay.set(key, [...(byDay.get(key) ?? []), record]);
        }
        // 다시 읽으면 기록 객체가 새로 생기므로 시각과 표시로 다시 찾는다.
        const selected = this.selected;
        this.selected = selected
            ? plugin.meal.records.find((record) => record.time === selected.time && samePick(record, selected)) ?? null
            : null;

        if (view === 'week') this.renderWeek(container, byDay, today);
        else this.renderMonth(container, byDay, today);
        if (this.selected) this.renderDetail(container, this.selected);
    }

    private renderMonth(container: HTMLElement, byDay: Map<string, MealRecord[]>, today: string): void {
        const startHour = this.plugin.settings.mealDayStartHour;
        const grid = container.createDiv({ cls: 'atoz-meal-grid' });
        const hours = grid.createDiv({ cls: 'atoz-meal-row is-header' });
        hours.createDiv({ cls: 'atoz-meal-day' });
        const hourTrack = hours.createDiv({ cls: 'atoz-meal-track' });
        for (let i = 0; i < 24; i++) hourTrack.createDiv({ cls: 'atoz-meal-cell', text: String((startHour + i) % 24) });

        const [year, mon] = this.month.split('-').map(Number);
        const dayCount = new Date(year!, mon!, 0).getDate();
        for (let day = 1; day <= dayCount; day++) {
            const key = `${this.month}-${pad(day)}`;
            const row = grid.createDiv({ cls: 'atoz-meal-row' });
            if (key === today) {
                row.addClass('is-today');
                if (this.scrolledMonth !== this.month) {
                    this.scrolledMonth = this.month;
                    window.setTimeout(() => row.scrollIntoView({ block: 'center' }), 0);
                }
            }
            row.createDiv({ cls: 'atoz-meal-day', text: String(day) });
            const track = row.createDiv({ cls: 'atoz-meal-track' });
            for (let i = 0; i < 24; i++) track.createDiv({ cls: 'atoz-meal-cell' });
            this.placeMarkers(track, byDay.get(key) ?? [], (marker, at, shift) => {
                marker.style.left = `calc(${at * 100}% + ${shift} * var(--atoz-meal-shift))`;
            });
        }
    }

    private renderWeek(container: HTMLElement, byDay: Map<string, MealRecord[]>, today: string): void {
        const startHour = this.plugin.settings.mealDayStartHour;
        const grid = container.createDiv({ cls: 'atoz-meal-week' });
        const days = Array.from({ length: 7 }, (_, i) => shiftDate(this.week, i));
        grid.createDiv();
        for (const key of days) {
            const [year, month, day] = key.split('-').map(Number);
            const head = grid.createDiv({ cls: 'atoz-meal-week-head' });
            if (key === today) head.addClass('is-today');
            head.createDiv({ text: new Date(year!, month! - 1, day).toLocaleDateString(isKorean ? 'ko-KR' : 'en-US', { weekday: 'short' }) });
            head.createDiv({ cls: 'atoz-meal-week-date', text: String(day) });
        }
        const hours = grid.createDiv({ cls: 'atoz-meal-week-hours' });
        for (let i = 0; i < 24; i++) hours.createDiv({ text: String((startHour + i) % 24) });
        for (const key of days) {
            const column = grid.createDiv({ cls: 'atoz-meal-week-day' });
            if (key === today) column.addClass('is-today');
            for (let i = 0; i < 24; i++) column.createDiv({ cls: 'atoz-meal-cell' });
            this.placeMarkers(column, byDay.get(key) ?? [], (marker, at, shift) => {
                marker.style.top = `${at * 100}%`;
                marker.style.left = `calc(50% + ${shift} * var(--atoz-meal-shift))`;
            });
        }
    }

    /** 한 날의 식사 표시를 그린다. place는 하루 중 위치(0~1)와 밀어낼 칸 수를 받아 자리를 잡는다. */
    private placeMarkers(
        track: HTMLElement,
        records: MealRecord[],
        place: (marker: HTMLElement, at: number, shift: number) => void,
    ): void {
        const plugin = this.plugin;
        const startHour = plugin.settings.mealDayStartHour;
        let previous: { offset: number; shift: number } | null = null;
        for (const record of records) {
            const date = new Date(record.time);
            const offset = (date.getHours() - startHour + 24) % 24 + date.getMinutes() / 60;
            const shift: number = previous && offset - previous.offset < OVERLAP_HOURS ? previous.shift + 1 : 0;
            previous = { offset, shift };
            // 메뉴가 비어도 범례 아이콘 그대로 두고 점선으로 표시한다.
            const marker = createMealMarker(track, plugin, record);
            marker.addClass('is-placed');
            marker.toggleClass('is-empty', !record.food);
            marker.toggleClass('is-selected', record === this.selected);
            // 표시가 제 시간 칸을 벗어나지 않도록 분은 칸 안의 20~80% 위치로만 반영한다.
            place(marker, (Math.floor(offset) + 0.2 + 0.6 * (offset % 1)) / 24, shift);
            setTooltip(marker, `${formatClock(record.time)} ${record.food || `${legendLabel(plugin, record)} · ${t('meal.unknownFood')}`}`);
            // 터치 화면에는 툴팁이 없으므로 누르면 아래에 내용을 보인다.
            makeClickable(marker, () => {
                this.selected = record;
                this.isEditing = false;
                this.render();
            });
        }
    }

    /** 누른 식사의 내용: 시각, 범례, 메뉴, 함께 남긴 지출. 메뉴는 그 자리에서 고친다. */
    private renderDetail(container: HTMLElement, record: MealRecord): void {
        const plugin = this.plugin;
        const sheet = container.createDiv({ cls: 'atoz-meal-detail' });
        createMealMarker(sheet, plugin, record).toggleClass('is-empty', !record.food);
        const body = sheet.createDiv({ cls: 'atoz-meal-detail-text' });
        const label = legendLabel(plugin, record);
        if (this.isEditing) {
            body.createSpan({ text: `${formatClock(record.time)} ${label}` });
            const input = body.createEl('input', { type: 'text', value: record.food, attr: { placeholder: t('meal.modal.foodPlaceholder') } });
            let isDone = false;
            const finish = async (save: boolean): Promise<void> => {
                if (isDone) return;
                isDone = true;
                this.isEditing = false;
                const food = input.value.trim();
                if (save && food !== record.food) await plugin.meal.replace(record, record.time, food);
                else this.render();
            };
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') void finish(true);
                else if (event.key === 'Escape') void finish(false);
            });
            input.addEventListener('blur', () => void finish(true));
            window.setTimeout(() => input.focus(), 0);
        } else {
            body.createSpan({ text: `${formatClock(record.time)} ${label} · ${record.food || t('meal.unknownFood')}` });
            const amount = body.createSpan({ cls: 'atoz-meal-detail-amount' });
            // 식사 알약에서 금액과 함께 남긴 지출은 범례 이름과 같은 카테고리로 1분 안에 적힌다.
            const date = new Date(record.time);
            void plugin.budget.timedExpenses(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`).then((entries) => {
                const pair = entries.find((entry) => entry.category === label && Math.abs(entryTime(entry) - record.time) <= MEAL_SPENDING_GAP);
                if (pair) amount.setText(` · ${formatWon(pair.amount)}`);
            });
            const edit = sheet.createEl('button', { text: t('meal.detail.edit') });
            edit.addEventListener('click', () => {
                this.isEditing = true;
                this.render();
            });
        }
        const close = sheet.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('meal.detail.close') } });
        setIcon(close, 'x');
        close.addEventListener('click', () => {
            this.selected = null;
            this.isEditing = false;
            this.render();
        });
    }
}

export class MealFeature {
    records: MealRecord[] = [];
    // 파일 경로별로 읽어 둔 기록. 바뀐 파일만 다시 읽어 바꿔 끼운다.
    private fileRecords = new Map<string, MealRecord[]>();
    private reloadTimer: number | null = null;
    private pendingPaths = new Set<string>();
    private isFullReloadPending = false;
    // 읽기를 한 줄로 세워, 늦게 끝난 이전 읽기가 새 결과를 덮어쓰지 않게 한다.
    private loadQueue: Promise<void> = Promise.resolve();

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.addCommand({
            id: 'open-meal-board',
            name: t('command.openMealBoard'),
            callback: () => void this.plugin.dashboard.open('meal'),
        });
        this.plugin.addCommand({
            id: 'record-meal',
            name: t('command.recordMeal'),
            callback: () => this.openModal(),
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

    // 폴더가 바뀌면 새 폴더를 읽고, 하루 시작 시각이 바뀌어도 다시 그린다.
    settingsChanged(): void {
        this.scheduleReload();
    }

    openModal(): void {
        new MealModal(this.plugin).open();
    }

    colorOf(name: string): { light: string; dark: string } | null {
        const match = SLOT_PATTERN.exec(name);
        return match ? this.plugin.settings.mealPalette[Number(match[1]) - 1] ?? null : null;
    }


    /** 마지막으로 쓴 표시를 기억하고, 직접 고른 표시가 범례에 없으면 범례에 더한다. */
    async remember(pick: MealPick, customName: string | null): Promise<void> {
        const settings = this.plugin.settings;
        settings.mealLastPick = { ...pick };
        if (customName !== null && !settings.mealLegend.some((item) => samePick(item, pick))) {
            settings.mealLegend.push({ ...pick, label: customName });
            this.plugin.dashboard.refresh('meal');
        }
        await this.plugin.saveSettings();
    }

    /** 기록을 더하고, 다시 읽은 그 기록을 돌려준다. */
    async add(time: number, food: string, pick: MealPick): Promise<MealRecord | undefined> {
        const date = new Date(time);
        const folder = this.getFolder();
        const path = normalizePath(`${folder}/meal-${date.getFullYear()}-${pad(date.getMonth() + 1)}.md`);
        const row = formatRow(time, food, pick);
        const vault = this.plugin.app.vault;
        if (!vault.getFolderByPath(folder)) await vault.createFolder(folder);
        const file = vault.getFileByPath(path);
        if (file) {
            await vault.process(file, (data) => (data === '' || data.endsWith('\n') ? data : data + '\n') + row + '\n');
        } else {
            await vault.create(path, TABLE_HEADER + row + '\n');
        }
        await this.enqueue(() => this.loadFiles([path]));
        return this.records.filter((record) => record.file.path === path && record.line === row).pop();
    }

    /** 기록의 시각·음식을 고친다. 날짜와 표시는 그대로다. time이 null이면 지운다. */
    async replace(record: MealRecord, time: number | null, food: string): Promise<void> {
        await this.plugin.app.vault.process(record.file, (data) => {
            const lines = data.split('\n');
            const index = lines.map((line) => line.trim()).lastIndexOf(record.line);
            if (index === -1) return data;
            if (time === null) lines.splice(index, 1);
            else lines[index] = formatRow(time, food, record);
            return lines.join('\n');
        });
        await this.enqueue(() => this.loadFiles([record.file.path]));
    }

    private enqueue(job: () => Promise<void>): Promise<void> {
        const run = this.loadQueue.then(job);
        this.loadQueue = run.catch(() => undefined);
        return run;
    }

    // 볼트 전체가 아니라 기록 폴더 안의 파일만 읽는다.
    private async loadAll(): Promise<void> {
        const fileRecords = new Map<string, MealRecord[]>();
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
            if (file && this.isRecordFile(file)) this.fileRecords.set(path, await this.readFile(file));
            else this.fileRecords.delete(path);
        }
        this.publish();
    }

    private async readFile(file: TFile): Promise<MealRecord[]> {
        const records: MealRecord[] = [];
        const content = await this.plugin.app.vault.cachedRead(file);
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            const match = ROW_PATTERN.exec(line);
            if (!match) continue;
            const [, year, month, day, hour, minute, food, icon, color] = match;
            records.push({
                time: new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime(),
                food: food!.trim(),
                icon: icon!.trim(),
                color: color!.trim(),
                file,
                line,
            });
        }
        return records;
    }

    private publish(): void {
        this.records = [...this.fileRecords.values()].flat().sort((a, b) => a.time - b.time);
        this.plugin.dashboard.refresh('meal');
        this.plugin.daynight.renderViews();
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
        return normalizePath(this.plugin.settings.mealFolder.trim() || DEFAULT_FOLDER);
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
