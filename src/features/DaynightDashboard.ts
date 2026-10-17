import { ItemView, WorkspaceLeaf } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { DAY, DaynightSegment, formatDuration, formatShortDate, pad, toSegments } from './Daynight';

export const VIEW_TYPE_DAYNIGHT_DASHBOARD = 'atoz-daynight-dashboard';
// 집계 기간(일). 0은 전체 기간이다.
export const DASHBOARD_RANGES = [7, 30, 90, 0];
const SLOT_MINUTES = 15;
const SLOT_COUNT = 24 * 60 / SLOT_MINUTES;
// 규칙성은 이 간격마다 지금과 24시간 뒤의 상태를 견준다.
const SAMPLE_STEP = 5 * 60 * 1000;
// 각성 시간 분포는 4시간 단위로 나누고 마지막 칸은 24시간 이상을 모두 담는다.
const AWAKE_BIN_HOURS = 4;
const AWAKE_BIN_COUNT = 7;

// 시간대 차트 좌표계
// 대시보드 최대 폭에 맞춰 글자가 거의 그대로의 크기로 보이게 한다.
const WINDOW_CHART_WIDTH = 860;
const WINDOW_CHART_HEIGHT = 80;
// 액토그램 좌표계. 한 줄에 이틀(48시간)을 그린다.
const ACTOGRAM_LABEL_WIDTH = 40;
const ACTOGRAM_PLOT_WIDTH = 820;
const ACTOGRAM_AXIS_HEIGHT = 14;
const ACTOGRAM_ROW_HEIGHT = 14;

interface ClockWindow {
    start: number;
    length: number;
}

function clipSegments(segments: DaynightSegment[], start: number, end: number): DaynightSegment[] {
    return segments
        .filter(({ from, to }) => to > start && from < end)
        .map((segment) => ({ ...segment, from: Math.max(segment.from, start), to: Math.min(segment.to, end) }));
}

// 시계 기준 15분 칸마다 기록이 있던 시간 중 잠든 시간의 비율을 구한다. 기록이 없는 칸은 null이다.
function sleepRatios(segments: DaynightSegment[]): (number | null)[] {
    const total = new Array<number>(SLOT_COUNT).fill(0);
    const asleep = new Array<number>(SLOT_COUNT).fill(0);
    for (const { from, to, type } of segments) {
        let time = from;
        while (time < to) {
            const date = new Date(time);
            const slot = Math.floor((date.getHours() * 60 + date.getMinutes()) / SLOT_MINUTES);
            const boundary = new Date(date);
            boundary.setHours(date.getHours(), (Math.floor(date.getMinutes() / SLOT_MINUTES) + 1) * SLOT_MINUTES, 0, 0);
            const next = Math.min(boundary.getTime(), to);
            total[slot]! += next - time;
            if (type === 'sleep') asleep[slot]! += next - time;
            time = next;
        }
    }
    return total.map((value, slot) => value > 0 ? asleep[slot]! / value : null);
}

// 이어진 칸을 시간대로 묶는다. 자정을 넘는 시간대도 한 덩어리로 센다.
function findWindows(flags: boolean[]): ClockWindow[] {
    if (flags.every(Boolean)) return [{ start: 0, length: SLOT_COUNT }];
    const offset = flags.indexOf(false);
    const windows: ClockWindow[] = [];
    let current: ClockWindow | null = null;
    for (let i = 1; i <= SLOT_COUNT; i++) {
        const slot = (offset + i) % SLOT_COUNT;
        if (!flags[slot]) {
            current = null;
        } else if (current) {
            current.length++;
        } else {
            current = { start: slot, length: 1 };
            windows.push(current);
        }
    }
    return windows.sort((a, b) => b.length - a.length);
}

function formatSlot(slot: number): string {
    const minutes = (slot * SLOT_MINUTES) % (24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function formatWindow({ start, length }: ClockWindow): string {
    if (length === SLOT_COUNT) return t('daynight.dashboard.allDay');
    return `${formatSlot(start)}–${formatSlot(start + length)}`;
}

// 수면 규칙성 지수(SRI). 24시간 간격의 두 시점이 같은 상태일 확률을 -100~100으로 옮긴다.
// 100은 매일 똑같고 0은 무작위 수준이다. segments는 start부터 end까지 빈틈없이 이어져 있어야 한다.
function regularityIndex(segments: DaynightSegment[], start: number, end: number): number | null {
    let same = 0;
    let count = 0;
    let a = 0;
    let b = 0;
    for (let time = start; time + DAY < end; time += SAMPLE_STEP) {
        while (segments[a]!.to <= time) a++;
        while (segments[b]!.to <= time + DAY) b++;
        count++;
        if (segments[a]!.type === segments[b]!.type) same++;
    }
    return count > 0 ? Math.round(200 * same / count - 100) : null;
}

export class DaynightDashboardView extends ItemView {
    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_DAYNIGHT_DASHBOARD; }
    getDisplayText(): string { return t('daynight.dashboard.viewName'); }
    getIcon(): string { return 'layout-dashboard'; }

    async onOpen(): Promise<void> {
        this.render();
    }

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('atoz-daynight-dashboard');

        const settings = this.plugin.settings;
        const header = container.createDiv({ cls: 'atoz-daynight-dashboard-header' });
        header.createDiv({ cls: 'atoz-daynight-dashboard-title', text: t('daynight.dashboard.viewName') });
        const ranges = header.createDiv({ cls: 'atoz-daynight-dashboard-ranges' });
        for (const days of DASHBOARD_RANGES) {
            const button = ranges.createEl('button', {
                text: days === 0 ? t('daynight.dashboard.all') : t('daynight.dashboard.days', { days }),
            });
            if (days === settings.daynightDashboardDays) button.addClass('is-active');
            button.addEventListener('click', () => {
                settings.daynightDashboardDays = days;
                void this.plugin.saveSettings();
                this.render();
            });
        }

        const records = this.plugin.daynight.records;
        const first = records[0];
        if (!first) {
            container.createDiv({ cls: 'atoz-daynight-dashboard-empty', text: t('daynight.noRecords') });
            return;
        }

        const now = Date.now();
        const days = settings.daynightDashboardDays;
        // 첫 기록 이전은 상태를 모르므로 집계에서 뺀다.
        const start = Math.max(days === 0 ? first.time : now - days * DAY, first.time);
        const segments = toSegments(records, now);
        const clipped = clipSegments(segments, start, now);

        const grid = container.createDiv({ cls: 'atoz-daynight-dashboard-grid' });
        this.renderWindows(this.createCard(grid, t('daynight.dashboard.windows'), 'is-wide'), clipped);
        this.renderRegularity(this.createCard(grid, t('daynight.dashboard.regularity')), clipped, start, now);
        // 각성 시간은 덩어리 단위로 세므로 끝이 기간 안에 있으면 통째로 넣는다. 진행 중인 구간은 뺀다.
        const awake = segments.slice(0, -1)
            .filter(({ type, to }) => type === 'wake' && to > start)
            .map(({ from, to }) => to - from);
        this.renderAwake(this.createCard(grid, t('daynight.dashboard.awake')), awake);
        this.renderActogram(this.createCard(grid, t('daynight.dashboard.actogram'), 'is-wide'), clipped, start, now);
    }

    private createCard(grid: HTMLElement, title: string, cls?: string): HTMLElement {
        const card = grid.createDiv({ cls: 'atoz-daynight-card' });
        if (cls) card.addClass(cls);
        card.createDiv({ cls: 'atoz-daynight-card-title', text: title });
        return card;
    }

    private renderWindows(card: HTMLElement, segments: DaynightSegment[]): void {
        const ratios = sleepRatios(segments);
        // 임계값을 움직이는 동안에는 이 부분만 다시 그려 슬라이더가 끊기지 않게 한다.
        const content = card.createDiv();
        const draw = (): void => {
            content.empty();
            const threshold = this.plugin.settings.daynightDashboardThreshold / 100;
            const flags = ratios.map((ratio) => ratio !== null && ratio >= threshold);
            const addRow = (label: string, windows: ClockWindow[]): void => {
                const row = content.createDiv({ cls: 'atoz-daynight-window-row' });
                row.createSpan({ cls: 'atoz-daynight-muted', text: label });
                const [main, ...rest] = windows;
                row.createSpan({ cls: 'atoz-daynight-window-main', text: main ? formatWindow(main) : t('daynight.dashboard.none') });
                if (rest.length > 0) row.createSpan({ cls: 'atoz-daynight-muted', text: rest.map(formatWindow).join(' · ') });
            };
            addRow(t('daynight.dashboard.sleepWindow'), findWindows(flags));
            addRow(t('daynight.dashboard.activeWindow'), findWindows(flags.map((flag) => !flag)));
            this.renderRatioChart(content, ratios, threshold);
        };
        draw();

        const control = card.createDiv({ cls: 'atoz-daynight-threshold' });
        const label = control.createSpan({ cls: 'atoz-daynight-muted' });
        const slider = control.createEl('input', { cls: 'slider', type: 'range', attr: { min: 10, max: 90, step: 10 } });
        slider.value = String(this.plugin.settings.daynightDashboardThreshold);
        const updateLabel = (): void => {
            label.setText(t('daynight.dashboard.threshold', { percent: this.plugin.settings.daynightDashboardThreshold }));
        };
        updateLabel();
        slider.addEventListener('input', () => {
            this.plugin.settings.daynightDashboardThreshold = Number(slider.value);
            updateLabel();
            draw();
        });
        slider.addEventListener('change', () => void this.plugin.saveSettings());
    }

    private renderRatioChart(container: HTMLElement, ratios: (number | null)[], threshold: number): void {
        const plotHeight = WINDOW_CHART_HEIGHT - 14;
        const slotWidth = WINDOW_CHART_WIDTH / SLOT_COUNT;
        const svg = container.createSvg('svg', {
            cls: 'atoz-daynight-ratio-chart',
            attr: { viewBox: `0 0 ${WINDOW_CHART_WIDTH} ${WINDOW_CHART_HEIGHT}` },
        });
        ratios.forEach((ratio, slot) => {
            if (!ratio) return;
            const bar = svg.createSvg('rect', {
                cls: 'atoz-daynight-sleep',
                attr: { x: slot * slotWidth, y: plotHeight * (1 - ratio), width: slotWidth - 0.5, height: plotHeight * ratio },
            });
            if (ratio < threshold) bar.addClass('atoz-daynight-dim');
        });
        const thresholdY = plotHeight * (1 - threshold);
        svg.createSvg('line', {
            cls: 'atoz-daynight-threshold-line',
            attr: { x1: 0, y1: thresholdY, x2: WINDOW_CHART_WIDTH, y2: thresholdY },
        });
        for (let hour = 0; hour <= 24; hour += 3) {
            const x = hour / 24 * WINDOW_CHART_WIDTH;
            const label = svg.createSvg('text', {
                cls: 'atoz-daynight-label',
                attr: { x: Math.min(Math.max(x, 6), WINDOW_CHART_WIDTH - 6), y: WINDOW_CHART_HEIGHT - 2, 'text-anchor': 'middle' },
            });
            label.textContent = String(hour);
        }
    }

    private renderRegularity(card: HTMLElement, segments: DaynightSegment[], start: number, end: number): void {
        const index = regularityIndex(segments, start, end);
        card.createDiv({ cls: 'atoz-daynight-card-value', text: index === null ? '—' : String(index) });
        card.createDiv({
            cls: 'atoz-daynight-muted',
            text: index === null ? t('daynight.dashboard.notEnough') : t('daynight.dashboard.regularityHint'),
        });
    }

    private renderAwake(card: HTMLElement, durations: number[]): void {
        if (durations.length === 0) {
            card.createDiv({ cls: 'atoz-daynight-muted', text: t('daynight.dashboard.notEnough') });
            return;
        }
        const longest = Math.max(...durations);
        const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
        card.createDiv({
            cls: 'atoz-daynight-card-value',
            text: t('daynight.dashboard.longest', { duration: formatDuration(longest) }),
        });
        card.createDiv({ cls: 'atoz-daynight-muted', text: t('daynight.dashboard.average', { duration: formatDuration(average) }) });

        const bins = new Array<number>(AWAKE_BIN_COUNT).fill(0);
        for (const duration of durations) {
            bins[Math.min(Math.floor(duration / (AWAKE_BIN_HOURS * 60 * 60 * 1000)), AWAKE_BIN_COUNT - 1)]!++;
        }
        const peak = Math.max(...bins);
        const histogram = card.createDiv({ cls: 'atoz-daynight-histogram' });
        bins.forEach((count, index) => {
            const from = index * AWAKE_BIN_HOURS;
            const label = index === AWAKE_BIN_COUNT - 1
                ? t('daynight.dashboard.binOpen', { from })
                : t('daynight.dashboard.bin', { from, to: from + AWAKE_BIN_HOURS });
            histogram.createSpan({ cls: 'atoz-daynight-muted', text: label });
            const track = histogram.createDiv({ cls: 'atoz-daynight-histogram-track' });
            const bar = track.createDiv({ cls: 'atoz-daynight-histogram-bar' });
            bar.style.width = `${count / peak * 100}%`;
            histogram.createSpan({ cls: 'atoz-daynight-histogram-count', text: String(count) });
        });
    }

    // 하루에 한 줄씩, 그날과 다음 날을 이어 48시간을 그린다(double plot).
    // 각 날이 위 줄 오른쪽과 아래 줄 왼쪽에 두 번 나와서 자정을 넘는 수면도 끊기지 않고 보인다.
    private renderActogram(card: HTMLElement, segments: DaynightSegment[], start: number, end: number): void {
        const firstDay = new Date(start);
        firstDay.setHours(0, 0, 0, 0);
        firstDay.setDate(firstDay.getDate() - 1);
        const lastDay = new Date(end);
        lastDay.setHours(0, 0, 0, 0);
        lastDay.setDate(lastDay.getDate() - 1);
        const days: Date[] = [];
        for (const day = new Date(firstDay); day <= lastDay; day.setDate(day.getDate() + 1)) days.push(new Date(day));

        const width = ACTOGRAM_LABEL_WIDTH + ACTOGRAM_PLOT_WIDTH;
        const height = ACTOGRAM_AXIS_HEIGHT + days.length * ACTOGRAM_ROW_HEIGHT;
        const svg = card.createSvg('svg', {
            cls: 'atoz-daynight-actogram',
            attr: { viewBox: `0 0 ${width} ${height}` },
        });

        for (let hour = 0; hour <= 48; hour += 6) {
            const x = ACTOGRAM_LABEL_WIDTH + hour / 48 * ACTOGRAM_PLOT_WIDTH;
            const grid = svg.createSvg('line', {
                cls: 'atoz-daynight-grid',
                attr: { x1: x, y1: ACTOGRAM_AXIS_HEIGHT, x2: x, y2: height },
            });
            if (hour % 24 === 0) grid.addClass('atoz-daynight-midnight');
            const label = svg.createSvg('text', {
                cls: 'atoz-daynight-label',
                attr: { x: Math.min(x, width - 6), y: 10, 'text-anchor': 'middle' },
            });
            label.textContent = String(hour === 48 ? 24 : hour % 24);
        }

        days.forEach((day, index) => {
            const from = day.getTime();
            const rowEnd = new Date(day);
            rowEnd.setDate(rowEnd.getDate() + 2);
            const to = rowEnd.getTime();
            const x = (time: number): number => ACTOGRAM_LABEL_WIDTH + (time - from) / (to - from) * ACTOGRAM_PLOT_WIDTH;
            const y = ACTOGRAM_AXIS_HEIGHT + index * ACTOGRAM_ROW_HEIGHT;

            const label = svg.createSvg('text', {
                cls: 'atoz-daynight-label',
                attr: { x: 0, y: y + ACTOGRAM_ROW_HEIGHT - 3 },
            });
            label.textContent = formatShortDate(from);

            // 기록이 있는 부분만 바탕을 깔아 깨어 있던 시간과 기록이 없는 시간을 구분한다.
            const knownFrom = Math.max(from, start);
            const knownTo = Math.min(to, end);
            if (knownTo > knownFrom) {
                svg.createSvg('rect', {
                    cls: 'atoz-daynight-track',
                    attr: { x: x(knownFrom), y: y + 1, width: x(knownTo) - x(knownFrom), height: ACTOGRAM_ROW_HEIGHT - 2 },
                });
            }
            for (const segment of segments) {
                if (segment.type !== 'sleep' || segment.to <= from || segment.from >= to) continue;
                const barFrom = Math.max(segment.from, from);
                const barTo = Math.min(segment.to, to);
                svg.createSvg('rect', {
                    cls: 'atoz-daynight-sleep',
                    attr: { x: x(barFrom), y: y + 1, width: x(barTo) - x(barFrom), height: ACTOGRAM_ROW_HEIGHT - 2 },
                });
            }
        });
    }
}
