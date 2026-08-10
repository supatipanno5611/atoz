import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type ATOZPlugin from './main';
import { DEFAULT_SETTINGS, SymbolItem } from './types';

export class ATOZSettingTab extends PluginSettingTab {
    plugin: ATOZPlugin;

    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {}

    getSettingDefinitions() {
        return [
            {
                type: 'group' as const,
                heading: '커서 중앙 고정',
                items: [
                    {
                        name: '커서 중앙 고정 사용',
                        desc: '편집할 때 커서가 화면 중앙 근처에 유지됩니다.',
                        control: { type: 'toggle' as const, key: 'isCursorCenterEnabled' },
                    },
                ],
            },
            {
            	type: 'group' as const,
            	heading: '모바일',
            	items: [
            		{
            			name: '사이드바 독립 리본 사용',
            			desc: '왼쪽 사이드바가 닫혔을 때 리본 메뉴를 화면 좌측에 고정합니다. (모바일/태블릿 전용)',
            			control: { type: 'toggle' as const, key: 'isMobileStickyRibbonEnabled' },
            		},
            	],
            },
            {
                type: 'group' as const,
                heading: '조각글',
                items: [
                    {
                        name: '조각글 트리거 문자',
                        desc: '이 문자를 입력하면 조각글 추천이 열립니다.',
                        render: (setting: Setting) => {
                            setting.addText((t) => {
                                t.setPlaceholder('@').setValue(this.plugin.settings.snippetTrigger);
                                t.inputEl.addEventListener('blur', async () => {
                                    const trigger = t.getValue().trim();
                                    if (!trigger) {
                                        new Notice('조각글 트리거 문자는 비워둘 수 없어 기본값을 사용합니다.');
                                        t.setValue(DEFAULT_SETTINGS.snippetTrigger);
                                        this.plugin.settings.snippetTrigger = DEFAULT_SETTINGS.snippetTrigger;
                                    } else {
                                        this.plugin.settings.snippetTrigger = trigger;
                                    }
                                    await this.plugin.saveSettings();
                                });
                            });
                        },
                    },
                    {
                        name: '조각글 표시 개수',
                        desc: '보여줄 조각글 추천의 최대 개수입니다.',
                        control: { type: 'number' as const, key: 'snippetLimit', min: 0 },
                    },
                    {
                        name: '조각글 목록',
                        desc: '한 줄에 하나씩 입력합니다.',
                        render: (setting: Setting) => {
                            setting.settingEl.addClass('atoz-setting-vertical');
                            setting.addTextArea((ta) => {
                                ta.inputEl.addClass('atoz-setting-textarea');
                                ta.setValue(this.plugin.settings.snippets.join('\n'));
                                ta.inputEl.addEventListener('blur', async () => {
                                    this.plugin.settings.snippets = ta.getValue()
                                        .split('\n')
                                        .filter((line) => line.length > 0);
                                    await this.plugin.saveSettings();
                                });
                            });
                        },
                    },
                ],
            },
            {
                type: 'group' as const,
                heading: '기호',
                items: [
                    {
                        name: '기호 트리거 문자',
                        desc: '이 문자를 입력하면 기호 추천이 열립니다.',
                        render: (setting: Setting) => {
                            setting.addText((t) => {
                                t.setPlaceholder('~').setValue(this.plugin.settings.symbolTrigger);
                                t.inputEl.addEventListener('blur', async () => {
                                    const trigger = t.getValue().trim();
                                    if (!trigger) {
                                        new Notice('기호 트리거 문자는 비워둘 수 없어 기본값을 사용합니다.');
                                        t.setValue(DEFAULT_SETTINGS.symbolTrigger);
                                        this.plugin.settings.symbolTrigger = DEFAULT_SETTINGS.symbolTrigger;
                                    } else {
                                        this.plugin.settings.symbolTrigger = trigger;
                                    }
                                    await this.plugin.saveSettings();
                                });
                            });
                        },
                    },
                    {
                        name: '기호 표시 개수',
                        desc: '보여줄 기호 추천의 최대 개수입니다.',
                        control: { type: 'number' as const, key: 'symbolLimit', min: 0 },
                    },
                    ...this.plugin.settings.symbols.flatMap((sym: SymbolItem, i: number) => [
                        {
                            name: `#${i + 1} id`,
                            render: (setting: Setting) => {
                                setting.addText((t) => t
                                    .setPlaceholder('id')
                                    .setValue(sym.id)
                                    .onChange((v) => {
                                        this.plugin.settings.symbols[i]!.id = v;
                                        this.plugin.debouncedSave();
                                    })
                                ).addExtraButton((btn) => btn
                                    .setIcon('lucide-trash-2')
                                    .setTooltip('삭제')
                                    .onClick(async () => {
                                        this.plugin.settings.symbols.splice(i, 1);
                                        await this.plugin.saveSettings();
                                        (this as any).update();
                                    })
                                );
                            },
                        },
                        {
                            name: `#${i + 1} 기호`,
                            render: (setting: Setting) => {
                                setting.addText((t) => t
                                    .setPlaceholder('기호')
                                    .setValue(sym.symbol)
                                    .onChange((v) => {
                                        this.plugin.settings.symbols[i]!.symbol = v;
                                        this.plugin.debouncedSave();
                                    })
                                );
                            },
                        },
                        {
                            name: `#${i + 1} 닫는 기호`,
                            render: (setting: Setting) => {
                                setting.addText((t) => t
                                    .setPlaceholder('닫는 기호 (선택)')
                                    .setValue(sym.closing ?? '')
                                    .onChange((v) => {
                                        const closing = v.trim();
                                        if (closing) {
                                            this.plugin.settings.symbols[i]!.closing = closing;
                                        } else {
                                            delete this.plugin.settings.symbols[i]!.closing;
                                        }
                                        this.plugin.debouncedSave();
                                    })
                                );
                            },
                        },
                    ]),
                    {
                        name: '',
                        render: (setting: Setting) => {
                            setting.addButton((btn) => btn
                                .setButtonText('기호 추가')
                                .onClick(async () => {
                                    this.plugin.settings.symbols.push({ id: '', symbol: '' });
                                    await this.plugin.saveSettings();
                                    (this as any).update();
                                })
                            );
                        },
                    },
                ],
            },
            {
                type: 'group' as const,
                heading: '작업 문서',
                items: [
                    {
                        name: '작업 문서 경로',
                        desc: '작업 문서 명령에서 사용할 볼트 기준 경로입니다.',
                        control: { type: 'text' as const, key: 'workFilePath', placeholder: '예: work.md' },
                    },
                ],
            },
            {
                type: 'group' as const,
                heading: 'Later',
                items: [
                    {
                        name: 'Later 노트 대상 폴더',
                        desc: '비워두면 원본별 Later 노트가 볼트 루트에 생성됩니다.',
                        control: { type: 'text' as const, key: 'moveLineTargetFolder', placeholder: '예: archive' },
                     },
                ],
            },
            {
            	type: 'group' as const,
            	heading: '명령어 슬롯',
            	items: [
            		{
            			name: '슬롯 개수',
            			desc: '명령어 슬롯 모달에 표시할 슬롯 개수입니다.',
            			control: { type: 'number' as const, key: 'commandSlotCount', min: 1 },
            		},
            	],
            },
            {
                type: 'group' as const,
                heading: '초기화',
                items: [
                    {
                        name: '모든 설정 초기화',
                        desc: '플러그인 설정을 모두 기본값으로 되돌립니다.',
                        render: (setting: Setting) => {
                            setting.addButton((btn) => btn
                                .setButtonText('초기화')
                                .setWarning()
                                .onClick(async () => {
                                    this.plugin.settings = structuredClone(DEFAULT_SETTINGS);
                                    this.plugin.folderVisibility.refresh();
                                    await this.plugin.saveSettings();
                                    new Notice('설정을 기본값으로 초기화했습니다.');
                                    (this as any).update();
                                })
                            );
                        },
                    },
                ],
            },
        ];
    }
}
