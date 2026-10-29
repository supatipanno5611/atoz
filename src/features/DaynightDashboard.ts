import { setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import {
    DAY, DaynightSegment, formatDuration, formatGapLength, formatShortDate, formatShortDateTime, formatTime, pad,
} from './Daynight';

// 집계 기간(일). 0은 전체 기간이다.
export const DASHBOARD_RANGES = [7, 30, 90, 0];
const SLOT_MINUTES = 15;
const SLOT_COUNT = 24 * 60 / SLOT_MINUTES;
// 규칙성은 이 간격마다 지금과 24시간 뒤의 상태를 견준다.
const SAMPLE_STEP = 5 * 60 * 1000;
// 각성 시간 분포는 4시간 단위로 나누고 마지막 칸은 24시간 이상을 모두 담는다.
const AWAKE_BIN_HOURS = 4;
const AWAKE_BIN_COUNT = 7;

// 24시간 차트 배경을 어둡게 칠하는 밤 시간대
const NIGHT_START_HOUR = 18;
const NIGHT_END_HOUR = 6;

// 24시간 차트 좌표계
const DAY_CHART_WIDTH = 860;
const BAR_TOP = 18;
const BAR_HEIGHT = 32;
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
        if (type === 'gap') continue;
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
// 둘 중 하나라도 기록 없음이면 그 시점은 세지 않는다.
function regularityIndex(segments: DaynightSegment[], start: number, end: number): number | null {
    let same = 0;
    let count = 0;
    let a = 0;
    let b = 0;
    for (let time = start; time + DAY < end; time += SAMPLE_STEP) {
        while (segments[a]!.to <= time) a++;
        while (segments[b]!.to <= time + DAY) b++;
        if (segments[a]!.type === 'gap' || segments[b]!.type === 'gap') continue;
        count++;
        if (segments[a]!.type === segments[b]!.type) same++;
    }
    return count > 0 ? Math.round(200 * same / count - 100) : null;
}

// 기록 없음 구간을 칠할 빗금. 같은 id를 여러 차트가 정의해도 모양이 같아 상관없다.
function addHatch(svg: SVGSVGElement): void {
    const pattern = svg.createSvg('defs').createSvg('pattern', {
        attr: { id: 'atoz-daynight-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    });
    pattern.createSvg('rect', { cls: 'atoz-daynight-gap-fill', attr: { width: 6, height: 6 } });
    pattern.createSvg('line', { cls: 'atoz-daynight-gap-line', attr: { x1: 0, y1: 0, x2: 0, y2: 6 } });
}

// 집계 기간의 시작. 첫 기록 이전은 상태를 모르므로 집계에서 뺀다.
function rangeStart(firstTime: number, days: number, now: number): number {
    return Math.max(days === 0 ? firstTime : now - days * DAY, firstTime);
}

export interface DaynightSummary {
    lastSleep: DaynightSegment | null;
    regularity: number | null;
    days: number;
}

/** 홈 카드에 보일 가장 최근에 끝난 수면과 대시보드 집계 기간의 규칙성. */
export function daynightSummary(plugin: ATOZPlugin): DaynightSummary {
    const days = plugin.settings.daynightDashboardDays;
    const records = plugin.daynight.records;
    const first = records[0];
    if (!first) return { lastSleep: null, regularity: null, days };
    const now = Date.now();
    const segments = plugin.daynight.segments(now);
    const start = rangeStart(first.time, days, now);
    return {
        lastSleep: segments.slice(0, -1).filter(({ type }) => type === 'sleep').pop() ?? null,
        regularity: regularityIndex(clipSegments(segments, start, now), start, now),
        days,
    };
}

export class DaynightDashboardPage {
    // 24시간 차트에서 고른 구간의 시작 시각. null이면 현재 시각에서 끝나는 24시간을 보여 준다.
    private selectedStart: number | null = null;

    constructor(private plugin: ATOZPlugin, private container: HTMLElement) {
        container.addClass('atoz-daynight-dashboard');
    }

    render(): void {
        const container = this.container;
        container.empty();

        const settings = this.plugin.settings;
        const header = container.createDiv({ cls: 'atoz-daynight-dashboard-header' });
        const ranges = header.createDiv({ cls: 'atoz-daynight-dashboard-ranges' });
        for (const days of DASHBOARD_RANGES) {
            const button = ranges.createEl('button', {
                text: days === 0 ? t('daynight.dashboard.all') : t('daynight.dashboard.days', { days }),
            });
            if (days === settings.daynightDashboardDays) button.addClass('is-active');
            button.setAttr('aria-pressed', String(days === settings.daynightDashboardDays));
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
        const start = rangeStart(first.time, days, now);
        const segments = this.plugin.daynight.segments(now);
        const clipped = clipSegments(segments, start, now);

        const gaps = clipped.filter(({ type }) => type === 'gap');
        if (gaps.length > 0) {
            const ranges = gaps.map(({ from, to }) => {
                const dates = formatShortDate(from) === formatShortDate(to)
                    ? formatShortDate(from)
                    : `${formatShortDate(from)}–${formatShortDate(to)}`;
                return `${dates} (${formatGapLength(to - from)})`;
            });
            const notice = container.createDiv({ cls: 'atoz-daynight-dashboard-gaps' });
            setIcon(notice.createSpan(), 'alert-triangle');
            notice.createSpan({ text: t('daynight.dashboard.gaps', { ranges: ranges.join(', ') }) });
        }

        const grid = container.createDiv({ cls: 'atoz-daynight-dashboard-grid' });
        this.renderDay(this.createCard(grid, t('daynight.dashboard.day'), 'is-wide'), segments, now);
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

    private renderDay(card: HTMLElement, segments: DaynightSegment[], now: number): void {
        // 진행 중인 마지막 구간은 현재 화면과 같으므로 끝난 구간만 고를 수 있다.
        const finished = segments.slice(0, -1);
        // 기록이 지워져 선택한 구간이 없어지면 현재로 돌아간다.
        const selectedIndex = finished.findIndex(({ from }) => from === this.selectedStart);
        const selected = finished[selectedIndex] ?? null;
        if (!selected) this.selectedStart = null;

        // 선택한 구간을 가운데에 두되 현재 시각 너머로는 넘어가지 않는다.
        const end = selected ? Math.min((selected.from + selected.to + DAY) / 2, now) : now;
        const start = end - DAY;

        const nav = card.createDiv({ cls: 'atoz-daynight-nav' });
        nav.createSpan({ cls: 'atoz-daynight-range', text: `${formatShortDateTime(start)} – ${formatShortDateTime(end)}` });
        const controls = nav.createDiv({ cls: 'atoz-daynight-controls' });
        // 현재에서 ‹는 가장 최근에 끝난 구간을, 그 구간에서 ›는 현재를 연다.
        const addNavButton = (icon: string, label: string, disabled: boolean, targetIndex: number): void => {
            const button = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
            setIcon(button, icon);
            button.disabled = disabled;
            button.addEventListener('click', () => {
                this.selectedStart = finished[targetIndex]?.from ?? null;
                this.render();
            });
        };
        const currentIndex = selected ? selectedIndex : finished.length;
        addNavButton('chevron-left', t('daynight.previous'), currentIndex === 0, currentIndex - 1);
        addNavButton('rotate-ccw', t('daynight.now'), !selected, -1);
        addNavButton('chevron-right', t('daynight.next'), !selected, currentIndex + 1);

        // 고른 구간이 없으면 진행 중인 마지막 구간을 진하게 둔다.
        const focused = selected ?? segments[segments.length - 1]!;
        this.renderDayChart(card, segments, start, end, end === now ? now : null, focused);

        // 진하게 칠한 구간을 한 줄로 풀어 쓴다. 진행 중인 구간은 끝 시각을 적지 않는다.
        const { from, to, type } = focused;
        const isSleep = type === 'sleep';
        const sameDay = formatShortDate(from) === formatShortDate(to);
        const formatEdge = (time: number): string => sameDay ? formatTime(time) : formatShortDateTime(time);
        if (type === 'gap') {
            const parts = [t('daynight.gap.name'), formatGapLength(to - from), t('record.since', { time: formatEdge(from) })];
            if (selected) parts.push(t('daynight.gap.until', { time: formatEdge(to) }));
            card.createDiv({ cls: 'atoz-daynight-muted', text: parts.join(' · ') });
            return;
        }
        const parts = [
            t(isSleep ? 'daynight.sleepOn' : 'daynight.awakeOn', { date: formatShortDate(from) }),
            formatDuration(to - from),
            t(isSleep ? 'daynight.sleptAt' : 'daynight.wokeAt', { time: formatEdge(from) }),
        ];
        if (selected) parts.push(t(isSleep ? 'daynight.wokeAt' : 'daynight.sleptAt', { time: formatEdge(to) }));
        card.createDiv({ cls: 'atoz-daynight-muted', text: parts.join(' · ') });
    }

    private renderDayChart(
        container: HTMLElement,
        segments: DaynightSegment[],
        start: number,
        end: number,
        now: number | null,
        focused: DaynightSegment,
    ): void {
        const x = (time: number): number => (time - start) / (end - start) * DAY_CHART_WIDTH;
        const svg = container.createSvg('svg', {
            cls: 'atoz-daynight-chart',
            attr: { viewBox: `0 0 ${DAY_CHART_WIDTH} ${BAR_TOP + BAR_HEIGHT + 16}` },
        });
        addHatch(svg);
        svg.createSvg('rect', {
            cls: 'atoz-daynight-track',
            attr: { x: 0, y: BAR_TOP, width: DAY_CHART_WIDTH, height: BAR_HEIGHT, rx: 6 },
        });

        // 밤 시간대 배경은 띠의 둥근 모서리 안으로 잘라 그린다.
        const clipPath = svg.createSvg('defs').createSvg('clipPath', { attr: { id: 'atoz-daynight-track-clip' } });
        clipPath.createSvg('rect', { attr: { x: 0, y: BAR_TOP, width: DAY_CHART_WIDTH, height: BAR_HEIGHT, rx: 6 } });
        const nights = svg.createSvg('g', { attr: { 'clip-path': 'url(#atoz-daynight-track-clip)' } });
        const night = new Date(start);
        night.setDate(night.getDate() - 1);
        night.setHours(NIGHT_START_HOUR, 0, 0, 0);
        for (; night.getTime() < end; night.setDate(night.getDate() + 1)) {
            const nightEnd = new Date(night);
            nightEnd.setDate(nightEnd.getDate() + 1);
            nightEnd.setHours(NIGHT_END_HOUR);
            const from = Math.max(night.getTime(), start);
            const to = Math.min(nightEnd.getTime(), end);
            if (to <= from) continue;
            nights.createSvg('rect', {
                cls: 'atoz-daynight-night',
                attr: { x: x(from), y: BAR_TOP, width: x(to) - x(from), height: BAR_HEIGHT },
            });
        }

        // 시계 기준 3시간 눈금
        const tick = new Date(start);
        tick.setMinutes(0, 0, 0);
        while (tick.getTime() < start || tick.getHours() % 3 !== 0) tick.setHours(tick.getHours() + 1);
        for (; tick.getTime() <= end; tick.setHours(tick.getHours() + 3)) {
            const tickX = x(tick.getTime());
            const isMidnight = tick.getHours() === 0;
            // createSvg는 cls를 classList.add로 넣어서 공백이 든 문자열을 주면 예외가 난다.
            const grid = svg.createSvg('line', {
                cls: 'atoz-daynight-grid',
                attr: { x1: tickX, y1: BAR_TOP, x2: tickX, y2: BAR_TOP + BAR_HEIGHT },
            });
            if (isMidnight) grid.addClass('atoz-daynight-midnight');
            const label = svg.createSvg('text', {
                cls: 'atoz-daynight-label',
                attr: { x: Math.min(Math.max(tickX, 6), DAY_CHART_WIDTH - 6), y: BAR_TOP + BAR_HEIGHT + 13, 'text-anchor': 'middle' },
            });
            label.textContent = String(tick.getHours());
            if (isMidnight) {
                const dateLabel = svg.createSvg('text', {
                    cls: 'atoz-daynight-label',
                    attr: { x: Math.min(tickX, DAY_CHART_WIDTH - 30), y: 11 },
                });
                dateLabel.textContent = formatShortDate(tick.getTime());
            }
        }

        // 수면 구간과 깨어 있는 구간을 번갈아 칠하고, 기록 없음은 빗금으로 둔다.
        for (const segment of segments) {
            const clippedFrom = Math.max(segment.from, start);
            const clippedTo = Math.min(segment.to, end);
            if (clippedTo <= clippedFrom) continue;
            const bar = svg.createSvg('rect', {
                cls: segment.type === 'sleep' ? 'atoz-daynight-sleep' : segment.type === 'wake' ? 'atoz-daynight-wake' : 'atoz-daynight-gap',
                attr: { x: x(clippedFrom), y: BAR_TOP + 4, width: x(clippedTo) - x(clippedFrom), height: BAR_HEIGHT - 8, rx: 3 },
            });
            if (segment.from !== focused.from) bar.addClass('atoz-daynight-dim');
        }

        if (now !== null) {
            const nowX = Math.min(x(now), DAY_CHART_WIDTH - 1);
            svg.createSvg('line', {
                cls: 'atoz-daynight-now',
                attr: { x1: nowX, y1: BAR_TOP - 4, x2: nowX, y2: BAR_TOP + BAR_HEIGHT + 4 },
            });
        }
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
        addHatch(svg);

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
                if (segment.type === 'wake' || segment.to <= from || segment.from >= to) continue;
                const barFrom = Math.max(segment.from, from);
                const barTo = Math.min(segment.to, to);
                svg.createSvg('rect', {
                    cls: segment.type === 'sleep' ? 'atoz-daynight-sleep' : 'atoz-daynight-gap',
                    attr: { x: x(barFrom), y: y + 1, width: x(barTo) - x(barFrom), height: ACTOGRAM_ROW_HEIGHT - 2 },
                });
            }
        });
    }
}
