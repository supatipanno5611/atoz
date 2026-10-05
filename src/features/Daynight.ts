import { ItemView, TAbstractFile, TFile, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';

export const VIEW_TYPE_DAYNIGHT = 'atoz-daynight-view';
const DEFAULT_FOLDER = 'sleep';
const FILE_NAME_PATTERN = /^sleep-\d{4}-\d{2}\.md$/;
const ROW_PATTERN = /^\|\s*(\d{4})-(\d{2})-(\d{2})\s*\|\s*(\d{2}):(\d{2})\s*\|\s*(sleep|wake)\s*\|$/;
const TABLE_HEADER = '| Date | Time | Type |\n| --- | --- | --- |\n';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WINDOW = 2 * DAY;
const RECENT_COUNT = 3;
const RELOAD_DELAY = 100;

// 차트 좌표계
const CHART_WIDTH = 300;
const BAR_TOP = 18;
const BAR_HEIGHT = 32;

type DaynightType = 'sleep' | 'wake';

interface DaynightRecord {
    time: number;
    type: DaynightType;
    file: TFile;
    line: string;
}

const pad = (value: number): string => String(value).padStart(2, '0');

function formatDuration(ms: number): string {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

function formatShortDate(time: number): string {
    const date = new Date(time);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatTime(time: number): string {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatShortDateTime(time: number): string {
    return `${formatShortDate(time)} ${formatTime(time)}`;
}

// sleep 다음의 wake를 짝지어 구간으로 만든다. 마지막 sleep은 지금까지 진행 중인 구간이다.
function toSegments(records: DaynightRecord[], now: number): [number, number][] {
    const segments: [number, number][] = [];
    let sleepStart: number | null = null;
    for (const record of records) {
        if (record.type === 'sleep') {
            sleepStart = record.time;
        } else if (sleepStart !== null) {
            segments.push([sleepStart, record.time]);
            sleepStart = null;
        }
    }
    if (sleepStart !== null) segments.push([sleepStart, now]);
    return segments;
}

function sleptBetween(segments: [number, number][], start: number, end: number): number {
    let total = 0;
    for (const [from, to] of segments) {
        total += Math.max(0, Math.min(to, end) - Math.max(from, start));
    }
    return total;
}

export class DaynightView extends ItemView {
    // null이면 현재 시각에서 끝나는 구간을 보여 준다.
    private windowEnd: number | null = null;
    private isDeleteShown = false;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_DAYNIGHT; }
    getDisplayText(): string { return t('daynight.viewName'); }
    getIcon(): string { return 'moon'; }

    async onOpen(): Promise<void> {
        this.registerInterval(window.setInterval(() => this.render(), 60 * 1000));
        this.render();
    }

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('atoz-daynight');

        const records = this.plugin.daynight.records;
        const now = Date.now();
        const end = this.windowEnd ?? now;
        const start = end - WINDOW;
        const segments = toSegments(records, now);
        const oldest = records[0]?.time ?? now;

        const last = records[records.length - 1];

        // 버튼은 스크롤 영역 밖에 두어 사이드바가 낮아도 항상 하단에 보이게 한다.
        const body = container.createDiv({ cls: 'atoz-daynight-body' });
        const hero = body.createDiv({ cls: 'atoz-daynight-hero' });
        if (!last) {
            hero.createDiv({ cls: 'atoz-daynight-empty-title', text: t('daynight.noRecords') });
            hero.createDiv({ cls: 'atoz-daynight-hero-sub', text: t('daynight.noRecordsHint') });
        } else if (this.windowEnd === null) {
            const isAsleep = last.type === 'sleep';
            const status = hero.createDiv({ cls: 'atoz-daynight-hero-label' });
            status.createSpan({ cls: `atoz-daynight-dot ${isAsleep ? 'is-asleep' : 'is-awake'}` });
            status.createSpan({ text: t(isAsleep ? 'daynight.asleep' : 'daynight.awake') });
            hero.createDiv({ cls: 'atoz-daynight-hero-value', text: formatDuration(now - last.time) });
            const lastTime = formatShortDate(last.time) === formatShortDate(now)
                ? formatTime(last.time)
                : formatShortDateTime(last.time);
            const lastText = t(isAsleep ? 'daynight.sleptAt' : 'daynight.wokeAt', { time: lastTime });
            const totalText = t('daynight.last24h', { duration: formatDuration(sleptBetween(segments, now - DAY, now)) });
            hero.createDiv({ cls: 'atoz-daynight-hero-sub', text: `${lastText} · ${totalText}` });
        } else {
            // 과거 구간을 볼 때는 상태 대신 그 구간 끝 기준 24시간 수면 합계를 보여 준다.
            hero.createDiv({ cls: 'atoz-daynight-hero-label', text: t('daynight.before24h', { time: formatShortDateTime(end) }) });
            hero.createDiv({ cls: 'atoz-daynight-hero-value', text: formatDuration(sleptBetween(segments, end - DAY, end)) });
        }

        if (last) {
            const nav = body.createDiv({ cls: 'atoz-daynight-nav' });
            nav.createSpan({ cls: 'atoz-daynight-range', text: `${formatShortDateTime(start)} – ${formatShortDateTime(end)}` });
            const controls = nav.createDiv({ cls: 'atoz-daynight-controls' });
            const addNavButton = (icon: string, label: string, disabled: boolean, target: () => number | null): void => {
                const button = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
                setIcon(button, icon);
                button.disabled = disabled;
                button.addEventListener('click', () => {
                    this.windowEnd = target();
                    this.render();
                });
            };
            addNavButton('chevron-left', t('daynight.previous'), start <= oldest, () => end - DAY);
            addNavButton('rotate-ccw', t('daynight.now'), this.windowEnd === null, () => null);
            addNavButton('chevron-right', t('daynight.next'), this.windowEnd === null,
                () => end + DAY >= Date.now() ? null : end + DAY);

            this.renderChart(body, segments, start, end, this.windowEnd === null ? now : null);
            this.renderRecent(body, records);
        }

        const isAsleep = last?.type === 'sleep';
        const toggleButton = container.createEl('button', {
            cls: `atoz-daynight-toggle ${isAsleep ? 'is-asleep' : 'is-awake'}`,
        });
        setIcon(toggleButton, isAsleep ? 'sun' : 'moon');
        toggleButton.createSpan({ text: isAsleep ? t('daynight.wakeNow') : t('daynight.sleepNow') });
        toggleButton.addEventListener('click', () => void this.plugin.daynight.toggle());
    }

    private renderChart(
        container: HTMLElement,
        segments: [number, number][],
        start: number,
        end: number,
        now: number | null,
    ): void {
        const x = (time: number): number => (time - start) / (end - start) * CHART_WIDTH;
        const svg = container.createSvg('svg', {
            cls: 'atoz-daynight-chart',
            attr: { viewBox: `0 0 ${CHART_WIDTH} ${BAR_TOP + BAR_HEIGHT + 16}` },
        });
        svg.createSvg('rect', {
            cls: 'atoz-daynight-track',
            attr: { x: 0, y: BAR_TOP, width: CHART_WIDTH, height: BAR_HEIGHT, rx: 6 },
        });

        // 시계 기준 6시간 눈금
        const tick = new Date(start);
        tick.setMinutes(0, 0, 0);
        while (tick.getTime() < start || tick.getHours() % 6 !== 0) tick.setHours(tick.getHours() + 1);
        for (; tick.getTime() <= end; tick.setHours(tick.getHours() + 6)) {
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
                attr: { x: Math.min(Math.max(tickX, 6), CHART_WIDTH - 6), y: BAR_TOP + BAR_HEIGHT + 13, 'text-anchor': 'middle' },
            });
            label.textContent = String(tick.getHours());
            if (isMidnight) {
                const dateLabel = svg.createSvg('text', {
                    cls: 'atoz-daynight-label',
                    attr: { x: Math.min(tickX, CHART_WIDTH - 30), y: 11 },
                });
                dateLabel.textContent = formatShortDate(tick.getTime());
            }
        }

        for (const [from, to] of segments) {
            const clippedFrom = Math.max(from, start);
            const clippedTo = Math.min(to, end);
            if (clippedTo <= clippedFrom) continue;
            svg.createSvg('rect', {
                cls: 'atoz-daynight-sleep',
                attr: { x: x(clippedFrom), y: BAR_TOP + 4, width: x(clippedTo) - x(clippedFrom), height: BAR_HEIGHT - 8, rx: 3 },
            });
        }

        if (now !== null) {
            const nowX = Math.min(x(now), CHART_WIDTH - 1);
            svg.createSvg('line', {
                cls: 'atoz-daynight-now',
                attr: { x1: nowX, y1: BAR_TOP - 4, x2: nowX, y2: BAR_TOP + BAR_HEIGHT + 4 },
            });
        }
    }

    private renderRecent(container: HTMLElement, records: DaynightRecord[]): void {
        const section = container.createDiv({ cls: 'atoz-daynight-recent' });
        // 시간순으로 두어 가장 최근 기록이 맨 아래에 온다.
        const recent = records.slice(-RECENT_COUNT);
        recent.forEach((record, index) => {
            const row = section.createDiv({ cls: 'atoz-daynight-record' });
            row.createSpan({ cls: 'atoz-daynight-record-time', text: formatShortDateTime(record.time) });
            row.createSpan({ cls: 'atoz-daynight-muted', text: t(record.type === 'sleep' ? 'daynight.sleep' : 'daynight.wake') });
            if (index !== recent.length - 1) return;

            // 마지막 기록만 지울 수 있어서 기록은 항상 sleep과 wake가 번갈아 나온다.
            row.addClass('atoz-daynight-last');
            row.addEventListener('click', () => {
                this.isDeleteShown = !this.isDeleteShown;
                this.render();
            });
            if (!this.isDeleteShown) return;
            const deleteButton = row.createEl('button', {
                cls: 'atoz-daynight-delete',
                attr: { 'aria-label': t('daynight.deleteLast') },
            });
            setIcon(deleteButton, 'x');
            deleteButton.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.isDeleteShown = false;
                void this.plugin.daynight.deleteLast();
            });
        });
    }
}

export class DaynightFeature {
    records: DaynightRecord[] = [];
    private reloadTimer: number | null = null;
    private loadId = 0;
    private isWriting = false;

    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.registerView(VIEW_TYPE_DAYNIGHT, (leaf) => new DaynightView(leaf, this.plugin));

        this.plugin.addCommand({
            id: 'open-daynight-view',
            name: t('command.openDaynightView'),
            callback: () => void this.activateView(),
        });

        this.plugin.addRibbonIcon('moon', t('ribbon.openDaynightView'), () => void this.activateView());

        this.plugin.app.workspace.onLayoutReady(() => {
            const vault = this.plugin.app.vault;
            this.plugin.registerEvent(vault.on('create', (file) => this.onFileEvent(file)));
            this.plugin.registerEvent(vault.on('modify', (file) => this.onFileEvent(file)));
            this.plugin.registerEvent(vault.on('delete', (file) => this.onFileEvent(file)));
            this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
                if (this.isRecordFile(file) || this.isRecordPath(oldPath)) this.scheduleReload();
            }));
            void this.load();
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
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const row = `| ${date} | ${pad(now.getHours())}:${pad(now.getMinutes())} | ${type} |`;

        await this.write(async () => {
            const vault = this.plugin.app.vault;
            const folder = this.getFolder();
            if (!vault.getFolderByPath(folder)) await vault.createFolder(folder);
            const path = normalizePath(`${folder}/sleep-${now.getFullYear()}-${pad(now.getMonth() + 1)}.md`);
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
        const last = this.records[this.records.length - 1];
        if (!last) return;

        await this.write(() => this.plugin.app.vault.process(last.file, (data) => {
            const lines = data.split('\n');
            const index = lines.map((line) => line.trim()).lastIndexOf(last.line);
            if (index !== -1) lines.splice(index, 1);
            return lines.join('\n');
        }));
    }

    // 버튼을 연달아 눌러도 기록을 다시 읽기 전에 같은 종류를 두 번 쓰지 않게 한다.
    private async write(action: () => Promise<unknown>): Promise<void> {
        if (this.isWriting) return;
        this.isWriting = true;
        try {
            await action();
            await this.load();
        } finally {
            this.isWriting = false;
        }
    }

    private async load(): Promise<void> {
        const currentLoad = ++this.loadId;
        const records: DaynightRecord[] = [];
        const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => this.isRecordFile(file));
        for (const file of files) {
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
        }
        if (currentLoad !== this.loadId) return;

        this.records = records.sort((a, b) => a.time - b.time);
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DAYNIGHT).forEach((leaf) => {
            if (leaf.view instanceof DaynightView) leaf.view.render();
        });
    }

    private onFileEvent(file: TAbstractFile): void {
        if (this.isRecordFile(file)) this.scheduleReload();
    }

    private scheduleReload(): void {
        if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
        this.reloadTimer = window.setTimeout(() => {
            this.reloadTimer = null;
            void this.load();
        }, RELOAD_DELAY);
    }

    private getFolder(): string {
        return normalizePath(this.plugin.settings.daynightFolder.trim() || DEFAULT_FOLDER);
    }

    private isRecordFile(file: TAbstractFile): boolean {
        return file instanceof TFile && this.isRecordPath(file.path);
    }

    private isRecordPath(path: string): boolean {
        const slash = path.lastIndexOf('/');
        const parent = slash === -1 ? '/' : path.slice(0, slash);
        return parent === this.getFolder() && FILE_NAME_PATTERN.test(path.slice(slash + 1));
    }
}
