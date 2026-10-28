import { ItemView, TAbstractFile, TFile, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';

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

export class DaynightView extends ItemView {
    private isActionsShown = false;
    // 시각을 고치는 중인 기록의 시각과 입력 중인 값
    private editingTime: number | null = null;
    private editDraft = '';

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_DAYNIGHT; }
    getDisplayText(): string { return t('daynight.viewName'); }
    getIcon(): string { return 'moon'; }

    async onOpen(): Promise<void> {
        // 시각을 고치는 중에는 다시 그리면 입력과 시각 선택기가 닫히므로 건너뛴다.
        this.registerInterval(window.setInterval(() => {
            if (this.editingTime === null) this.render();
        }, 60 * 1000));
        this.render();
    }

    render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('atoz-daynight');

        const records = this.plugin.daynight.records;
        const now = Date.now();
        const segments = toSegments(records, now);
        const last = records[records.length - 1];
        if (this.editingTime !== last?.time) this.editingTime = null;

        // 버튼은 스크롤 영역 밖에 두어 사이드바가 낮아도 항상 하단에 보이게 한다.
        const body = container.createDiv({ cls: 'atoz-daynight-body' });
        const hero = body.createDiv({ cls: 'atoz-daynight-hero' });
        if (!last) {
            hero.createDiv({ cls: 'atoz-daynight-empty-title', text: t('daynight.noRecords') });
            hero.createDiv({ cls: 'atoz-daynight-hero-sub', text: t('daynight.noRecordsHint') });
        } else {
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

            this.renderRecent(body, records);

            const links = body.createDiv({ cls: 'atoz-daynight-links' });
            const addLink = (icon: string, label: string, onClick: () => void): void => {
                const button = links.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
                setIcon(button, icon);
                button.addEventListener('click', onClick);
            };
            // 월초에 아직 이번 달 기록이 없어도 빈 파일을 만들지 않도록 마지막 기록이 든 파일을 연다.
            addLink('file-text', t('daynight.openFile'), () => void this.app.workspace.getLeaf(false).openFile(last.file));
            addLink('moon', t('daynight.openDashboard'), () => void this.plugin.dashboard.open('daynight'));
        }

        const isAsleep = last?.type === 'sleep';
        const toggleButton = container.createEl('button', {
            cls: `atoz-daynight-toggle ${isAsleep ? 'is-asleep' : 'is-awake'}`,
        });
        setIcon(toggleButton, isAsleep ? 'sun' : 'moon');
        toggleButton.createSpan({ text: isAsleep ? t('daynight.wakeNow') : t('daynight.sleepNow') });
        toggleButton.addEventListener('click', () => void this.plugin.daynight.toggle());
    }

    private renderRecent(container: HTMLElement, records: DaynightRecord[]): void {
        const section = container.createDiv({ cls: 'atoz-daynight-recent' });
        // 시간순으로 두어 가장 최근 기록이 맨 아래에 온다.
        const recent = records.slice(-this.plugin.settings.daynightRecentCount);
        recent.forEach((record, index) => {
            const row = section.createDiv({ cls: 'atoz-daynight-record' });
            const isLast = index === recent.length - 1;
            if (isLast && this.editingTime === record.time) {
                this.renderEditor(section, row, record, records[records.length - 2]);
                return;
            }
            row.createSpan({ cls: 'atoz-daynight-record-time', text: formatShortDateTime(record.time) });
            row.createSpan({ cls: 'atoz-daynight-muted', text: t(record.type === 'sleep' ? 'daynight.sleep' : 'daynight.wake') });
            if (!isLast) return;

            // 마지막 기록만 고치거나 지울 수 있어서 기록은 항상 sleep과 wake가 번갈아 나온다.
            row.addClass('atoz-daynight-last');
            row.addEventListener('click', () => {
                this.isActionsShown = !this.isActionsShown;
                this.render();
            });
            if (!this.isActionsShown) return;
            this.addRecordAction(row, 'pencil', t('daynight.editLast'), () => {
                this.editingTime = record.time;
                this.editDraft = formatTime(record.time);
                this.render();
            });
            this.addRecordAction(row, 'x', t('daynight.deleteLast'), () => {
                this.isActionsShown = false;
                void this.plugin.daynight.deleteLast();
            });
        });
    }

    // 날짜는 그대로 두고 시각만 고친다. 앞 기록보다 뒤, 지금보다 앞이어야 순서가 유지된다.
    private renderEditor(
        section: HTMLElement,
        row: HTMLElement,
        record: DaynightRecord,
        previous: DaynightRecord | undefined,
    ): void {
        row.createSpan({ cls: 'atoz-daynight-muted', text: formatShortDate(record.time) });
        const input = row.createEl('input', { cls: 'atoz-daynight-time-input', type: 'time' });
        input.value = this.editDraft;
        row.createSpan({ cls: 'atoz-daynight-muted', text: t(record.type === 'sleep' ? 'daynight.sleep' : 'daynight.wake') });

        const getTime = (): number | null => {
            const match = /^(\d{2}):(\d{2})$/.exec(input.value);
            if (!match) return null;
            const date = new Date(record.time);
            date.setHours(Number(match[1]), Number(match[2]), 0, 0);
            return date.getTime();
        };
        const saveButton = this.addRecordAction(row, 'check', t('daynight.save'), () => {
            const time = getTime();
            if (time === null) return;
            this.editingTime = null;
            this.isActionsShown = false;
            void this.plugin.daynight.editLast(time);
        });
        this.addRecordAction(row, 'x', t('daynight.cancel'), () => {
            this.editingTime = null;
            this.render();
        });
        const message = section.createDiv({ cls: 'atoz-daynight-edit-message' });

        const validate = (): void => {
            this.editDraft = input.value;
            const time = getTime();
            let error = '';
            if (time !== null && previous && time <= previous.time) {
                error = t('daynight.editTooEarly', { time: formatShortDateTime(previous.time) });
            } else if (time !== null && time > Date.now()) {
                error = t('daynight.editFuture');
            }
            saveButton.disabled = time === null || error !== '';
            message.setText(error);
        };
        input.addEventListener('input', validate);
        validate();
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
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DAYNIGHT).forEach((leaf) => {
            if (leaf.view instanceof DaynightView) leaf.view.render();
        });
        this.plugin.dashboard.refresh('daynight');
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
