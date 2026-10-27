import { ItemView, ViewStateResult, WorkspaceLeaf, setIcon } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';
import { isRecord } from '../utils';
import { BudgetPage, formatWon } from './Budget';
import { formatDuration, formatShortDate } from './Daynight';
import { DaynightDashboardPage, daynightSummary } from './DaynightDashboard';
import { MealBoardPage, createMealMarker } from './Meal';
import { TimelinePage, formatMatch, summarizeDay, timelineToday } from './Timeline';

const VIEW_TYPE_DASHBOARD = 'atoz-dashboard';
// 예전에 따로 열리던 대시보드. 남아 있는 탭은 열 때 닫는다.
const LEGACY_VIEW_TYPES = ['atoz-daynight-dashboard', 'atoz-budget-view'];

export type DashboardPageId = 'home' | 'daynight' | 'budget' | 'meal' | 'timeline';
type DashboardSource = Exclude<DashboardPageId, 'home'>;

function isPageId(value: unknown): value is DashboardPageId {
    return value === 'home' || value === 'daynight' || value === 'budget' || value === 'meal' || value === 'timeline';
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
    private homeEl: HTMLElement;
    private daynightEl: HTMLElement;
    private budgetEl: HTMLElement;
    private mealEl: HTMLElement;
    private timelineEl: HTMLElement;
    private daynight: DaynightDashboardPage;
    private budget: BudgetPage;
    private meal: MealBoardPage;
    private timeline: TimelinePage;

    constructor(leaf: WorkspaceLeaf, private plugin: ATOZPlugin) {
        super(leaf);
        this.contentEl.addClass('atoz-dashboard');
        this.homeEl = this.contentEl.createDiv({ cls: 'atoz-dashboard-home' });
        this.daynightEl = this.contentEl.createDiv();
        this.budgetEl = this.contentEl.createDiv();
        this.mealEl = this.contentEl.createDiv();
        this.timelineEl = this.contentEl.createDiv();
        this.daynight = new DaynightDashboardPage(plugin, this.daynightEl);
        this.budget = new BudgetPage(plugin, this.budgetEl);
        this.meal = new MealBoardPage(plugin, this.mealEl);
        this.timeline = new TimelinePage(plugin, this.timelineEl);
    }

    getViewType(): string { return VIEW_TYPE_DASHBOARD; }
    getIcon(): string { return 'layout-dashboard'; }

    getDisplayText(): string {
        if (this.page === 'daynight') return t('daynight.viewName');
        if (this.page === 'budget') return t('budget.viewName');
        if (this.page === 'meal') return t('meal.viewName');
        if (this.page === 'timeline') return t('timeline.viewName');
        return t('dashboard.viewName');
    }

    /** 보던 페이지와 가계부·식사보드·타임라인 보기 설정은 워크스페이스에 저장해 다시 열 때 되살린다. */
    getState(): Record<string, unknown> {
        return { page: this.page, budget: this.budget.getState(), meal: this.meal.getState(), timeline: this.timeline.getState() };
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
        else if (this.page === source) this.renderPage(false);
    }

    private show(): void {
        this.homeEl.toggle(this.page === 'home');
        this.daynightEl.toggle(this.page === 'daynight');
        this.budgetEl.toggle(this.page === 'budget');
        this.mealEl.toggle(this.page === 'meal');
        this.timelineEl.toggle(this.page === 'timeline');
        if (this.page === 'home') void this.renderHome();
        else this.renderPage(true);
    }

    /** isShown이면 페이지를 새로 보여 주는 것이다. 타임라인은 이때만 스크롤을 옮긴다. */
    private renderPage(isShown: boolean): void {
        if (this.page === 'daynight') this.daynight.render();
        else if (this.page === 'budget') void this.budget.refresh();
        else if (this.page === 'meal') this.meal.render();
        else if (this.page === 'timeline') this.timeline.render(isShown);
    }

    private async renderHome(): Promise<void> {
        this.homeEl.empty();
        const grid = this.homeEl.createDiv({ cls: 'atoz-dashboard-grid' });

        const daynight = this.addCard(grid, 'moon', t('daynight.viewName'), 'daynight');
        const summary = daynightSummary(this.plugin);
        addStat(
            daynight,
            t('dashboard.lastSleep'),
            summary.lastSleep ? formatDuration(summary.lastSleep.to - summary.lastSleep.from) : '—',
            summary.lastSleep ? t('dashboard.wokeAt', { date: formatShortDate(summary.lastSleep.to) }) : undefined,
        );
        addStat(
            daynight,
            t('dashboard.regularity', { range: summary.days === 0 ? t('daynight.dashboard.all') : t('daynight.dashboard.days', { days: summary.days }) }),
            summary.regularity === null ? '—' : String(summary.regularity),
        );

        // 가계부는 파일을 읽어야 하므로 카드 자리만 먼저 잡아 순서를 지킨다.
        const budget = this.addCard(grid, 'wallet', t('budget.viewName'), 'budget');

        const meal = this.addCard(grid, 'utensils', t('meal.viewName'), 'meal');
        const latestMeal = this.plugin.meal.latest();
        const mealStat = meal.createDiv({ cls: 'atoz-dashboard-stat' });
        mealStat.createDiv({ cls: 'atoz-dashboard-muted', text: t('dashboard.latestMeal') });
        const mealValue = mealStat.createDiv({ cls: 'atoz-dashboard-value atoz-dashboard-meal' });
        if (latestMeal) {
            createMealMarker(mealValue, this.plugin, latestMeal.food ? latestMeal : { icon: 'circle-help', color: latestMeal.color });
            mealValue.createSpan({ text: latestMeal.food || t('meal.unknownFood') });
        } else {
            mealValue.setText('—');
        }
        addStat(meal, t('dashboard.sinceMeal'), latestMeal ? formatDuration(Date.now() - latestMeal.time) : '—');

        const timeline = this.addCard(grid, 'calendar-clock', t('timeline.viewName'), 'timeline');
        const current = this.plugin.timeline.current();
        addStat(
            timeline,
            t('dashboard.currentActivity'),
            current?.category ?? '—',
            current ? formatDuration(Date.now() - current.time) : undefined,
        );
        const today = summarizeDay(this.plugin, timelineToday(this.plugin), Date.now());
        addStat(
            timeline,
            t('dashboard.todayMatch'),
            formatMatch(today),
            today.elapsedPlan > 0 ? t('dashboard.ofPlan', { plan: formatDuration(today.elapsedPlan) }) : undefined,
        );

        const { total, latest } = await this.plugin.budget.summary();
        addStat(budget, t('dashboard.monthExpense'), formatWon(total));
        addStat(
            budget,
            t('dashboard.latestExpense'),
            latest ? formatWon(latest.amount) : '—',
            latest ? `${latest.date} · ${latest.title}` : undefined,
        );
    }

    private addCard(grid: HTMLElement, icon: string, title: string, page: DashboardPageId): HTMLElement {
        const card = grid.createDiv({ cls: 'atoz-dashboard-card' });
        const header = card.createDiv({ cls: 'atoz-dashboard-card-title' });
        setIcon(header.createSpan(), icon);
        header.createSpan({ text: title });
        card.addEventListener('click', () => void this.leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, state: { page } }));
        return card.createDiv({ cls: 'atoz-dashboard-card-body' });
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
