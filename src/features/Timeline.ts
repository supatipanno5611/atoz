import { Menu, TAbstractFile, TFile, normalizePath, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { isKorean, t } from '../locales';
import type { MealColor } from '../types';
import { formatDuration, pad } from './Daynight';

const DEFAULT_FOLDER = 'timeline';
const FILE_NAME_PATTERN = /^((log|plan)-\d{4}-\d{2}|blocks|later)\.md$/;
const BLOCKS_FILE = 'blocks.md';
// 색을 정하지 않은 블록에 blocks.md 순서대로 돌려 쓰는 색. 테마 색 변수라 라이트·다크가 같다.
const AUTO_COLORS: MealColor[] = ['blue', 'orange', 'green', 'purple', 'red', 'cyan', 'yellow', 'pink']
    .map((name) => ({ light: `var(--color-${name})`, dark: `var(--color-${name})` }));
const LATER_FILE = 'later.md';
const LOG_HEADER = '| Date | Time | Category | Memo |\n| --- | --- | --- | --- |\n';
const PLAN_HEADER = '| Date | Start | End | Category | Memo |\n| --- | --- | --- | --- | --- |\n';
const BLOCKS_HEADER = '| Name | Minutes | Repeat |\n| --- | --- | --- |\n';
const LATER_HEADER = '| Date | Name | Minutes | Memo |\n| --- | --- | --- | --- |\n';
// blocks.md가 없을 때 쓰는 활동. 파일을 처음 만들 때도 이것으로 채운다.
const DEFAULT_BLOCKS = isKorean
    ? ['일', '공부', '운동', '휴식', '이동']
    : ['Work', 'Study', 'Exercise', 'Rest', 'Commute'];
/** 카테고리 자리에 이것을 쓴 기록은 하던 활동의 끝이다. 다음 기록까지 '기록 없음'이 된다. */
export const END_CATEGORY = '-';
// 카테고리 칸에는 |가 없고, 메모는 마지막 칸이므로 욕심껏 잡는다.
const LOG_ROW_PATTERN = /^\|\s*(\d{4})-(\d{2})-(\d{2})\s*\|\s*(\d{2}):(\d{2})\s*\|([^|]*)\|(.*)\|$/;
const PLAN_ROW_PATTERN = /^\|\s*(\d{4})-(\d{2})-(\d{2})\s*\|\s*(\d{2}):(\d{2})\s*\|\s*(\d{2}):(\d{2})\s*\|([^|]*)\|(.*)\|$/;
const HOUR = 60 * 60 * 1000;
const RELOAD_DELAY = 100;
const REDRAW_INTERVAL = 60 * 1000;
// 레인 좌표계. 1시간을 30px로 그린다.
const HOUR_HEIGHT = 30;
// 이 높이보다 낮은 블록은 라벨을 빼고 색만 그린다.
const LABEL_MIN_HEIGHT = 13;

export interface LogRecord {
    time: number;
    category: string;
    memo: string;
    file: TFile;
    line: string;
}

export interface TimelineBlock {
    from: number;
    to: number;
    category: string;
    memo: string;
}

// 하루 경계에서 자른 블록. 라벨과 메뉴에는 자르기 전의 시각을 쓴다.
interface ClippedBlock extends TimelineBlock {
    original: TimelineBlock;
}

/** blocks.md의 한 줄. 분과 반복 요일은 비어 있을 수 있다. */
export interface BlockItem {
    name: string;
    minutes: number | null;
    repeat: string[];
}

/** later.md의 한 줄. 날짜가 비면 미룬 일, 있으면 그날로 예약한 일이다. */
export interface LaterItem {
    date: string;
    name: string;
    minutes: number | null;
    memo: string;
    line: string;
}

interface FileRecords {
    logs: LogRecord[];
    plans: TimelineBlock[];
    blocks: BlockItem[];
    later: LaterItem[];
}

interface CategoryStat {
    category: string;
    plan: number;
    log: number;
}

interface DaySummary {
    blocks: { plans: ClippedBlock[]; logs: ClippedBlock[] };
    // 지금까지 지난 계획 시간과 그중 같은 카테고리로 기록된 시간
    elapsedPlan: number;
    matched: number;
    totalPlan: number;
    categories: CategoryStat[];
}

export function toDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatClock(time: number): string {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 표가 깨지지 않도록 칸에 든 |와 줄바꿈은 바꿔 적는다.
function toCell(text: string): string {
    return text.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

/** 표 줄을 칸으로 나눈다. 표 줄이 아니면 null이다. */
function tableCells(line: string): string[] | null {
    if (!line.startsWith('|') || !line.endsWith('|') || line.length < 2) return null;
    return line.slice(1, -1).split('|').map((cell) => cell.trim());
}

function parseMinutes(text: string): number | null {
    const minutes = Number(text);
    return text && Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

function formatLogRow(time: number, category: string, memo: string): string {
    return `| ${toDateKey(new Date(time))} | ${formatClock(time)} | ${category} | ${toCell(memo)} |`;
}

function appendLine(data: string, row: string): string {
    return (data === '' || data.endsWith('\n') ? data : data + '\n') + row + '\n';
}

function parsePlanRow(line: string): TimelineBlock | null {
    const match = PLAN_ROW_PATTERN.exec(line);
    if (!match) return null;
    const [, year, month, day, startHour, startMinute, endHour, endMinute, category, memo] = match;
    if (!category!.trim()) return null;
    const from = new Date(Number(year), Number(month) - 1, Number(day), Number(startHour), Number(startMinute)).getTime();
    let to = new Date(Number(year), Number(month) - 1, Number(day), Number(endHour), Number(endMinute)).getTime();
    // 끝이 시작보다 이르면 자정을 넘긴 계획이다.
    if (to <= from) to = new Date(to).setDate(new Date(to).getDate() + 1);
    return { from, to, category: category!.trim(), memo: memo!.trim() };
}

export function shiftDate(key: string, delta: number): string {
    const [year, month, day] = key.split('-').map(Number);
    return toDateKey(new Date(year!, month! - 1, day! + delta));
}

function overlap(from: number, to: number, start: number, end: number): number {
    return Math.max(0, Math.min(to, end) - Math.max(from, start));
}

function clip(blocks: TimelineBlock[], start: number, end: number): ClippedBlock[] {
    return blocks
        .filter(({ from, to }) => to > start && from < end)
        .map((block) => ({ ...block, from: Math.max(block.from, start), to: Math.min(block.to, end), original: block }));
}

/** 하루 시작 시각부터 다음 날 같은 시각까지가 그 날짜의 하루다. */
export function dayRange(key: string, startHour: number): [number, number] {
    const [year, month, day] = key.split('-').map(Number);
    return [
        new Date(year!, month! - 1, day, startHour).getTime(),
        new Date(year!, month! - 1, day! + 1, startHour).getTime(),
    ];
}

export function timelineToday(plugin: ATOZPlugin): string {
    return toDateKey(new Date(Date.now() - plugin.settings.timelineDayStartHour * HOUR));
}

/** 그 날짜의 블록과 일치율, 카테고리별 시간을 구한다. 기록은 지금까지만 센다. */
export function summarizeDay(plugin: ATOZPlugin, key: string, now: number): DaySummary {
    const [start, end] = dayRange(key, plugin.settings.timelineDayStartHour);
    const plans = clip(plugin.timeline.plans, start, end);
    const logs = clip(plugin.timeline.segments(now), start, end);
    const elapsedEnd = Math.min(end, now);

    let elapsedPlan = 0;
    let matched = 0;
    for (const plan of plans) {
        elapsedPlan += overlap(plan.from, plan.to, start, elapsedEnd);
        for (const log of logs) {
            if (log.category !== plan.category) continue;
            matched += overlap(Math.max(plan.from, log.from), Math.min(plan.to, log.to), start, elapsedEnd);
        }
    }

    const stats = new Map<string, CategoryStat>();
    const statOf = (category: string): CategoryStat => {
        const stat = stats.get(category) ?? { category, plan: 0, log: 0 };
        stats.set(category, stat);
        return stat;
    };
    for (const plan of plans) statOf(plan.category).plan += plan.to - plan.from;
    for (const log of logs) statOf(log.category).log += log.to - log.from;
    // 계획 시간이 많은 순서로 두고, 계획 없는 카테고리는 기록 시간 순서로 뒤에 둔다.
    const categories = [...stats.values()].sort((a, b) => b.plan - a.plan || b.log - a.log);

    return {
        blocks: { plans, logs },
        elapsedPlan,
        matched,
        totalPlan: plans.reduce((sum, plan) => sum + plan.to - plan.from, 0),
        categories,
    };
}

export function formatMatch(summary: DaySummary): string {
    return summary.elapsedPlan > 0 ? `${Math.round(summary.matched / summary.elapsedPlan * 100)}%` : '—';
}

/** 카테고리 색을 블록에 붙인다. 블록에도 없는 카테고리는 회색으로 그린다. */
export function applyColor(el: HTMLElement, plugin: ATOZPlugin, category: string): void {
    const color = plugin.timeline.colorOf(category);
    if (color) {
        el.style.setProperty('--atoz-timeline-light', color.light);
        el.style.setProperty('--atoz-timeline-dark', color.dark);
    }
}

export class TimelinePage {
    private date = '';

    constructor(private plugin: ATOZPlugin, private container: HTMLElement) {
        container.addClass('atoz-timeline');
    }

    getState(): Record<string, unknown> {
        return { date: this.date };
    }

    setState(state: Record<string, unknown>): void {
        if (typeof state.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.date)) this.date = state.date;
    }

    /** scroll이면 오늘은 지금 시각이, 다른 날은 하루 시작이 보이게 옮긴다. 아니면 보던 위치를 지킨다. */
    render(scroll = false): void {
        const plugin = this.plugin;
        const now = Date.now();
        const today = timelineToday(plugin);
        if (!this.date) this.date = today;
        const container = this.container;
        const scroller = container.parentElement;
        const scrollTop = scroller?.scrollTop ?? 0;
        container.empty();

        const header = container.createDiv({ cls: 'atoz-timeline-header' });
        const addButton = (icon: string, label: string, onClick: () => void): void => {
            const button = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
            setIcon(button, icon);
            button.addEventListener('click', onClick);
        };
        const moveTo = (date: string): void => {
            this.date = date;
            plugin.app.workspace.requestSaveLayout();
            this.render(true);
        };
        addButton('chevron-left', t('timeline.previousDay'), () => moveTo(shiftDate(this.date, -1)));
        const [year, month, day] = this.date.split('-').map(Number);
        const weekday = new Date(year!, month! - 1, day).toLocaleDateString(isKorean ? 'ko' : 'en', { weekday: 'short' });
        header.createSpan({ cls: 'atoz-timeline-date', text: `${this.date} (${weekday})` });
        addButton('chevron-right', t('timeline.nextDay'), () => moveTo(shiftDate(this.date, 1)));
        addButton('rotate-ccw', t('timeline.today'), () => moveTo(today));

        const summary = summarizeDay(plugin, this.date, now);
        const { plans, logs } = summary.blocks;
        if (plans.length === 0 && logs.length === 0) {
            container.createDiv({ cls: 'atoz-timeline-empty', text: t('timeline.empty') });
            return;
        }

        const line = container.createDiv({ cls: 'atoz-timeline-summary' });
        if (summary.elapsedPlan > 0) {
            line.setText(t('timeline.summary', { match: formatMatch(summary), plan: formatDuration(summary.elapsedPlan) }));
        } else if (summary.totalPlan > 0) {
            line.setText(t('timeline.planOnly', { plan: formatDuration(summary.totalPlan) }));
        } else {
            line.setText(t('timeline.noPlan'));
        }

        const [start, end] = dayRange(this.date, plugin.settings.timelineDayStartHour);
        const y = (time: number): number => (time - start) / HOUR * HOUR_HEIGHT;

        const labels = container.createDiv({ cls: 'atoz-timeline-lane-labels' });
        labels.createSpan({ text: t('timeline.plan') });
        labels.createSpan({ text: t('timeline.log') });

        const chart = container.createDiv({ cls: 'atoz-timeline-chart' });
        chart.style.height = `${y(end)}px`;
        // 서머타임이 있는 날도 실제 시각의 정시마다 줄을 긋는다.
        for (let hour = 0; hour <= 24; hour++) {
            const time = new Date(start).setHours(new Date(start).getHours() + hour);
            if (time > end) break;
            const tick = chart.createDiv({ cls: 'atoz-timeline-hour' });
            tick.style.top = `${y(time)}px`;
            if (time < end) tick.createSpan({ text: pad(new Date(time).getHours()) });
        }

        const planLane = chart.createDiv({ cls: 'atoz-timeline-lane is-plan' });
        const logLane = chart.createDiv({ cls: 'atoz-timeline-lane is-log' });
        const draw = (lane: HTMLElement, block: ClippedBlock): void => {
            const { original } = block;
            const el = lane.createDiv({ cls: 'atoz-timeline-block' });
            applyColor(el, plugin, block.category);
            const height = y(block.to) - y(block.from);
            el.style.top = `${y(block.from)}px`;
            el.style.height = `${Math.max(2, height - 1)}px`;
            if (height >= LABEL_MIN_HEIGHT) el.setText(`${block.category} ${formatClock(original.from)}`);
            el.addEventListener('click', (event) => {
                const menu = new Menu();
                const items = [
                    block.category,
                    `${formatClock(original.from)}–${formatClock(original.to)} · ${formatDuration(original.to - original.from)}`,
                ];
                if (original.memo) items.push(original.memo);
                for (const text of items) menu.addItem((item) => item.setTitle(text).setDisabled(true));
                menu.showAtMouseEvent(event);
            });
        };
        for (const block of plans) draw(planLane, block);
        for (const block of logs) draw(logLane, block);

        const isToday = this.date === today;
        if (isToday) {
            const nowLine = chart.createDiv({ cls: 'atoz-timeline-now' });
            nowLine.style.top = `${y(now)}px`;
            nowLine.createSpan({ text: formatClock(now) });
        }

        container.createDiv({ cls: 'atoz-timeline-section', text: t('timeline.byCategory') });
        const max = Math.max(...summary.categories.map(({ plan, log }) => Math.max(plan, log)));
        for (const stat of summary.categories) {
            const row = container.createDiv({ cls: 'atoz-timeline-stat' });
            const head = row.createDiv({ cls: 'atoz-timeline-stat-head' });
            const name = head.createSpan({ cls: 'atoz-timeline-stat-name' });
            applyColor(name.createSpan({ cls: 'atoz-timeline-dot' }), plugin, stat.category);
            name.createSpan({ text: stat.category });
            head.createSpan({
                cls: 'atoz-timeline-muted',
                text: `${formatDuration(stat.log)} / ${stat.plan > 0 ? formatDuration(stat.plan) : t('timeline.unplanned')}`,
            });
            const bar = row.createDiv({ cls: 'atoz-timeline-bar' });
            applyColor(bar, plugin, stat.category);
            if (stat.plan > 0) bar.createDiv({ cls: 'atoz-timeline-bar-plan' }).style.width = `${stat.plan / max * 100}%`;
            if (stat.log > 0) bar.createDiv({ cls: 'atoz-timeline-bar-log' }).style.width = `${stat.log / max * 100}%`;
        }

        if (!scroller) return;
        if (!scroll) scroller.scrollTop = scrollTop;
        else if (isToday) scroller.scrollTop = chart.offsetTop + y(now) - scroller.clientHeight / 3;
        else scroller.scrollTop = 0;
    }
}

export class TimelineFeature {
    logs: LogRecord[] = [];
    plans: TimelineBlock[] = [];
    /** blocks.md의 블록. 이름은 기록 패널의 활동 버튼이 된다. */
    blockItems: BlockItem[] = [];
    blocks: string[] = [];
    later: LaterItem[] = [];
    // 파일 경로별로 읽어 둔 기록. 바뀐 파일만 다시 읽어 바꿔 끼운다.
    private fileRecords = new Map<string, FileRecords>();
    private reloadTimer: number | null = null;
    private pendingPaths = new Set<string>();
    private isFullReloadPending = false;
    // 읽기를 한 줄로 세워, 늦게 끝난 이전 읽기가 새 결과를 덮어쓰지 않게 한다.
    private loadQueue: Promise<void> = Promise.resolve();

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.addCommand({
            id: 'open-timeline',
            name: t('command.openTimeline'),
            callback: () => void this.plugin.dashboard.open('timeline'),
        });
        this.plugin.addCommand({
            id: 'open-plan',
            name: t('command.openPlan'),
            callback: () => void this.plugin.dashboard.open('plan'),
        });
        // 진행 중인 기록과 지금 선이 시간에 맞게 늘어나도록 1분마다 다시 그린다.
        this.plugin.registerInterval(window.setInterval(() => this.plugin.dashboard.refresh('timeline'), REDRAW_INTERVAL));

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

    /**
     * 각 기록에서 다음 기록까지를 그 카테고리의 구간으로 만든다. 마지막 구간은 지금까지 진행 중이다.
     * 끝 표시부터 다음 기록까지는 기록 없음이라 구간을 만들지 않는다.
     */
    segments(now: number): TimelineBlock[] {
        const past = this.logs.filter((log) => log.time <= now);
        return past
            .map((log, index) => ({
                from: log.time,
                to: past[index + 1]?.time ?? now,
                category: log.category,
                memo: log.memo,
            }))
            .filter((segment) => segment.category !== END_CATEGORY);
    }

    /** 정한 색이 없으면 blocks.md 순서로 자동 색을 준다. 저장하지 않고 읽을 때 계산한다. 블록이 아니면 없다. */
    colorOf(category: string): MealColor | undefined {
        const index = this.blocks.indexOf(category);
        return this.plugin.settings.timelineColors[category] ?? (index === -1 ? undefined : AUTO_COLORS[index % AUTO_COLORS.length]);
    }

    /** 지금 진행 중인 기록. 마지막 기록이 끝 표시면 없다. */
    current(): LogRecord | null {
        const now = Date.now();
        const last = this.logs.filter((log) => log.time <= now).pop() ?? null;
        return last?.category === END_CATEGORY ? null : last;
    }

    /** 그 달 기록 파일 끝에 한 줄을 더하고, 다시 읽은 그 기록을 돌려준다. 파일이 없으면 만든다. */
    async addLog(time: number, category: string, memo = ''): Promise<LogRecord | undefined> {
        const date = new Date(time);
        const path = this.pathOf(`log-${date.getFullYear()}-${pad(date.getMonth() + 1)}.md`);
        const row = formatLogRow(time, category, memo);
        await this.appendRow(path, LOG_HEADER, row);
        await this.enqueue(() => this.loadFiles([path]));
        return this.logs.filter((log) => log.file.path === path && log.line === row).pop();
    }

    /** 기록의 시각·메모를 고친다. 날짜와 카테고리는 그대로다. time이 null이면 지운다. */
    async replaceLog(log: LogRecord, time: number | null, memo: string): Promise<void> {
        await this.plugin.app.vault.process(log.file, (data) => {
            const lines = data.split('\n');
            const index = lines.map((line) => line.trim()).lastIndexOf(log.line);
            if (index === -1) return data;
            if (time === null) lines.splice(index, 1);
            else lines[index] = formatLogRow(time, log.category, memo);
            return lines.join('\n');
        });
        await this.enqueue(() => this.loadFiles([log.file.path]));
    }

    /** 블록 파일을 메인 영역의 새 탭으로 연다. */
    async openBlocks(): Promise<void> {
        await this.plugin.app.workspace.getLeaf('tab').openFile(await this.blocksFile());
    }

    /** blocks.md 끝에 블록을 더한다. */
    async addBlock(name: string, minutes: number | null, repeat: string): Promise<void> {
        const file = await this.blocksFile();
        const row = `| ${toCell(name)} | ${minutes ?? ''} | ${toCell(repeat)} |`;
        await this.plugin.app.vault.process(file, (data) => appendLine(data, row));
        await this.enqueue(() => this.loadFiles([file.path]));
    }

    /** later.md 끝에 할 일을 더한다. 파일이 없으면 만든다. */
    async addLater(item: Omit<LaterItem, 'line'>): Promise<void> {
        const path = this.pathOf(LATER_FILE);
        const row = `| ${item.date} | ${toCell(item.name)} | ${item.minutes ?? ''} | ${toCell(item.memo)} |`;
        await this.appendRow(path, LATER_HEADER, row);
        await this.enqueue(() => this.loadFiles([path]));
    }

    /** 계획에 넣은 할 일을 later.md에서 지운다. */
    async removeLater(items: LaterItem[]): Promise<void> {
        const file = this.plugin.app.vault.getFileByPath(this.pathOf(LATER_FILE));
        if (!file || items.length === 0) return;
        await this.plugin.app.vault.process(file, (data) => {
            const lines = data.split('\n');
            for (const item of items) {
                const index = lines.findIndex((line) => line.trim() === item.line);
                if (index !== -1) lines.splice(index, 1);
            }
            return lines.join('\n');
        });
        await this.enqueue(() => this.loadFiles([file.path]));
    }

    /** 그 날짜(하루 시작 시각부터 다음 날 같은 시각까지)의 계획 줄을 통째로 바꾼다. */
    async savePlan(key: string, plans: TimelineBlock[]): Promise<void> {
        const [start, end] = dayRange(key, this.plugin.settings.timelineDayStartHour);
        const monthPath = (time: number): string => {
            const date = new Date(time);
            return this.pathOf(`plan-${date.getFullYear()}-${pad(date.getMonth() + 1)}.md`);
        };
        // 하루가 두 달에 걸칠 수 있으므로 시작과 끝이 든 달의 파일을 모두 고친다.
        const paths = [...new Set([monthPath(start), monthPath(end - 1)])];
        const vault = this.plugin.app.vault;
        for (const path of paths) {
            const rows = plans.filter((plan) => monthPath(plan.from) === path).map((plan) =>
                `| ${toDateKey(new Date(plan.from))} | ${formatClock(plan.from)} | ${formatClock(plan.to)} | ${toCell(plan.category)} | ${toCell(plan.memo)} |`);
            const file = vault.getFileByPath(path);
            if (!file) {
                if (rows.length > 0) await this.appendRow(path, PLAN_HEADER, rows.join('\n'));
                continue;
            }
            await vault.process(file, (data) => {
                const kept = data.split('\n').filter((line) => {
                    const plan = parsePlanRow(line.trim());
                    return !plan || plan.from < start || plan.from >= end;
                });
                return rows.reduce(appendLine, kept.join('\n'));
            });
        }
        await this.enqueue(() => this.loadFiles(paths));
    }

    // blocks.md가 없으면 기본 활동을 적어 만든다.
    private async blocksFile(): Promise<TFile> {
        const path = this.pathOf(BLOCKS_FILE);
        const vault = this.plugin.app.vault;
        const file = vault.getFileByPath(path);
        if (file) return file;
        await this.ensureFolder();
        return vault.create(path, BLOCKS_HEADER + DEFAULT_BLOCKS.map((name) => `| ${name} | | |\n`).join(''));
    }

    private async appendRow(path: string, header: string, row: string): Promise<void> {
        const vault = this.plugin.app.vault;
        const file = vault.getFileByPath(path);
        if (file) {
            await vault.process(file, (data) => appendLine(data, row));
        } else {
            await this.ensureFolder();
            await vault.create(path, header + row + '\n');
        }
    }

    private async ensureFolder(): Promise<void> {
        const folder = this.getFolder();
        if (!this.plugin.app.vault.getFolderByPath(folder)) await this.plugin.app.vault.createFolder(folder);
    }

    private pathOf(name: string): string {
        return normalizePath(`${this.getFolder()}/${name}`);
    }

    private enqueue(job: () => Promise<void>): Promise<void> {
        const run = this.loadQueue.then(job);
        this.loadQueue = run.catch(() => undefined);
        return run;
    }

    // 볼트 전체가 아니라 기록 폴더 안의 파일만 읽는다.
    private async loadAll(): Promise<void> {
        const fileRecords = new Map<string, FileRecords>();
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

    private async readFile(file: TFile): Promise<FileRecords> {
        const records: FileRecords = { logs: [], plans: [], blocks: [], later: [] };
        const isPlan = file.name.startsWith('plan-');
        const isBlocks = file.name === BLOCKS_FILE;
        const isLater = file.name === LATER_FILE;
        const content = await this.plugin.app.vault.cachedRead(file);
        let isHeaderSeen = false;
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (isBlocks || isLater) {
                const cells = tableCells(line);
                if (!cells) continue;
                // 첫 표 줄은 머리이고, 구분선(---)은 내용이 아니다.
                if (!isHeaderSeen) {
                    isHeaderSeen = true;
                    continue;
                }
                if (/^:?-+:?$/.test(cells[0] ?? '')) continue;
                if (isBlocks) {
                    const [name = '', minutes = '', repeat = ''] = cells;
                    if (!name) continue;
                    records.blocks.push({
                        name,
                        minutes: parseMinutes(minutes),
                        repeat: repeat.split(',').map((day) => day.trim()).filter(Boolean),
                    });
                } else {
                    const [date = '', name = '', minutes = '', memo = ''] = cells;
                    if (!name) continue;
                    records.later.push({ date, name, minutes: parseMinutes(minutes), memo, line });
                }
            } else if (isPlan) {
                const plan = parsePlanRow(line);
                if (plan) records.plans.push(plan);
            } else {
                const match = LOG_ROW_PATTERN.exec(line);
                if (!match) continue;
                const [, year, month, day, hour, minute, category, memo] = match;
                if (!category!.trim()) continue;
                records.logs.push({
                    time: new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime(),
                    category: category!.trim(),
                    memo: memo!.trim(),
                    file,
                    line,
                });
            }
        }
        return records;
    }

    private publish(): void {
        const all = [...this.fileRecords.values()];
        this.logs = all.flatMap((records) => records.logs).sort((a, b) => a.time - b.time);
        this.plans = all.flatMap((records) => records.plans).sort((a, b) => a.from - b.from);
        this.blockItems = this.fileRecords.has(this.pathOf(BLOCKS_FILE))
            ? all.flatMap((records) => records.blocks)
            : DEFAULT_BLOCKS.map((name) => ({ name, minutes: null, repeat: [] }));
        this.blocks = [...new Set(this.blockItems.map((block) => block.name))];
        this.later = all.flatMap((records) => records.later);
        this.plugin.dashboard.refresh('timeline');
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
        return normalizePath(this.plugin.settings.timelineFolder.trim() || DEFAULT_FOLDER);
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
