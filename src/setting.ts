import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type ATOZVER6Plugin from './main';
import { DEFAULT_SETTINGS } from './types';

type JsonSettingKey = 'symbols' | 'symbolPairs';
type NumberSettingKey = 'snippetLimit' | 'symbolLimit';

export class ATOZSettingTab extends PluginSettingTab {
    plugin: ATOZVER6Plugin;

    constructor(app: App, plugin: ATOZVER6Plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('특정 마크다운').setHeading();
        new Setting(containerEl)
            .setName('특정 마크다운 경로')
            .setDesc('"특정 마크다운 파일 열기" 명령으로 열 파일의 볼트 기준 경로입니다. 예: index.md, folder/note.md')
            .addText((t) => t
                .setPlaceholder('예: index.md')
                .setValue(this.plugin.settings.CertainMdPath)
                .onChange(async (v) => {
                    this.plugin.settings.CertainMdPath = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('커서 중앙 고정').setHeading();
        new Setting(containerEl)
            .setName('커서 중앙 고정 사용')
            .setDesc('편집할 때 커서가 화면 중앙 근처에 유지됩니다.')
            .addToggle((t) => t
                .setValue(this.plugin.settings.isCursorCenterEnabled)
                .onChange(async (v) => {
                    this.plugin.settings.isCursorCenterEnabled = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('프로젝트').setHeading();
        new Setting(containerEl)
            .setName('프로젝트 폴더 경로')
            .setDesc('프로젝트 명령에서 사용할 볼트 기준 폴더 경로입니다. 예: _publish')
            .addText((t) => t
                .setPlaceholder('_publish')
                .setValue(this.plugin.settings.projectPath)
                .onChange(async (v) => {
                    this.plugin.settings.projectPath = v.trim();
                    this.plugin.projectVisibility.refresh();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('조각글').setHeading();
        new Setting(containerEl)
            .setName('조각글 트리거 문자')
            .setDesc('이 문자를 입력하면 조각글 추천이 열립니다.')
            .addText((t) => t
                .setPlaceholder('@')
                .setValue(this.plugin.settings.snippetTrigger)
                .onChange(async (v) => {
                    const trigger = this.normalizeTrigger(v, DEFAULT_SETTINGS.snippetTrigger, '조각글');
                    t.setValue(trigger);
                    this.plugin.settings.snippetTrigger = trigger;
                    await this.plugin.saveSettings();
                }));

        this.addNumberSetting(containerEl, '조각글 표시 개수', '보여줄 조각글 추천의 최대 개수입니다.', 'snippetLimit');
        this.addLineListSetting(containerEl, '조각글 목록', '한 줄에 하나씩 입력합니다.', 'snippets');

        new Setting(containerEl).setName('기호').setHeading();
        new Setting(containerEl)
            .setName('기호 트리거 문자')
            .setDesc('이 문자를 입력하면 기호 추천이 열립니다.')
            .addText((t) => t
                .setPlaceholder('~')
                .setValue(this.plugin.settings.symbolTrigger)
                .onChange(async (v) => {
                    const trigger = this.normalizeTrigger(v, DEFAULT_SETTINGS.symbolTrigger, '기호');
                    t.setValue(trigger);
                    this.plugin.settings.symbolTrigger = trigger;
                    await this.plugin.saveSettings();
                }));

        this.addNumberSetting(containerEl, '기호 표시 개수', '보여줄 기호 추천의 최대 개수입니다.', 'symbolLimit');
        this.addJsonSetting(containerEl, '기호 목록', '기호 추천 항목을 담은 JSON 배열입니다.', 'symbols');
        this.addJsonSetting(containerEl, '기호 쌍', '스마트 백스페이스로 짝 기호를 지울 때 쓰는 JSON 객체입니다.', 'symbolPairs');

        new Setting(containerEl).setName('작업 문서와 보관 문서').setHeading();
        new Setting(containerEl)
            .setName('작업 문서 경로')
            .setDesc('작업 문서 명령에서 사용할 볼트 기준 경로입니다.')
            .addText((t) => t
                .setPlaceholder('예: work.md')
                .setValue(this.plugin.settings.workFilePath)
                .onChange(async (v) => {
                    this.plugin.settings.workFilePath = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('보관 문서 경로')
            .setDesc('보관 문서 명령에서 사용할 볼트 기준 경로입니다.')
            .addText((t) => t
                .setPlaceholder('예: later.md')
                .setValue(this.plugin.settings.laterFilePath)
                .onChange(async (v) => {
                    this.plugin.settings.laterFilePath = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('작업 시간 형식')
            .setDesc('작업 문서 백업을 덧붙일 때 사용할 Moment.js 시간 형식입니다.')
            .addText((t) => t
                .setPlaceholder('시간 형식을 입력하세요')
                .setValue(this.plugin.settings.workTimestampFormat)
                .onChange(async (v) => {
                    this.plugin.settings.workTimestampFormat = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('초기화').setHeading();
        new Setting(containerEl)
            .setName('모든 설정 초기화')
            .setDesc('플러그인 설정을 모두 기본값으로 되돌립니다.')
            .addButton((btn) => btn
                .setButtonText('초기화')
                .setWarning()
                .onClick(() => {
                    void this.resetSettings();
                }));
    }

    private async resetSettings(): Promise<void> {
        this.plugin.settings = structuredClone(DEFAULT_SETTINGS);
        this.plugin.projectVisibility.refresh();
        await this.plugin.saveSettings();
        new Notice('설정을 기본값으로 초기화했습니다.');
        this.display();
    }

    private normalizeTrigger(value: string, fallback: string, label: string): string {
        const trigger = value.trim();
        if (trigger.length > 0) return trigger;

        new Notice(`${label} 트리거 문자는 비워둘 수 없어 기본값을 사용합니다.`);
        return fallback;
    }

    private addNumberSetting(
        containerEl: HTMLElement,
        name: string,
        desc: string,
        key: NumberSettingKey,
    ): void {
        new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addText((t) => {
                t.inputEl.type = 'number';
                t.setValue(String(this.plugin.settings[key]))
                    .onChange(async (v) => {
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        this.plugin.settings[key] = Math.floor(n);
                        await this.plugin.saveSettings();
                    });
            });
    }

    private addLineListSetting(
        containerEl: HTMLElement,
        name: string,
        desc: string,
        key: 'snippets',
    ): void {
        const setting = new Setting(containerEl).setName(name).setDesc(desc);
        setting.settingEl.addClass('atoz-setting-vertical');
        const initial = this.plugin.settings[key].join('\n');

        setting.addTextArea((ta) => {
            ta.inputEl.addClass('atoz-setting-textarea');
            ta.setValue(initial);
            ta.inputEl.addEventListener('blur', () => {
                void (async () => {
                    this.plugin.settings[key] = ta.getValue().split('\n').filter((line) => line.length > 0);
                    await this.plugin.saveSettings();
                })();
            });
        });
    }

    private addJsonSetting(
        containerEl: HTMLElement,
        name: string,
        desc: string,
        key: JsonSettingKey,
    ): void {
        const setting = new Setting(containerEl).setName(name).setDesc(desc);
        setting.settingEl.addClass('atoz-setting-vertical');
        const initial = JSON.stringify(this.plugin.settings[key], null, 2);
        const errorEl = setting.settingEl.createDiv({ cls: 'atoz-setting-error' });

        setting.addTextArea((ta) => {
            ta.inputEl.addClass('atoz-setting-textarea');
            ta.setValue(initial);
            ta.inputEl.addEventListener('blur', () => {
                void (async () => {
                    try {
                        this.updateJsonSetting(key, JSON.parse(ta.getValue()));
                        await this.plugin.saveSettings();
                        errorEl.setText('');
                    } catch {
                        errorEl.setText('JSON 형식이 올바르지 않아 변경 사항을 저장하지 못했습니다.');
                    }
                })();
            });
        });
    }

    private updateJsonSetting(key: JsonSettingKey, value: unknown): void {
        if (key === 'symbolPairs' && this.isStringRecord(value)) {
            this.plugin.settings.symbolPairs = value;
            return;
        }

        if (key === 'symbols' && Array.isArray(value)) {
            this.plugin.settings.symbols = value
                .filter((item): item is { id: unknown; symbol: unknown; closing?: unknown } => typeof item === 'object' && item !== null)
                .map((item) => ({
                    id: typeof item.id === 'string' ? item.id : '',
                    symbol: typeof item.symbol === 'string' ? item.symbol : '',
                    ...(typeof item.closing === 'string' ? { closing: item.closing } : {}),
                }));
            return;
        }

        throw new Error('Invalid JSON shape');
    }

    private isStringRecord(value: unknown): value is Record<string, string> {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
        }

        const record = value as Record<string, unknown>;

        for (const key in record) {
            if (typeof record[key] !== 'string') {
                return false;
            }
        }

        return true;
    }
}
