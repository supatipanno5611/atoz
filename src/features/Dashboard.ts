import { ItemView, ViewStateResult, WorkspaceLeaf, getIcon, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { isRecord, makeClickable } from '../utils';
import { BudgetPage, formatWon, type BudgetRecord, type BudgetSummary } from './Budget';
import { DAY, MEAL_SPENDING_GAP, entryTime as entryTimeOf, mealKey, formatDuration, formatShortDate, formatTime as formatClock } from './Daynight';
import { DaynightDashboardPage, daynightSummary } from './DaynightDashboard';
import { formatDayLabel, renderPageHeader } from './PageHeader';
import { MealBoardPage } from './Meal';
import { PlanPage } from './Plan';
import { TimelinePage, applyColor as applyTimelineColor, formatMatch, summarizeDay } from './Timeline';

const VIEW_TYPE_DASHBOARD = 'atoz-dashboard';
const HOUR = 60 * 60 * 1000;
// '나중에 채울 것'을 접었을 때 보이는 개수
const LATER_SHOWN = 5;
// 예전에 따로 열리던 대시보드. 남아 있는 탭은 열 때 닫는다.
const LEGACY_VIEW_TYPES = ['atoz-daynight-dashboard', 'atoz-budget-view'];

export type DashboardPageId = 'home' | 'daynight' | 'budget' | 'meal' | 'timeline' | 'plan';
// 머리말 아래 탭의 순서
const PAGES: DashboardPageId[] = ['home', 'daynight', 'meal', 'timeline', 'plan', 'budget'];
// 계획 페이지는 타임라인 파일을 읽으므로 따로 알리지 않는다.
type DashboardSource = Exclude<DashboardPageId, 'home' | 'plan'>;

function isPageId(value: unknown): value is DashboardPageId {
    return value === 'home' || value === 'daynight' || value === 'budget' || value === 'meal' || value === 'timeline' || value === 'plan';
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** 범례처럼 좁은 자리의 '7:13' 꼴 길이 */
function formatShort(ms: number): string {
    const minutes = Math.round(ms / 60000);
    return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`;
}

function dateKey(time: number): string {
    const date = new Date(time);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

interface Bullet {
    cls: string;
    label: string;
    value: string;
    // 막대 길이와 기준선 자리(0–1). null이면 그리지 않는다.
    bar: number | null;
    mark: number | null;
    foot: string;
    tone?: 'good' | 'warn';
}

// 비교 막대(bullet graph): 이름과 값, 값 막대와 기준선, 한 줄 해석
function addBullet(parent: HTMLElement, bullet: Bullet): void {
    const el = parent.createDiv({ cls: `atoz-home-bullet ${bullet.cls}` });
    el.createSpan({ cls: 'atoz-home-bullet-label', text: bullet.label });
    el.createSpan({ cls: 'atoz-home-bullet-value', text: bullet.value });
    const track = el.createDiv({ cls: 'atoz-home-bullet-track', attr: { 'aria-hidden': 'true' } });
    if (bullet.bar !== null) track.createSpan({ cls: 'atoz-home-bullet-bar' }).style.width = `${Math.min(1, bullet.bar) * 100}%`;
    if (bullet.mark !== null) track.createSpan({ cls: 'atoz-home-bullet-mark' }).style.left = `${Math.min(1, bullet.mark) * 100}%`;
    const foot = el.createDiv({ cls: 'atoz-home-bullet-foot' });
    if (bullet.tone) {
        foot.addClass(`is-${bullet.tone}`);
        setIcon(foot.createSpan({ cls: 'atoz-home-bullet-icon' }), bullet.tone === 'good' ? 'check' : 'alert-triangle');
    }
    foot.createSpan({ text: bullet.foot });
}

class DashboardView extends ItemView {
    // Obsidian은 navigation이 켜진 뷰만 탐색 기록에 남긴다. 켜 두어야 뒤로/앞으로로 페이지를 오갈 수 있다.
    navigation = true;
    private page: DashboardPageId = 'home';
    // '나중에 채울 것'을 모두 펼쳤는가. 접혀 있으면 앞의 몇 개만 보인다.
    private isLaterExpanded = false;
    // 하루 리본의 폭이 바뀌면 이름 라벨과 식사 묶음을 다시 맞춘다.
    private ribbonObserver: ResizeObserver | null = null;
    // 홈에서 보는 하루의 시작 시각. null이면 오늘이다.
    private homeDay: number | null = null;
    private tabsEl: HTMLElement;
    private homeEl: HTMLElement;
    private daynightEl: HTMLElement;
    private budgetEl: HTMLElement;
    private mealEl: HTMLElement;
    private timelineEl: HTMLElement;
    private planEl: HTMLElement;
    private daynight: DaynightDashboardPage;
    private budget: BudgetPage;
    private meal: MealBoardPage;
    private timeline: TimelinePage;
    private plan: PlanPage;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
        this.contentEl.addClass('atoz-dashboard');
        // Obsidian 머리말 제목은 페이지를 바꿔도 그대로라, 지금 페이지는 페이지 안 탭으로 보인다.
        // 바깥은 위에 붙고, 안쪽만 옆으로 스크롤한다. 다 들어가지 않으면 바깥이 오른쪽 끝을 흐린다.
        const tabsBar = this.contentEl.createDiv({ cls: 'atoz-dashboard-tabs' });
        this.tabsEl = tabsBar.createDiv({ cls: 'atoz-dashboard-tabs-scroll', attr: { role: 'tablist' } });
        // 탭은 위에 붙어 있으므로, 페이지의 머리 줄(식사보드 시각 줄)이 탭 바로 아래에 붙도록 탭 높이를 알린다.
        const observer = new ResizeObserver(() => {
            this.contentEl.setCssProps({ '--atoz-dashboard-tabs-height': `${tabsBar.offsetHeight}px` });
            tabsBar.toggleClass('is-overflowing', this.tabsEl.scrollWidth > this.tabsEl.clientWidth + 1);
        });
        observer.observe(tabsBar);
        this.register(() => observer.disconnect());
        this.homeEl = this.contentEl.createDiv({ cls: 'atoz-dashboard-home' });
        this.daynightEl = this.contentEl.createDiv();
        this.budgetEl = this.contentEl.createDiv();
        this.mealEl = this.contentEl.createDiv();
        this.timelineEl = this.contentEl.createDiv();
        this.planEl = this.contentEl.createDiv();
        this.daynight = new DaynightDashboardPage(plugin, this.daynightEl);
        this.budget = new BudgetPage(plugin, this.budgetEl);
        this.meal = new MealBoardPage(plugin, this.mealEl);
        this.timeline = new TimelinePage(plugin, this.timelineEl);
        this.plan = new PlanPage(plugin, this.planEl);
    }

    getViewType(): string { return VIEW_TYPE_DASHBOARD; }
    getIcon(): string { return 'layout-dashboard'; }

    getDisplayText(): string {
        return this.pageName(this.page);
    }

    private pageName(page: DashboardPageId): string {
        if (page === 'daynight') return t('daynight.viewName');
        if (page === 'budget') return t('budget.viewName');
        if (page === 'meal') return t('meal.viewName');
        if (page === 'timeline') return t('timeline.viewName');
        if (page === 'plan') return t('plan.viewName');
        return t('dashboard.viewName');
    }

    private renderTabs(): void {
        this.tabsEl.empty();
        for (const page of PAGES) {
            const tab = this.tabsEl.createEl('button', {
                cls: 'atoz-dashboard-tab',
                text: page === 'home' ? t('dashboard.home') : this.pageName(page),
                attr: { role: 'tab', 'aria-selected': String(page === this.page) },
            });
            tab.toggleClass('is-active', page === this.page);
            tab.addEventListener('click', () => void this.leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, state: { page } }));
        }
    }

    /** 보던 페이지와 가계부·식사보드·타임라인·계획 보기 설정은 워크스페이스에 저장해 다시 열 때 되살린다. */
    getState(): Record<string, unknown> {
        return {
            page: this.page,
            budget: this.budget.getState(),
            meal: this.meal.getState(),
            timeline: this.timeline.getState(),
            plan: this.plan.getState(),
        };
    }

    // 페이지가 바뀌면 탐색 기록에 남겨 Obsidian의 뒤로/앞으로로 오갈 수 있게 한다.
    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        let isPageChanged = false;
        if (isRecord(state)) {
            if (isPageId(state.page) && state.page !== this.page) {
                this.page = state.page;
                result.history = true;
                isPageChanged = true;
            }
            if (isRecord(state.budget)) this.budget.setState(state.budget);
            if (isRecord(state.meal)) this.meal.setState(state.meal);
            if (isRecord(state.timeline)) this.timeline.setState(state.timeline);
            if (isRecord(state.plan)) this.plan.setState(state.plan);
        }
        await super.setState(state, result);
        this.show();
        // 모바일 하단 바의 뒤로/앞으로 표시는 활성 탭이 바뀔 때만 갱신된다. 노트가 파일을 바꿀 때처럼 알려 준다.
        // 탐색 기록은 이 함수가 끝난 뒤에 쌓이므로 한 박자 늦게 보낸다.
        if (isPageChanged && this.app.workspace.getActiveViewOfType(DashboardView) === this) {
            window.setTimeout(() => this.app.workspace.trigger('active-leaf-change', this.leaf), 0);
        }
    }

    async onOpen(): Promise<void> {
        this.show();
    }

    /** 데이터가 바뀐 기능의 내용이 보이고 있을 때만 다시 그린다. 숨은 페이지는 보일 때 그린다. */
    refresh(source: DashboardSource): void {
        if (this.page === 'home') void this.renderHome();
        else if (this.page === source || (this.page === 'plan' && source === 'timeline')) this.renderPage(false);
    }

    private show(): void {
        this.renderTabs();
        this.homeEl.toggle(this.page === 'home');
        this.daynightEl.toggle(this.page === 'daynight');
        this.budgetEl.toggle(this.page === 'budget');
        this.mealEl.toggle(this.page === 'meal');
        this.timelineEl.toggle(this.page === 'timeline');
        this.planEl.toggle(this.page === 'plan');
        if (this.page === 'home') void this.renderHome();
        else this.renderPage(true);
    }

    /** isShown이면 페이지를 새로 보여 주는 것이다. 타임라인은 이때만 스크롤을 옮긴다. */
    private renderPage(isShown: boolean): void {
        if (this.page === 'daynight') this.daynight.render();
        else if (this.page === 'budget') void this.budget.refresh();
        else if (this.page === 'meal') this.meal.render();
        else if (this.page === 'timeline') this.timeline.render(isShown);
        else if (this.page === 'plan') this.plan.render();
    }

    // 홈은 '그 하루'가 먼저다: 날짜 머리말, 하루 리본, 비교 막대 셋, 메뉴를 비워 둔 식사, 그리고 기능별 한 줄.
    private async renderHome(): Promise<void> {
        const plugin = this.plugin;
        // 가계부는 파일을 읽어야 하므로 먼저 읽고 한 번에 그려 자리가 튀지 않게 한다.
        const budget = await plugin.budget.summary();
        const spending = await plugin.budget.timedRecords();
        const now = Date.now();
        const startHour = plugin.settings.timelineDayStartHour;
        const shifted = new Date(now - startHour * HOUR);
        const todayStart = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), startHour).getTime();
        const dayStart = this.homeDay ?? todayStart;

        this.homeEl.empty();
        // 다른 페이지와 같은 머리말. 하루가 언제 바뀌는지, 자정 뒤 하루 시작 전이면 남은 시간도 적는다.
        const moveTo = (start: number | null): void => {
            this.homeDay = start === todayStart ? null : start;
            void this.renderHome();
        };
        const shift = (delta: number): number => {
            const date = new Date(dayStart);
            return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, startHour).getTime();
        };
        renderPageHeader(this.homeEl, {
            label: formatDayLabel(dateKey(dayStart)),
            previousLabel: t('timeline.previousDay'),
            nextLabel: t('timeline.nextDay'),
            onMove: (delta) => moveTo(shift(delta)),
            isToday: dayStart === todayStart,
            onToday: () => moveTo(null),
        });
        let sub = t('dashboard.dayChange', { hour: pad2(startHour) });
        if (new Date(now).getHours() < startHour) sub += ` · ${t('dashboard.dayLeft', { duration: formatDuration(todayStart + DAY - now) })}`;
        this.homeEl.createDiv({ cls: 'atoz-home-sub', text: sub });

        const grid = this.homeEl.createDiv({ cls: 'atoz-dashboard-grid' });
        this.renderToday(grid, dayStart, now, budget, spending);
        this.renderLater(grid, todayStart, spending);
        this.renderPages(grid, todayStart, now, budget);
    }

    private renderToday(grid: HTMLElement, dayStart: number, now: number, budget: BudgetSummary, spending: BudgetRecord[]): void {
        const plugin = this.plugin;
        const dayEnd = dayStart + DAY;
        const card = grid.createDiv({ cls: 'atoz-dashboard-card atoz-home-today' });
        const title = card.createDiv({ cls: 'atoz-dashboard-card-title atoz-home-section-title' });
        title.createSpan({ text: t('dashboard.day') });
        title.createSpan({ cls: 'atoz-dashboard-muted', text: t('dashboard.dayHint') });
        this.renderRibbon(card, dayStart, now);

        // 비교 막대 셋: [이름 · 값] / 막대(값과 기준선) / 한 줄 해석
        const bullets = grid.createDiv({ cls: 'atoz-dashboard-card atoz-home-bullets' });
        // 지난밤 잠은 이 하루에 끝난 가장 최근 주된 잠이다. 0–10시간에 평소(7일 평균)를 기준선으로 둔다.
        const inDay = ({ to }: { to: number }): boolean => to > dayStart && to <= dayEnd;
        const { main, naps } = plugin.daynight.finishedSleeps(now);
        const lastSleep = main.filter(inDay).pop();
        const usual = plugin.daynight.usualSleep(dayStart, now);
        const slept = lastSleep ? lastSleep.to - lastSleep.from : null;
        const subs: string[] = [];
        if (slept !== null && usual !== null) {
            const diff = slept - usual;
            subs.push(t(diff < 0 ? 'dashboard.vsUsualShort' : 'dashboard.vsUsualLong', {
                usual: formatDuration(usual),
                diff: formatDuration(Math.abs(diff)),
            }));
        }
        const napTime = naps.filter(inDay).reduce((sum, { from, to }) => sum + to - from, 0);
        if (napTime > 0) subs.push(t('dashboard.napApart', { duration: formatDuration(napTime) }));
        addBullet(bullets, {
            cls: 'is-sleep',
            label: t('dashboard.lastNight'),
            value: slept === null ? '—' : formatDuration(slept),
            bar: slept === null ? null : slept / (10 * HOUR),
            mark: usual === null ? null : usual / (10 * HOUR),
            foot: subs.join(' · '),
        });

        // 계획 지킴: 지난 계획 시간 중 같은 활동으로 기록된 비율
        const summary = summarizeDay(plugin, dateKey(dayStart), now);
        addBullet(bullets, {
            cls: 'is-plan',
            label: t('dashboard.planKept'),
            value: formatMatch(summary),
            bar: summary.elapsedPlan > 0 ? summary.matched / summary.elapsedPlan : null,
            mark: null,
            foot: summary.elapsedPlan > 0
                ? t('dashboard.planOf', { plan: formatDuration(summary.elapsedPlan), matched: formatDuration(summary.matched) })
                : t('dashboard.noPlanToday'),
        });

        // 이번 달 지출: 0–예산, 기준선은 날짜만큼의 예산. 안이면 ✓, 넘으면 !로도 말한다(색만으로 말하지 않는다).
        const spent = spending
            .filter(({ kind, entry }) => kind === 'expense' && entryTimeOf(entry) >= dayStart && entryTimeOf(entry) < dayEnd)
            .reduce((sum, { entry }) => sum + entry.amount, 0);
        const date = new Date(dayStart);
        const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        const dateRatio = date.getDate() / daysInMonth;
        const todayLine = t('dashboard.todaySpentLine', { amount: formatWon(spent) });
        const hasBudget = budget.budget > 0;
        const isIn = budget.total <= budget.budget * dateRatio;
        addBullet(bullets, {
            cls: 'is-spending',
            label: t('dashboard.monthSpent'),
            value: formatWon(budget.total),
            bar: hasBudget ? budget.total / budget.budget : null,
            mark: hasBudget ? dateRatio : null,
            foot: hasBudget ? `${t(isIn ? 'dashboard.paceIn' : 'dashboard.paceOver', {
                percent: Math.round(budget.total / budget.budget * 100),
                date: Math.round(dateRatio * 100),
            })} · ${todayLine}` : todayLine,
            tone: hasBudget ? (isIn ? 'good' : 'warn') : undefined,
        });
    }

    // 하루 리본: '시간을 어디에 썼나' 하나만 말한다. 칸은 계획 / 기록(잠·활동) / 식사이고, 이름은 칸 안에 직접 적는다.
    // 지출은 그리지 않고 아래 숫자로 본다. 누르면 그날 타임라인 페이지로 간다.
    private renderRibbon(card: HTMLElement, dayStart: number, now: number): void {
        const plugin = this.plugin;
        const dayEnd = dayStart + DAY;
        const end = Math.min(now, dayEnd);
        const clip = (time: number): number => Math.min(dayEnd, Math.max(dayStart, time));
        const pct = (time: number): string => `${(clip(time) - dayStart) / DAY * 100}%`;
        const place = (el: HTMLElement, from: number, to: number): void => {
            el.style.left = pct(from);
            el.style.width = `calc(${(clip(to) - clip(from)) / DAY * 100}% - 2px)`;
        };

        const ribbon = card.createDiv({ cls: 'atoz-home-ribbon' });
        const lanes = ribbon.createDiv({ cls: 'atoz-home-lanes' });
        const lane = (label: string, cls: string): HTMLElement => {
            lanes.createSpan({ cls: 'atoz-home-lane-label', text: label });
            return lanes.createDiv({ cls: `atoz-home-lane ${cls}` });
        };

        // 계획: 그 활동 색의 옅은 칸과 테두리
        const planLane = lane(t('plan.viewName'), 'is-plan');
        const plans = plugin.timeline.plans.filter((block) => block.to > dayStart && block.from < dayEnd);
        for (const block of plans) {
            const seg = planLane.createSpan({ cls: 'atoz-home-seg' });
            applyTimelineColor(seg, plugin, block.category);
            place(seg, block.from, block.to);
        }

        // 기록: 지금까지만 바탕 띠를 깔고, 그 위에 잠·활동, 기록 없음은 빗금
        const recordLane = lane(t('dashboard.record'), 'is-record');
        if (end > dayStart) place(recordLane.createSpan({ cls: 'atoz-home-past' }), dayStart, end + 2 * 60 * 1000);
        // 이름 칸: 긴 이름이 안 들어가면 짧은 이름, 그것도 안 들어가면 비운다.
        const labeled: { el: HTMLElement; full: string; short: string; length: number }[] = [];
        const totals = new Map<string, number>();
        let sleepTotal = 0;
        let napTotal = 0;
        for (const segment of plugin.daynight.segments(now)) {
            if (segment.type === 'wake' || segment.to <= dayStart || segment.from >= dayEnd) continue;
            const seg = recordLane.createSpan({ cls: `atoz-home-seg ${segment.type === 'gap' ? 'is-gap' : 'is-sleep'}` });
            place(seg, segment.from, segment.to);
            if (segment.type === 'gap') continue;
            const length = clip(segment.to) - clip(segment.from);
            const isNap = segment.to - segment.from <= 3 * HOUR;
            if (isNap) napTotal += length;
            else sleepTotal += length;
            seg.toggleClass('is-nap', isNap);
            const name = isNap ? t('dashboard.nap') : t('dashboard.sleepShort');
            // 하루 시작 전에 잠들었으면 언제부터인지 적는다.
            const full = segment.from < dayStart ? t('dashboard.sleepFrom', { time: formatClock(segment.from) }) : name;
            labeled.push({ el: seg, full, short: name, length });
        }
        for (const block of plugin.timeline.segments(now)) {
            if (block.to <= dayStart || block.from >= dayEnd) continue;
            const seg = recordLane.createSpan({ cls: 'atoz-home-seg is-activity' });
            applyTimelineColor(seg, plugin, block.category);
            place(seg, block.from, block.to);
            const length = clip(block.to) - clip(block.from);
            totals.set(block.category, (totals.get(block.category) ?? 0) + length);
            labeled.push({ el: seg, full: block.category, short: block.category.split(' ')[0] ?? block.category, length });
        }

        const mealLane = lane(t('record.meal'), 'is-meal');
        const meals = plugin.meal.records.filter((meal) => meal.time >= dayStart && meal.time < dayEnd);

        // 축: 시계 그대로 06 · 09 … 03, 자리는 절대값
        const axis = ribbon.createDiv({ cls: 'atoz-home-axis' });
        for (const clock of [6, 9, 12, 15, 18, 21, 0, 3]) {
            const at = dayStart + ((clock - plugin.settings.timelineDayStartHour + 24) % 24) * HOUR;
            axis.createSpan({ text: pad2(clock) }).style.left = pct(at);
        }

        // 지금: 칸 전체를 지나는 선과 위의 '지금 04:42'
        let nowLine: HTMLElement | null = null;
        if (now < dayEnd) {
            nowLine = ribbon.createSpan({ cls: 'atoz-home-now' });
            nowLine.createSpan({ text: `${t('dashboard.now')} ${formatClock(now)}` });
        }

        // 폭을 알아야 하는 것: 칸 안 이름, 가까운 식사 묶기, 지금 선 자리
        const layout = (): void => {
            const width = recordLane.clientWidth;
            if (width === 0) return;
            const fits = (text: string, length: number): boolean => length / DAY * width > text.length * 11 + 12;
            for (const { el, full, short, length } of labeled) {
                el.setText(fits(full, length) ? full : fits(short, length) ? short : '');
            }
            mealLane.empty();
            let last: { x: number; el: HTMLElement; count: number } | null = null;
            for (const meal of meals) {
                const x = (meal.time - dayStart) / DAY * width;
                if (last && x - last.x < 20) {
                    last.count += 1;
                    last.el.querySelector('.atoz-home-meal-count')?.remove();
                    last.el.createSpan({ cls: 'atoz-home-meal-count', text: String(last.count) });
                    continue;
                }
                const mark = mealLane.createSpan({ cls: 'atoz-home-meal atoz-record-colored' });
                const color = plugin.meal.colorOf(meal.color);
                if (color) {
                    mark.style.setProperty('--atoz-record-light', color.light);
                    mark.style.setProperty('--atoz-record-dark', color.dark);
                }
                mark.style.left = pct(meal.time);
                setIcon(mark, getIcon(meal.icon) ? meal.icon : 'utensils');
                last = { x, el: mark, count: 1 };
            }
            if (nowLine) nowLine.style.left = `${recordLane.offsetLeft + (now - dayStart) / DAY * width}px`;
        };
        window.requestAnimationFrame(layout);
        this.ribbonObserver?.disconnect();
        this.ribbonObserver = new ResizeObserver(layout);
        this.ribbonObserver.observe(ribbon);

        // 범례가 곧 요약: 잠·낮잠과 활동별 합계, 계획은 테두리 견본
        const legend = card.createDiv({ cls: 'atoz-home-legend' });
        const key = (cls: string, label: string, value: string, category?: string): void => {
            const item = legend.createSpan();
            const swatch = item.createSpan({ cls: `atoz-home-swatch ${cls}` });
            if (category) applyTimelineColor(swatch, plugin, category);
            item.createSpan({ text: label });
            if (value) item.createEl('b', { text: value });
        };
        const sleepText = [sleepTotal > 0 ? formatShort(sleepTotal) : '', napTotal > 0 ? `${t('dashboard.nap')} ${formatShort(napTotal)}` : '']
            .filter(Boolean).join(' · ');
        if (sleepText) key('is-sleep', t('dashboard.sleepShort'), sleepText);
        const sorted = [...totals].sort((a, b) => b[1] - a[1]);
        for (const [name, length] of sorted) key('is-activity', name, formatShort(length), name);
        if (plans.length > 0) key('is-plan', t('plan.viewName'), '', plans[0]!.category);

        // 화면 낭독기는 그래프 대신 한 줄 요약을 읽는다.
        const parts = [
            sleepTotal > 0 ? `${t('dashboard.sleepShort')} ${formatDuration(sleepTotal)}` : '',
            napTotal > 0 ? `${t('dashboard.nap')} ${formatDuration(napTotal)}` : '',
            ...sorted.map(([name, length]) => `${name} ${formatDuration(length)}`),
            meals.length > 0 ? t('dashboard.mealCount', { count: meals.length }) : '',
        ].filter(Boolean);
        makeClickable(ribbon, () => void this.leaf.setViewState({
            type: VIEW_TYPE_DASHBOARD,
            state: { page: 'timeline', timeline: { date: dateKey(dayStart) } },
        }));
        ribbon.setAttr('aria-label', parts.join(', ') || t('record.empty'));
    }

    // 메뉴를 비워 둔 식사(어제와 오늘, 기록 패널이 보이는 범위)를 모은다. [쓰기 ›]는 기록 패널의 고치기를 연다(최근 메뉴 칩). 없으면 숨긴다.
    private renderLater(grid: HTMLElement, todayStart: number, spending: BudgetRecord[]): void {
        const plugin = this.plugin;
        const since = todayStart - DAY;
        const meals = plugin.meal.records.filter((meal) => meal.time >= since && !meal.food).sort((a, b) => b.time - a.time);
        if (meals.length === 0) return;

        const card = grid.createDiv({ cls: 'atoz-dashboard-card atoz-home-later' });
        const title = card.createDiv({ cls: 'atoz-dashboard-card-title atoz-home-section-title' });
        title.createSpan({ text: t('dashboard.emptyMenus') });
        title.createSpan({ cls: 'atoz-dashboard-muted', text: t('dashboard.emptyMenusCount', { count: meals.length }) });
        const list = card.createDiv({ cls: 'atoz-home-later-list' });
        // 많으면 앞의 몇 개만 보여 아래 기능 목록을 밀어내지 않게 한다.
        const shown = this.isLaterExpanded ? meals : meals.slice(0, LATER_SHOWN);
        for (const meal of shown) {
            const legend = plugin.settings.mealLegend.find((item) => item.icon === meal.icon && item.color === meal.color);
            // 식사 알약에서 금액과 함께 남긴 지출이 있으면 금액도 적는다.
            const paid = spending.find(({ kind, entry }) => kind === 'expense' && entry.category === legend?.label
                && Math.abs(entryTimeOf(entry) - meal.time) <= MEAL_SPENDING_GAP);
            const row = list.createDiv({ cls: 'atoz-home-later-row' });
            row.createSpan({ cls: 'atoz-dashboard-muted', text: `${formatShortDate(meal.time)} ${formatClock(meal.time)}` });
            const icon = row.createSpan({ cls: 'atoz-home-later-icon atoz-record-colored' });
            const color = plugin.meal.colorOf(meal.color);
            if (color) {
                icon.style.setProperty('--atoz-record-light', color.light);
                icon.style.setProperty('--atoz-record-dark', color.dark);
            }
            setIcon(icon, getIcon(meal.icon) ? meal.icon : 'utensils');
            const label = legend?.label ?? t('meal.viewName');
            row.createSpan({ cls: 'atoz-home-later-label', text: paid ? `${label} · ${formatWon(paid.entry.amount)}` : label });
            const write = row.createEl('button', { cls: 'atoz-home-later-write', text: t('dashboard.writeMenu') });
            write.addEventListener('click', () => void plugin.daynight.openEditor(mealKey(meal), meal.time));
        }
        if (meals.length > LATER_SHOWN) {
            const more = card.createEl('button', {
                cls: 'atoz-home-later-more',
                text: this.isLaterExpanded ? t('dashboard.laterLess') : t('dashboard.laterMore', { count: meals.length - LATER_SHOWN }),
                attr: { 'aria-expanded': String(this.isLaterExpanded) },
            });
            more.addEventListener('click', () => {
                this.isLaterExpanded = !this.isLaterExpanded;
                void this.renderHome();
            });
        }
    }

    // 기능 목록: 한 줄씩 [아이콘 이름 · 핵심 한 줄 · ›]
    private renderPages(grid: HTMLElement, dayStart: number, now: number, budget: BudgetSummary): void {
        const plugin = this.plugin;
        const list = grid.createDiv({ cls: 'atoz-dashboard-card atoz-home-pages' });

        const summary = daynightSummary(plugin);
        const usual = plugin.daynight.usualSleep(dayStart, now);
        const average = usual !== null ? formatDuration(usual) : '—';
        this.addPageRow(list, 'moon', t('daynight.viewName'), 'daynight', summary.regularity === null
            ? t('dashboard.sleepRowNoScore', { average })
            : t('dashboard.sleepRow', { average, score: summary.regularity }));

        const meals = plugin.meal.records.filter((meal) => meal.time >= dayStart && meal.time <= now);
        const lastMeal = meals[meals.length - 1];
        this.addPageRow(list, 'utensils', t('meal.viewName'), 'meal', lastMeal
            ? t('dashboard.mealRow', { count: meals.length, since: formatDuration(now - lastMeal.time) })
            : t('dashboard.noMeal'));

        const current = plugin.timeline.current();
        this.addPageRow(list, 'calendar-clock', t('timeline.viewName'), 'timeline', current
            ? t('dashboard.activityRow', { activity: current.category, elapsed: formatDuration(now - current.time) })
            : t('record.idle'));

        const next = plugin.timeline.plans.find((block) => block.to > now);
        this.addPageRow(list, 'list-todo', t('plan.viewName'), 'plan', !next ? t('dashboard.noPlan')
            : next.from <= now ? t('dashboard.nowPlanRow', { plan: next.category, time: formatClock(next.to) })
                : t('dashboard.nextPlanRow', { plan: next.category, time: `${formatShortDate(next.from)} ${formatClock(next.from)}` }));

        const month = new Date(now).getMonth() + 1;
        this.addPageRow(list, 'wallet', t('budget.viewName'), 'budget', budget.budget > 0
            ? t('dashboard.budgetRow', { month, amount: formatWon(budget.total), percent: Math.round(budget.total / budget.budget * 100) })
            : t('dashboard.budgetRowNoLimit', { month, amount: formatWon(budget.total) }));
    }

    // 두 줄: 이름(굵게) / 아래 요약. 잘리지 않게 줄을 바꾼다.
    private addPageRow(list: HTMLElement, icon: string, title: string, page: DashboardPageId, line: string): void {
        const row = list.createDiv({ cls: 'atoz-home-page' });
        setIcon(row.createSpan({ cls: 'atoz-home-page-icon' }), icon);
        const text = row.createDiv({ cls: 'atoz-home-page-text' });
        text.createDiv({ cls: 'atoz-home-page-name', text: title });
        text.createDiv({ cls: 'atoz-home-page-line', text: line });
        setIcon(row.createSpan({ cls: 'atoz-home-page-icon' }), 'chevron-right');
        makeClickable(row, () => void this.leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, state: { page } }));
    }
}

export class DashboardFeature {
    constructor(private plugin: ATOZPlugin) {}

    install(): void {
        this.plugin.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this.plugin));
        this.plugin.addRibbonIcon('layout-dashboard', t('ribbon.openDashboard'), () => void this.open('home'));
        this.plugin.addCommand({
            id: 'open-dashboard',
            name: t('command.openDashboard'),
            callback: () => void this.open('home'),
        });
        this.plugin.app.workspace.onLayoutReady(() => {
            for (const type of LEGACY_VIEW_TYPES) this.plugin.app.workspace.detachLeavesOfType(type);
        });
    }

    /** 이미 열려 있으면 그 탭에서 페이지를 옮기고, 없으면 메인 영역에 새 탭으로 연다. */
    async open(page: DashboardPageId): Promise<void> {
        const workspace = this.plugin.app.workspace;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
        const leaf = existing ?? workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true, state: { page } });
        await workspace.revealLeaf(leaf);
    }

    refresh(source: DashboardSource): void {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
            if (leaf.view instanceof DashboardView) leaf.view.refresh(source);
        }
    }
}
