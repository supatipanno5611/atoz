import { ItemView, ViewStateResult, WorkspaceLeaf, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { isKorean, t } from '../locales';
import { isRecord, makeClickable } from '../utils';
import { BudgetPage, formatWon, type BudgetRecord, type BudgetSummary } from './Budget';
import { DAY, MEAL_SPENDING_GAP, entryTime as entryTimeOf, formatDuration, formatShortDate, formatTime as formatClock } from './Daynight';
import { DaynightDashboardPage, daynightSummary } from './DaynightDashboard';
import { MealBoardPage } from './Meal';
import { PlanPage } from './Plan';
import { TimelinePage, applyColor as applyTimelineColor, formatMatch, summarizeDay, timelineToday } from './Timeline';

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

function addStat(parent: HTMLElement, label: string, value: string, sub?: string): void {
    const stat = parent.createDiv({ cls: 'atoz-dashboard-stat' });
    stat.createDiv({ cls: 'atoz-dashboard-muted', text: label });
    stat.createDiv({ cls: 'atoz-dashboard-value', text: value });
    if (sub) stat.createDiv({ cls: 'atoz-dashboard-muted', text: sub });
}

class DashboardView extends ItemView {
    // Obsidian은 navigation이 켜진 뷰만 탐색 기록에 남긴다. 켜 두어야 뒤로/앞으로로 페이지를 오갈 수 있다.
    navigation = true;
    private page: DashboardPageId = 'home';
    // '나중에 채울 것'을 모두 펼쳤는가. 접혀 있으면 앞의 몇 개만 보인다.
    private isLaterExpanded = false;
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
        this.tabsEl = this.contentEl.createDiv({ cls: 'atoz-dashboard-tabs', attr: { role: 'tablist' } });
        // 탭은 위에 붙어 있으므로, 페이지의 머리 줄(식사보드 시각 줄)이 탭 바로 아래에 붙도록 탭 높이를 알린다.
        const observer = new ResizeObserver(() => {
            this.contentEl.setCssProps({ '--atoz-dashboard-tabs-height': `${this.tabsEl.offsetHeight}px` });
        });
        observer.observe(this.tabsEl);
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

    // 홈은 '오늘'이 먼저다: 오늘 하루 띠와 비교가 붙은 숫자, 나중에 채울 것, 그리고 기능별 한 줄.
    private async renderHome(): Promise<void> {
        const plugin = this.plugin;
        // 가계부는 파일을 읽어야 하므로 먼저 읽고 한 번에 그려 자리가 튀지 않게 한다.
        const budget = await plugin.budget.summary();
        const spending = await plugin.budget.timedRecords();
        const now = Date.now();
        const startHour = plugin.settings.timelineDayStartHour;
        const shifted = new Date(now - startHour * HOUR);
        const dayStart = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), startHour).getTime();

        this.homeEl.empty();
        const grid = this.homeEl.createDiv({ cls: 'atoz-dashboard-grid' });
        this.renderToday(grid, dayStart, now, budget, spending);
        this.renderLater(grid, now, spending);
        this.renderPages(grid, dayStart, now, budget);
    }

    private renderToday(grid: HTMLElement, dayStart: number, now: number, budget: BudgetSummary, spending: BudgetRecord[]): void {
        const plugin = this.plugin;
        const dayEnd = dayStart + DAY;
        const card = grid.createDiv({ cls: 'atoz-dashboard-card atoz-home-today' });
        card.createDiv({
            cls: 'atoz-dashboard-card-title',
            text: t('dashboard.today', { date: new Date(dayStart).toLocaleDateString(isKorean ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', weekday: 'short' }) }),
        });

        // 하루 시작 시각부터 24시간: 잠, 활동, 식사(점), 지출(눈금), 지금 선
        const band = card.createDiv({ cls: 'atoz-home-band', attr: { 'aria-hidden': 'true' } });
        const place = (el: HTMLElement, from: number, to: number): void => {
            const left = Math.max(0, (from - dayStart) / DAY);
            const right = Math.min(1, (to - dayStart) / DAY);
            el.style.left = `${left * 100}%`;
            el.style.width = `${Math.max(0, right - left) * 100}%`;
        };
        const segments = plugin.daynight.segments(now);
        for (const segment of segments) {
            if (segment.type !== 'sleep' || segment.to <= dayStart || segment.from >= dayEnd) continue;
            place(band.createSpan({ cls: 'atoz-home-sleep' }), segment.from, segment.to);
        }
        for (const block of plugin.timeline.segments(now)) {
            if (block.to <= dayStart || block.from >= dayEnd) continue;
            const bar = band.createSpan({ cls: 'atoz-home-activity' });
            applyTimelineColor(bar, plugin, block.category);
            place(bar, block.from, block.to);
        }
        const meals = plugin.meal.records.filter((meal) => meal.time >= dayStart && meal.time < dayEnd);
        for (const meal of meals) place(band.createSpan({ cls: 'atoz-home-meal' }), meal.time, meal.time);
        const todaySpending = spending.filter(({ kind, entry }) => kind === 'expense' && entryTimeOf(entry) >= dayStart && entryTimeOf(entry) < dayEnd);
        for (const { entry } of todaySpending) place(band.createSpan({ cls: 'atoz-home-spend' }), entryTimeOf(entry), entryTimeOf(entry));
        if (now < dayEnd) place(band.createSpan({ cls: 'atoz-home-now' }), now, now);
        const axis = card.createDiv({ cls: 'atoz-home-axis' });
        for (let hour = 0; hour <= 24; hour += 6) axis.createSpan({ text: String((plugin.settings.timelineDayStartHour + hour) % 24) });
        // 띠의 모양마다 뜻을 적는다.
        const legend = card.createDiv({ cls: 'atoz-home-legend', attr: { 'aria-hidden': 'true' } });
        for (const [cls, label] of [
            ['atoz-home-sleep', t('dashboard.sleep')],
            ['atoz-home-activity', t('record.activity')],
            ['atoz-home-meal', t('record.meal')],
            ['atoz-home-spend', t('record.spending')],
            ['atoz-home-now', t('dashboard.now')],
        ] as const) {
            const item = legend.createSpan();
            item.createSpan({ cls });
            item.createSpan({ text: label });
        }

        // 숫자 셋. 숫자마다 비교를 붙인다.
        const stats = card.createDiv({ cls: 'atoz-dashboard-card-body atoz-home-stats' });
        // 지난밤 잠은 이 하루에 끝난 가장 최근 주된 잠이다. 낮잠은 따로 적는다.
        const inDay = ({ to }: { to: number }): boolean => to > dayStart && to <= dayEnd;
        const { main, naps } = plugin.daynight.finishedSleeps(now);
        const lastSleep = main.filter(inDay).pop();
        const usual = plugin.daynight.usualSleep(dayStart, now);
        const subs: string[] = [];
        if (lastSleep && usual !== null) {
            const diff = (lastSleep.to - lastSleep.from) - usual;
            subs.push(t(diff < 0 ? 'dashboard.vsUsualShort' : 'dashboard.vsUsualLong', {
                usual: formatDuration(usual),
                diff: formatDuration(Math.abs(diff)),
            }));
        }
        const napTime = naps.filter(inDay).reduce((sum, { from, to }) => sum + to - from, 0);
        if (napTime > 0) subs.push(t('dashboard.napApart', { duration: formatDuration(napTime) }));
        addStat(stats, t('dashboard.lastNight'), lastSleep ? formatDuration(lastSleep.to - lastSleep.from) : '—', subs.join(' · ') || undefined);

        const today = summarizeDay(plugin, timelineToday(plugin), now);
        addStat(
            stats,
            t('dashboard.todayMatch'),
            formatMatch(today),
            today.elapsedPlan > 0 ? t('dashboard.ofPlan', { plan: formatDuration(today.elapsedPlan) }) : undefined,
        );

        // 이번 달 지출을 예산과 날짜만큼 지난 비율로 같은 범위끼리 비교한다. 오늘 지출은 보조 줄이다.
        const spent = todaySpending.reduce((sum, { entry }) => sum + entry.amount, 0);
        const date = new Date(dayStart);
        const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        const todayLine = t('dashboard.todaySpentLine', { amount: formatWon(spent) });
        addStat(
            stats,
            t('dashboard.monthSpent'),
            formatWon(budget.total),
            budget.budget > 0 ? `${t('dashboard.budgetPace', {
                percent: Math.round(budget.total / budget.budget * 100),
                date: Math.round(date.getDate() / daysInMonth * 100),
            })} · ${todayLine}` : todayLine,
        );
    }

    // 메뉴가 빈 식사와 항목이 빈 지출(최근 7일)을 모아 그 자리에서 채운다. 없으면 카드를 숨긴다.
    private renderLater(grid: HTMLElement, now: number, spending: BudgetRecord[]): void {
        const plugin = this.plugin;
        const since = now - 7 * DAY;
        const items: { time: number; label: string; missing: string; save: (value: string) => Promise<unknown> }[] = [];
        for (const meal of plugin.meal.records) {
            if (meal.time < since || meal.food) continue;
            const legend = plugin.settings.mealLegend.find((item) => item.icon === meal.icon && item.color === meal.color);
            items.push({
                time: meal.time,
                label: legend?.label ?? t('meal.viewName'),
                missing: t('dashboard.noMenu'),
                save: (value) => plugin.meal.replace(meal, meal.time, value),
            });
        }
        // 식사 알약에서 함께 남긴 지출은 그 끼니의 돈이라 항목을 따로 묻지 않는다.
        const isMealSpending = (time: number, category: string): boolean => plugin.meal.records.some((meal) =>
            Math.abs(meal.time - time) <= MEAL_SPENDING_GAP
            && plugin.settings.mealLegend.some((item) => item.label === category && item.icon === meal.icon && item.color === meal.color));
        for (const record of spending) {
            const { entry } = record;
            if (record.kind !== 'expense' || entry.title || entryTimeOf(entry) < since) continue;
            if (isMealSpending(entryTimeOf(entry), entry.category)) continue;
            items.push({
                time: entryTimeOf(entry),
                label: `${entry.category || t('budget.uncategorized')} ${formatWon(entry.amount)}`,
                missing: t('dashboard.noTitle'),
                save: (value) => plugin.budget.editRecord(record, entry.time, value),
            });
        }
        if (items.length === 0) return;
        items.sort((a, b) => b.time - a.time);

        const card = grid.createDiv({ cls: 'atoz-dashboard-card atoz-home-later' });
        const title = card.createDiv({ cls: 'atoz-dashboard-card-title' });
        title.createSpan({ text: t('dashboard.later') });
        title.createSpan({ cls: 'atoz-home-badge', text: String(items.length) });
        const list = card.createDiv({ cls: 'atoz-home-later-list' });
        // 많으면 앞의 몇 개만 보여 아래 기능 목록을 밀어내지 않게 한다.
        const shown = this.isLaterExpanded ? items : items.slice(0, LATER_SHOWN);
        for (const item of shown) {
            const row = list.createDiv({ cls: 'atoz-home-later-row' });
            row.createSpan({ cls: 'atoz-dashboard-muted', text: `${formatShortDate(item.time)} ${formatClock(item.time)}` });
            row.createSpan({ cls: 'atoz-home-later-label', text: item.label });
            // 패널 편집과 같은 입력. Enter나 칸 밖으로 나가면 저장하고, 채우면 목록에서 빠진다.
            const input = row.createEl('input', { type: 'text', cls: 'atoz-record-note-input', attr: { placeholder: item.missing, 'aria-label': item.missing } });
            const save = (): void => {
                const value = input.value.trim();
                if (value) void item.save(value);
            };
            input.addEventListener('keydown', (event) => {
                if (event.isComposing || event.key !== 'Enter') return;
                event.preventDefault();
                input.blur();
            });
            input.addEventListener('blur', save);
        }
        if (items.length > LATER_SHOWN) {
            const more = card.createEl('button', {
                cls: 'atoz-home-later-more',
                text: this.isLaterExpanded ? t('dashboard.laterLess') : t('dashboard.laterMore', { count: items.length - LATER_SHOWN }),
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

    private addPageRow(list: HTMLElement, icon: string, title: string, page: DashboardPageId, line: string): void {
        const row = list.createDiv({ cls: 'atoz-home-page' });
        setIcon(row.createSpan({ cls: 'atoz-home-page-icon' }), icon);
        row.createSpan({ cls: 'atoz-home-page-name', text: title });
        row.createSpan({ cls: 'atoz-home-page-line', text: line });
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
