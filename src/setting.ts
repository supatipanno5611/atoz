import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type ATOZPlugin from './main';
import { DEFAULT_SETTINGS, SymbolItem } from './types';
import { t } from './locales';

export class ATOZSettingTab extends PluginSettingTab {
    plugin: ATOZPlugin;

    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions() {
        return [
            {
                type: 'group' as const,
                heading: t('settings.cursorCenter.heading'),
                items: [
                    {
                        name: t('settings.cursorCenter.name'),
                        desc: t('settings.cursorCenter.desc'),
                        control: { type: 'toggle' as const, key: 'isCursorCenterEnabled' },
                    },
                ],
            },
            {
            	type: 'group' as const,
                heading: t('settings.mobile.heading'),
            	items: [
            		{
                        name: t('settings.mobile.stickyRibbon.name'),
                        desc: t('settings.mobile.stickyRibbon.desc'),
            			control: { type: 'toggle' as const, key: 'isMobileStickyRibbonEnabled' },
            		},
            	],
            },
            {
                type: 'group' as const,
                heading: t('settings.snippets.heading'),
                items: [
                    {
                        name: t('settings.snippets.trigger.name'),
                        desc: t('settings.snippets.trigger.desc'),
                        render: (setting: Setting) => {
                            setting.addText((text) => {
                                text.setPlaceholder('@').setValue(this.plugin.settings.snippetTrigger);
                                text.inputEl.addEventListener('blur', () => {
                                    const trigger = text.getValue().trim();
                                    if (!trigger) {
                                        new Notice(t('settings.snippets.trigger.empty'));
                                        text.setValue(DEFAULT_SETTINGS.snippetTrigger);
                                        this.plugin.settings.snippetTrigger = DEFAULT_SETTINGS.snippetTrigger;
                                    } else {
                                        this.plugin.settings.snippetTrigger = trigger;
                                    }
                                    void this.plugin.saveSettings();
                                });
                            });
                        },
                    },
                    {
                        name: t('settings.snippets.limit.name'),
                        desc: t('settings.snippets.limit.desc'),
                        control: { type: 'number' as const, key: 'snippetLimit', min: 0 },
                    },
                    {
                        name: t('settings.snippets.list.name'),
                        desc: t('settings.snippets.list.desc'),
                        render: (setting: Setting) => {
                            setting.settingEl.addClass('atoz-setting-vertical');
                            setting.addTextArea((ta) => {
                                ta.inputEl.addClass('atoz-setting-textarea');
                                ta.setValue(this.plugin.settings.snippets.join('\n'));
                                ta.inputEl.addEventListener('blur', () => {
                                    this.plugin.settings.snippets = ta.getValue()
                                        .split('\n')
                                        .filter((line) => line.length > 0);
                                    void this.plugin.saveSettings();
                                });
                            });
                        },
                    },
                ],
            },
            {
                type: 'group' as const,
                heading: t('settings.symbols.heading'),
                items: [
                    {
                        name: t('settings.symbols.trigger.name'),
                        desc: t('settings.symbols.trigger.desc'),
                        render: (setting: Setting) => {
                            setting.addText((text) => {
                                text.setPlaceholder('~').setValue(this.plugin.settings.symbolTrigger);
                                text.inputEl.addEventListener('blur', () => {
                                    const trigger = text.getValue().trim();
                                    if (!trigger) {
                                        new Notice(t('settings.symbols.trigger.empty'));
                                        text.setValue(DEFAULT_SETTINGS.symbolTrigger);
                                        this.plugin.settings.symbolTrigger = DEFAULT_SETTINGS.symbolTrigger;
                                    } else {
                                        this.plugin.settings.symbolTrigger = trigger;
                                    }
                                    void this.plugin.saveSettings();
                                });
                            });
                        },
                    },
                    {
                        name: t('settings.symbols.limit.name'),
                        desc: t('settings.symbols.limit.desc'),
                        control: { type: 'number' as const, key: 'symbolLimit', min: 0 },
                    },
                    ...this.plugin.settings.symbols.flatMap((sym: SymbolItem, i: number) => [
                        {
                            name: `#${i + 1} id`,
                            render: (setting: Setting) => {
                                setting.addText((text) => text
                                    .setPlaceholder('ID')
                                    .setValue(sym.id)
                                    .onChange((v) => {
                                        this.plugin.settings.symbols[i]!.id = v;
                                        this.plugin.debouncedSave();
                                    })
                                ).addExtraButton((btn) => btn
                                    .setIcon('lucide-trash-2')
                                    .setTooltip(t('settings.symbols.delete'))
                                    .onClick(async () => {
                                        this.plugin.settings.symbols.splice(i, 1);
                                        await this.plugin.saveSettings();
                                        this.refreshSettings();
                                    })
                                );
                            },
                        },
                        {
                            name: t('settings.symbols.item', { index: i + 1 }),
                            render: (setting: Setting) => {
                                setting.addText((text) => text
                                    .setPlaceholder(t('settings.symbols.placeholder'))
                                    .setValue(sym.symbol)
                                    .onChange((v) => {
                                        this.plugin.settings.symbols[i]!.symbol = v;
                                        this.plugin.debouncedSave();
                                    })
                                );
                            },
                        },
                        {
                            name: t('settings.symbols.closingItem', { index: i + 1 }),
                            render: (setting: Setting) => {
                                setting.addText((text) => text
                                    .setPlaceholder(t('settings.symbols.closingPlaceholder'))
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
                                .setButtonText(t('settings.symbols.add'))
                                .onClick(async () => {
                                    this.plugin.settings.symbols.push({ id: '', symbol: '' });
                                    await this.plugin.saveSettings();
                                    this.refreshSettings();
                                })
                            );
                        },
                    },
                ],
            },
            {
                type: 'group' as const,
                heading: t('settings.info.heading'),
                items: [
                    {
                        name: t('settings.info.basis.name'),
                        desc: t('settings.info.basis.desc'),
                        render: (setting: Setting) => {
                            setting.addDropdown((dropdown) => dropdown
                                .addOption('without-spaces', t('settings.info.withoutSpaces'))
                                .addOption('with-spaces', t('settings.info.withSpaces'))
                                .setValue(this.plugin.settings.readingTimeCharacterBasis)
                                .onChange(async (value) => {
                                    this.plugin.settings.readingTimeCharacterBasis = value === 'with-spaces'
                                        ? 'with-spaces'
                                        : 'without-spaces';
                                    await this.plugin.saveSettings();
                                    this.plugin.info.settingsChanged();
                                })
                            );
                        },
                    },
                    {
                        name: t('settings.info.charactersPerMinute.name'),
                        desc: t('settings.info.charactersPerMinute.desc'),
                        render: (setting: Setting) => {
                            setting.addText((text) => {
                                text.inputEl.type = 'number';
                                text.inputEl.min = '1';
                                text.setValue(this.plugin.settings.readingCharactersPerMinute.toString());
                                text.inputEl.addEventListener('blur', () => {
                                    const value = Number(text.getValue());
                                    if (!Number.isInteger(value) || value < 1) {
                                        new Notice(t('settings.info.charactersPerMinute.invalid'));
                                        text.setValue(this.plugin.settings.readingCharactersPerMinute.toString());
                                        return;
                                    }
                                    this.plugin.settings.readingCharactersPerMinute = value;
                                    void this.plugin.saveSettings();
                                    this.plugin.info.settingsChanged();
                                });
                            });
                        },
                    },
                    ...this.plugin.settings.writingTargetPresets.map((preset, i) => ({
                        name: t('settings.info.targetPreset.name', { index: i + 1 }),
                        desc: t('settings.info.targetPreset.desc'),
                        render: (setting: Setting) => {
                            setting.addText((text) => {
                                text.inputEl.type = 'number';
                                text.inputEl.min = '1';
                                text.setPlaceholder(t('settings.info.targetPlaceholder'));
                                text.setValue(preset.target.toString());
                                text.inputEl.addEventListener('blur', () => {
                                    const target = Number(text.getValue());
                                    const duplicate = this.plugin.settings.writingTargetPresets
                                        .some((item, index) => index !== i && item.target === target);
                                    if (!Number.isInteger(target) || target < 1 || target <= preset.tolerance || duplicate) {
                                        new Notice(t('settings.info.targetInvalid'));
                                        text.setValue(preset.target.toString());
                                        return;
                                    }
                                    preset.target = target;
                                    void this.plugin.saveSettings();
                                });
                            }).addText((text) => {
                                text.inputEl.type = 'number';
                                text.inputEl.min = '1';
                                text.setPlaceholder(t('settings.info.tolerancePlaceholder'));
                                text.setValue(preset.tolerance.toString());
                                text.inputEl.addEventListener('blur', () => {
                                    const tolerance = Number(text.getValue());
                                    if (!Number.isInteger(tolerance) || tolerance < 1 || tolerance >= preset.target) {
                                        new Notice(t('settings.info.toleranceInvalid'));
                                        text.setValue(preset.tolerance.toString());
                                        return;
                                    }
                                    preset.tolerance = tolerance;
                                    void this.plugin.saveSettings();
                                });
                            }).addExtraButton((button) => button
                                .setIcon('lucide-trash-2')
                                .setTooltip(t('settings.symbols.delete'))
                                .onClick(async () => {
                                    this.plugin.settings.writingTargetPresets.splice(i, 1);
                                    await this.plugin.saveSettings();
                                    this.refreshSettings();
                                })
                            );
                        },
                    })),
                    {
                        name: '',
                        render: (setting: Setting) => {
                            setting.addButton((button) => button
                                .setButtonText(t('settings.info.addTarget'))
                                .onClick(async () => {
                                    const largestTarget = Math.max(
                                        0,
                                        ...this.plugin.settings.writingTargetPresets.map((preset) => preset.target),
                                    );
                                    const target = largestTarget + 500;
                                    this.plugin.settings.writingTargetPresets.push({
                                        target,
                                        tolerance: Math.max(1, Math.round(target * 0.05)),
                                    });
                                    await this.plugin.saveSettings();
                                    this.refreshSettings();
                                })
                            );
                        },
                    },
                ],
            },
            {
                type: 'group' as const,
                heading: t('settings.work.heading'),
                items: [
                    {
                        name: t('settings.work.path.name'),
                        desc: t('settings.work.path.desc'),
                        control: { type: 'text' as const, key: 'workFilePath', placeholder: t('settings.work.path.placeholder') },
                    },
                ],
            },
            {
                type: 'group' as const,
                heading: 'Later',
                items: [
                    {
                        name: t('settings.later.folder.name'),
                        desc: t('settings.later.folder.desc'),
                        control: { type: 'text' as const, key: 'moveLineTargetFolder', placeholder: t('settings.later.folder.placeholder') },
                     },
                ],
            },
            {
            	type: 'group' as const,
                heading: t('settings.commandSlots.heading'),
            	items: [
            		{
                        name: t('settings.commandSlots.count.name'),
                        desc: t('settings.commandSlots.count.desc'),
            			control: { type: 'number' as const, key: 'commandSlotCount', min: 1 },
            		},
            	],
            },
            {
                type: 'group' as const,
                heading: t('settings.reset.heading'),
                items: [
                    {
                        name: t('settings.reset.name'),
                        desc: t('settings.reset.desc'),
                        render: (setting: Setting) => {
                            setting.addButton((btn) => btn
                                .setButtonText(t('settings.reset.button'))
                                .setDestructive()
                                .onClick(async () => {
                                    this.plugin.settings = structuredClone(DEFAULT_SETTINGS);
                                    await this.plugin.saveSettings();
                                    this.plugin.info.settingsChanged();
                                    new Notice(t('settings.reset.notice'));
                                    this.refreshSettings();
                                })
                            );
                        },
                    },
                ],
            },
        ];
    }

    private refreshSettings(): void {
        this.update();
    }

}
