import { Menu, setIcon } from 'obsidian';
import { isKorean, t } from '../locales';

export interface PageHeaderMenuItem {
    title: string;
    icon: string;
    onClick: () => void;
}

interface PageHeaderOptions {
    // 기간 글자. renderLabel이 있으면 그것으로 대신 그린다(가계부의 달 고르기 등).
    label: string;
    renderLabel?: (parent: HTMLElement) => void;
    previousLabel: string;
    nextLabel: string;
    onMove: (delta: -1 | 1) => void;
    // 지금 보는 기간에 오늘이 들어 있으면 [오늘]을 끈다.
    isToday: boolean;
    onToday: () => void;
    // 페이지만의 일. 비어 있으면 ⋯를 두지 않는다.
    menu?: PageHeaderMenuItem[];
}

const LOCALE = isKorean ? 'ko-KR' : 'en-US';

/** 'YYYY-MM-DD'를 '10월 29일 (목)'처럼 */
export function formatDayLabel(key: string): string {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year!, month! - 1, day).toLocaleDateString(LOCALE, { month: 'long', day: 'numeric', weekday: 'short' });
}

/** 'YYYY-MM'을 '2026년 10월'처럼 */
export function formatMonthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    return new Date(year!, month! - 1, 1).toLocaleDateString(LOCALE, { year: 'numeric', month: 'long' });
}

/** 대시보드 페이지 공통 머리말: ‹ 기간 › [오늘] … [⋯] */
export function renderPageHeader(container: HTMLElement, options: PageHeaderOptions): HTMLElement {
    const header = container.createDiv({ cls: 'atoz-page-header' });
    const iconButton = (icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement => {
        const button = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
        setIcon(button, icon);
        button.addEventListener('click', onClick);
        return button;
    };
    iconButton('chevron-left', options.previousLabel, () => options.onMove(-1));
    if (options.renderLabel) options.renderLabel(header);
    else header.createSpan({ cls: 'atoz-page-header-label', text: options.label });
    iconButton('chevron-right', options.nextLabel, () => options.onMove(1));
    const today = header.createEl('button', { cls: 'atoz-page-header-today', text: t('header.today') });
    today.disabled = options.isToday;
    today.addEventListener('click', options.onToday);
    header.createDiv({ cls: 'atoz-page-header-spacer' });
    const menu = options.menu ?? [];
    if (menu.length > 0) {
        iconButton('more-horizontal', t('header.more'), (event) => {
            const popup = new Menu();
            for (const item of menu) popup.addItem((entry) => entry.setTitle(item.title).setIcon(item.icon).onClick(item.onClick));
            popup.showAtMouseEvent(event);
        });
    }
    return header;
}
