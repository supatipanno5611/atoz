import { Modal, Setting, TAbstractFile, TFile, getIcon, getIconIds, normalizePath, setIcon, setTooltip } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import type { MealLegendItem, MealPick } from '../types';
import { pad } from './Daynight';

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

interface MealRecord {
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

/** 통합 대시보드의 식사보드 페이지. 가로는 하루 시작 시각부터 24시간, 세로는 한 달의 날짜다. */
export class MealBoardPage {
    private month = '';

    constructor(private plugin: ATOZPlugin, private container: HTMLElement) {
        container.addClass('atoz-meal-board');
    }

    getState(): Record<string, unknown> {
        return { month: this.month };
    }

    setState(state: Record<string, unknown>): void {
        if (typeof state.month === 'string' && /^\d{4}-\d{2}$/.test(state.month)) this.month = state.month;
    }

    render(): void {
        const plugin = this.plugin;
        const startHour = plugin.settings.mealDayStartHour;
        const today = toDateKey(new Date(Date.now() - startHour * HOUR));
        if (!this.month) this.month = today.slice(0, 7);
        const container = this.container;
        container.empty();

        const header = container.createDiv({ cls: 'atoz-meal-header' });
        const nav = header.createDiv({ cls: 'atoz-meal-nav' });
        const addButton = (parent: HTMLElement, icon: string, label: string, onClick: () => void): void => {
            const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
            setIcon(button, icon);
            button.addEventListener('click', onClick);
        };
        const moveTo = (month: string): void => {
            this.month = month;
            plugin.app.workspace.requestSaveLayout();
            this.render();
        };
        addButton(nav, 'chevron-left', t('meal.previousMonth'), () => moveTo(shiftMonth(this.month, -1)));
        nav.createSpan({ cls: 'atoz-meal-month', text: this.month });
        addButton(nav, 'chevron-right', t('meal.nextMonth'), () => moveTo(shiftMonth(this.month, 1)));
        addButton(nav, 'rotate-ccw', t('meal.thisMonth'), () => moveTo(today.slice(0, 7)));
        const actions = header.createDiv({ cls: 'atoz-meal-nav' });
        addButton(actions, 'palette', t('meal.palette.title'), () => new PaletteModal(plugin).open());

        const legend = container.createDiv({ cls: 'atoz-meal-legend' });
        for (const item of plugin.settings.mealLegend) {
            const chip = legend.createDiv({ cls: 'atoz-meal-chip' });
            createMealMarker(chip, plugin, item);
            chip.createSpan({ text: item.label });
            chip.addEventListener('click', () => new LegendModal(plugin, item).open());
        }
        const addChip = legend.createDiv({ cls: 'atoz-meal-chip' });
        setIcon(addChip, 'plus');
        setTooltip(addChip, t('meal.legend.addTitle'));
        addChip.addEventListener('click', () => new LegendModal(plugin).open());

        // 하루 시작 시각 전의 기록은 전날 줄에 그린다.
        const byDay = new Map<string, MealRecord[]>();
        for (const record of plugin.meal.records) {
            const key = toDateKey(new Date(record.time - startHour * HOUR));
            if (!key.startsWith(this.month)) continue;
            byDay.set(key, [...(byDay.get(key) ?? []), record]);
        }

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
            if (key === today) row.addClass('is-today');
            row.createDiv({ cls: 'atoz-meal-day', text: String(day) });
            const track = row.createDiv({ cls: 'atoz-meal-track' });
            for (let i = 0; i < 24; i++) track.createDiv({ cls: 'atoz-meal-cell' });

            let previous: { offset: number; shift: number } | null = null;
            for (const record of byDay.get(key) ?? []) {
                const date = new Date(record.time);
                const offset = (date.getHours() - startHour + 24) % 24 + date.getMinutes() / 60;
                const shift: number = previous && offset - previous.offset < OVERLAP_HOURS ? previous.shift + 1 : 0;
                previous = { offset, shift };
                const marker = createMealMarker(track, plugin, record.food ? record : { icon: 'circle-help', color: record.color });
                marker.addClass('is-placed');
                // 표시가 제 시간 칸을 벗어나지 않도록 분은 칸 안의 20~80% 위치로만 반영한다.
                const position = Math.floor(offset) + 0.2 + 0.6 * (offset % 1);
                marker.style.left = `calc(${position / 24 * 100}% + ${shift} * var(--atoz-meal-shift))`;
                setTooltip(marker, `${formatClock(record.time)} ${record.food || t('meal.unknownFood')}`);
            }
        }
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

    /** 지금까지 가장 최근에 먹은 식사. */
    latest(): MealRecord | null {
        const now = Date.now();
        return this.records.filter((record) => record.time <= now).pop() ?? null;
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

    async add(time: number, food: string, pick: MealPick): Promise<void> {
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
