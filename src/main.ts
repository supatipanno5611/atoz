import { Editor, MarkdownView, Notice, Plugin, TFile, View, normalizePath } from 'obsidian';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CursorCenterFeature } from './features/CursorCenter';
import { CutCopyFeature } from './features/CutCopy';
import { ExecutesFeature } from './features/Executes';
import { MobileFeature } from './features/Mobile';
import { MoveCurrentFileFeature } from './features/MoveCurrentFile';
import { PropertiesFeature, type TopicSource } from './features/Properties';
import { SidebarTabCycleFeature } from './features/SidebarTabCycle';
import { SnippetsSuggestions } from './features/Snippets';
import { SymbolsFeature, SymbolSuggestions } from './features/Symbols';
import { WorkFeature } from './features/Work';
import { ATOZSettingTab } from './setting';
import { ATOZSettings, DEFAULT_SETTINGS, isValidWritingTarget, type WritingTargetPreset } from './types';
import { t } from './locales';
import { NoteListFeature } from './features/NoteList';
import { InfoFeature } from './features/Info';
import { VersionManagerFeature } from './features/VersionManager';
import { DaynightFeature } from './features/Daynight';
import { isRecord } from './utils';

interface PluginRegistry {
    enabledPlugins: Set<string>;
    plugins: Record<string, unknown>;
}

interface CommandManager {
    commands: Record<string, unknown>;
    executeCommandById(commandId: string): boolean;
}

const BOOKMARK_ACTIVE_TAB_COMMAND_ID = 'bookmarks:bookmark-current-view';

export default class ATOZPlugin extends Plugin {
    settings!: ATOZSettings;
    executes!: ExecutesFeature;
    cursorCenter!: CursorCenterFeature;
    properties!: PropertiesFeature;
    cutCopy!: CutCopyFeature;
    symbols!: SymbolsFeature;
    work!: WorkFeature;
    mobile!: MobileFeature;
    moveCurrentFile!: MoveCurrentFileFeature;
    sidebarTabCycle!: SidebarTabCycleFeature;
    info!: InfoFeature;
    noteList!: NoteListFeature;
    versionManager!: VersionManagerFeature;
    daynight!: DaynightFeature;

    private saveTimer: number | null = null;
    private _koIme_isComposingState: boolean = false;
    private _koIme_isFeatureActivated: boolean = false;

    async onload() {
        await this.loadSettings();

        this.registerEditorExtension(this._koIme_generateCm6Extension());

        this.executes = new ExecutesFeature(this);
        this.cursorCenter = new CursorCenterFeature(this);
        this.properties = new PropertiesFeature(this);
        this.cutCopy = new CutCopyFeature();
        this.symbols = new SymbolsFeature(this);
        this.work = new WorkFeature(this);
        this.mobile = new MobileFeature(this);
        this.moveCurrentFile = new MoveCurrentFileFeature(this);
        this.sidebarTabCycle = new SidebarTabCycleFeature(this);
        this.info = new InfoFeature(this);
        this.noteList = new NoteListFeature(this);
        this.versionManager = new VersionManagerFeature(this);
        this.daynight = new DaynightFeature(this);

        this.addSettingTab(new ATOZSettingTab(this.app, this));
        this.registerRibbonIcon();
        this.registerCommands();
        this.registerEvents();

        this.registerEditorSuggest(new SnippetsSuggestions(this));
        this.registerEditorSuggest(new SymbolSuggestions(this));

        this.info.install();
        this.noteList.install();
        this.versionManager.install();
        this.daynight.install();

        this.app.workspace.onLayoutReady(() => {
            this.app.workspace.detachLeavesOfType('atoz-clipboard-view');
            this.app.workspace.detachLeavesOfType('atoz-later-view');
            this.app.workspace.detachLeavesOfType('atoz-budget-view');
            this.app.workspace.detachLeavesOfType('atoz-dashboard');
            this.app.workspace.detachLeavesOfType('atoz-daynight-dashboard');
            this.mobile.install();
            this.app.workspace.onLayoutReady(() => {
           		let _koIme_lastCheckedCount = -1;
           		let _koIme_stableTickCounter = 0;
            
           		const _koIme_detectionIntervalId = window.setInterval(() => {
           			try {
				const _koIme_targetPluginsObj = (this.app as typeof this.app & { plugins?: PluginRegistry }).plugins;
           				if (!_koIme_targetPluginsObj || !_koIme_targetPluginsObj.enabledPlugins || !_koIme_targetPluginsObj.plugins) {
           					return; 
           				}
            
           				const _koIme_totalEnabledCount = _koIme_targetPluginsObj.enabledPlugins.size;
           				const _koIme_totalLoadedCount = Object.keys(_koIme_targetPluginsObj.plugins).length;
            
           				const _koIme_isWorkspacePopulated = !!this.app.workspace.getActiveViewOfType(View) || !!this.app.workspace.activeEditor;
            
           				if ((_koIme_totalLoadedCount >= _koIme_totalEnabledCount && _koIme_isWorkspacePopulated) || 
           					(_koIme_totalLoadedCount === _koIme_lastCheckedCount && _koIme_stableTickCounter++ > 5)) {
            						
           					window.clearInterval(_koIme_detectionIntervalId);
            
           					let _koIme_isExecutionTriggered = false;
            
           					const _koIme_executeActivationSequence = () => {
           						if (_koIme_isExecutionTriggered) return;
           						_koIme_isExecutionTriggered = true;
            							
           						this._koIme_isFeatureActivated = true; 
                               new Notice(t('notice.obsidianReady'));
           					};
            
           					window.requestAnimationFrame(() => {
           						window.requestAnimationFrame(() => {
           							window.setTimeout(() => {
           								_koIme_executeActivationSequence();
           							}, 150);
           						});
           					});
           				} else {
           					if (_koIme_totalLoadedCount !== _koIme_lastCheckedCount) {
           						_koIme_lastCheckedCount = _koIme_totalLoadedCount;
           						_koIme_stableTickCounter = 0;
           					}
           				}
			} catch {
           				window.clearInterval(_koIme_detectionIntervalId);
           			}
           		}, 200);
           
           		this.registerInterval(_koIme_detectionIntervalId);
           	});
        });
    }

    onunload() {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
            void this.saveSettings();
        }
        this._koIme_isFeatureActivated = false;
        this.mobile.uninstall();
        this.info.uninstall();
        this.versionManager.uninstall();
        this.daynight.uninstall();
    }

    async loadSettings() {
        const loadedData: unknown = await this.loadData();
        const data: Record<string, unknown> = typeof loadedData === 'object' && loadedData !== null
            ? { ...loadedData }
            : {};
        delete data.laterFilePath;
        delete data.moveLineTargetFolder;
        delete data.workTimestampFormat;
        delete data.moveLineSuffix;
        delete data.quickSlots;
        delete data.commandSlots;
        delete data.commandSlotCount;
        for (const key of Object.keys(data)) {
            if (/^(budget|meal|timeline|daynightDashboard)[A-Z]/.test(key)) delete data[key];
        }
        const hadFolderVisibilityData = 'isAllFoldersHidden' in data;
        delete data.isAllFoldersHidden;
        const hadClipboardData = 'clipboardHistory' in data
            || 'clipboardHistoryLimit' in data
            || 'clipboardPreviewLength' in data;
        delete data.clipboardHistory;
        delete data.clipboardHistoryLimit;
        delete data.clipboardPreviewLength;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        if (this.settings.readingTimeCharacterBasis !== 'with-spaces' &&
            this.settings.readingTimeCharacterBasis !== 'without-spaces') {
            this.settings.readingTimeCharacterBasis = DEFAULT_SETTINGS.readingTimeCharacterBasis;
        }
        if (!Number.isInteger(this.settings.readingCharactersPerMinute) ||
            this.settings.readingCharactersPerMinute < 1) {
            this.settings.readingCharactersPerMinute = DEFAULT_SETTINGS.readingCharactersPerMinute;
        }
        if (!Number.isInteger(this.settings.daynightRecentCount) ||
            this.settings.daynightRecentCount < 1) {
            this.settings.daynightRecentCount = DEFAULT_SETTINGS.daynightRecentCount;
        }
        const presets: unknown[] = Array.isArray(this.settings.writingTargetPresets)
            ? this.settings.writingTargetPresets
            : DEFAULT_SETTINGS.writingTargetPresets;
        // kind가 없는 이전 후보는 범위 목표로 본다.
        this.settings.writingTargetPresets = presets
            .map((preset) => isRecord(preset) ? { kind: 'range', ...preset } : preset)
            .filter((preset): preset is WritingTargetPreset =>
                isRecord(preset) && isValidWritingTarget(preset as WritingTargetPreset));
        if (hadFolderVisibilityData || hadClipboardData) await this.saveSettings();
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    debouncedSave() {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            void this.saveSettings();
            this.saveTimer = null;
        }, 300);
    }

    collectTopicCandidates(): TopicSource[] {
        const candidates: TopicSource[] = [];
        const activeFile = this.app.workspace.getActiveFile();
        const workFilePath = normalizePath(this.settings.workFilePath);

        for (const file of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter: unknown = cache?.frontmatter;
            const isVersionNote = isRecord(frontmatter) && frontmatter.version !== undefined;
            const isExcludedCandidate = file.path === activeFile?.path ||
                file.path === workFilePath || file.path === 'log.md' || isVersionNote;

            if (!isExcludedCandidate) {
                candidates.push({
                    kind: 'note',
                    sourcePath: activeFile?.path ?? file.path,
                    value: file.path.replace(/\.md$/i, ''),
                });
            }

            const topics = isRecord(frontmatter) ? frontmatter.topics : undefined;
            if (!Array.isArray(topics)) continue;

            for (const value of topics) {
                if (typeof value === 'string') {
                    candidates.push({
                        includeExcludedTarget: file.path === activeFile?.path,
                        kind: 'topic',
                        value,
                        sourcePath: file.path,
                    });
                }
            }
        }

        return candidates;
    }

    registerRibbonIcon() {
        this.addRibbonIcon('lucide-file-pen', t('ribbon.openWorkFile'), () => void this.work.openWorkFile());
        this.addRibbonIcon('lucide-panel-bottom', t('ribbon.toggleMobileToolbar'), () => this.mobile.toggleMobileToolbarHidden());
        this.addRibbonIcon('lucide-bookmark-plus', t('ribbon.bookmarkActiveTab'), () => this.bookmarkActiveTab());
    }

    private bookmarkActiveTab(): void {
        const commandManager = (this.app as typeof this.app & { commands?: CommandManager }).commands;
        if (!commandManager?.commands[BOOKMARK_ACTIVE_TAB_COMMAND_ID]) {
            new Notice(t('notice.enableBookmarksCorePlugin'));
            return;
        }

        if (!commandManager.executeCommandById(BOOKMARK_ACTIVE_TAB_COMMAND_ID)) {
            new Notice(t('notice.cannotBookmarkActiveTab'));
        }
    }

    registerCommands() {
        this.addCommand({ id: 'toggle-cursor-center', name: t('command.toggleCursorCenter'), callback: () => this.cursorCenter.toggleCursorCenter() });

        this.addCommand({ id: 'copy-all-document', name: t('command.copyEntireDocument'), editorCallback: (editor) => this.cutCopy.copyAll(editor) });
        this.addCommand({ id: 'cut-all-document', name: t('command.cutEntireDocument'), editorCallback: (editor: Editor) => this.cutCopy.cutAll(editor) });
        this.addCommand({ id: 'cut-to-clipboard', name: t('command.cut'), icon: 'lucide-scissors', editorCallback: (editor) => this.cutCopy.handleCutCopy(editor, true) });
        this.addCommand({ id: 'copy-to-clipboard', name: t('command.copy'), icon: 'copy', editorCallback: (editor) => this.cutCopy.handleCutCopy(editor, false) });

        this.addCommand({ id: 'execute-delete-paragraph', name: t('command.deleteParagraph'), icon: 'lucide-trash-2', callback: () => this.executes.executeDeleteParagraph() });
        this.addCommand({ id: 'focus-root-leaf', name: t('command.focusMainEditor'), callback: () => void this.executes.focusRootLeaf() });

        this.addCommand({ id: 'toggle-mobile-toolbar', name: t('command.toggleMobileToolbar'), icon: 'lucide-panel-bottom', callback: () => this.mobile.toggleMobileToolbarHidden() });
        this.addCommand({ id: 'toggle-mobile-sticky-ribbon', name: t('command.toggleStickyRibbon'), icon: 'sidebar-toggle-button-icon', callback: () => void this.mobile.toggleStickyRibbon() });
        this.addCommand({ id: 'move-current-file', name: t('command.moveCurrentFile'), icon: 'lucide-folder-input', callback: () => this.moveCurrentFile.moveCurrentFile() });

        this.addCommand({ id: 'edit-topics', name: t('command.editTopics'), icon: 'lucide-tags', callback: () => void this.properties.editTopics() });
        this.addCommand({ id: 'insert-today-date', name: t('command.insertTodayDate'), icon: 'lucide-calendar-plus', callback: () => void this.properties.insertTodayDate() });
        this.addCommand({ id: 'update-today-date', name: t('command.updateTodayDate'), icon: 'lucide-calendar-sync', callback: () => void this.properties.updateTodayDate() });
        this.addCommand({ id: 'lint-properties', name: t('command.lintProperties'), icon: 'lucide-list-x', callback: () => void this.properties.lintProperties() });

        this.addCommand({ id: 'open-work-file', name: t('command.openWorkFile'), callback: () => void this.work.openWorkFile() });
        this.addCommand({ id: 'close-all-tabs', name: t('command.closeAllTabs'), callback: () => void this.work.cleanupTabs() });

        this.addCommand({ id: 'cycle-left-sidebar-next', name: t('command.nextLeftSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('left', 1) });
        this.addCommand({ id: 'cycle-left-sidebar-prev', name: t('command.previousLeftSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('left', -1) });
        this.addCommand({ id: 'cycle-right-sidebar-next', name: t('command.nextRightSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('right', 1) });
        this.addCommand({ id: 'cycle-right-sidebar-prev', name: t('command.previousRightSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('right', -1) });

        this.addCommand({ id: 'ko-ime-fix-reset-runtime-status', name: t('command.restartKoreanImeFix'), callback: () => { this._koIme_resetFeatureState(); } });
    }

    registerEvents() {
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                if (this.settings.isCursorCenterEnabled) {
                    this.cursorCenter.scrollToCursorCenter(editor);
                }
            }),
        );

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (!(file instanceof TFile) || file.extension !== 'md') return;
        
                if (file.path === this.app.workspace.getActiveFile()?.path) {
                    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (activeView) {
                    	const view = activeView;
                        menu.addItem((item) => {
                            item.setTitle(t('menu.save'))
                        		.setIcon('lucide-save')
                        		.onClick(async () => {
                        			await this.app.vault.modify(file, view.editor.getValue());
                                    new Notice(t('notice.saved'));
                        		});
                        });
                    }
                    menu.addItem((item) => {
                        item.setTitle(t('menu.moveCurrentFile'))
                        	.setIcon('lucide-folder-input')
                            .onClick(() => this.moveCurrentFile.moveCurrentFile());
                    });
                }
        
                menu.addItem((item) => {
                    item.setTitle(t('menu.copyEntireDocument'))
                        .setIcon('copy')
                        .onClick(() => {
                            void this.copyWholeDocument(file);
                        });
                });
            }),
        );

        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            this.symbols.handleSmartBackspace(evt);
        }, true);

        this.registerEvent(
            this.app.workspace.on('layout-change', () => this.mobile.checkSidebarState())
        );

    }

    private async copyWholeDocument(file: unknown): Promise<void> {
        if (!(file instanceof TFile)) return;
        const content = await this.app.vault.read(file);
        await navigator.clipboard.writeText(content);
        new Notice(t('notice.fileCopied', { file: file.name }));
    }

// this is for koIme
    private _koIme_resetFeatureState() {
    	this._koIme_isFeatureActivated = false;
    	this._koIme_isComposingState = false;
    
		window.setTimeout(() => {
    		this._koIme_isFeatureActivated = true;
            new Notice(t('notice.koreanImeFixRestarted'));
    	}, 50);
    }
    
    private _koIme_generateCm6Extension(): Extension {
    	return EditorView.domEventHandlers({
    		compositionstart: () => { this._koIme_isComposingState = true; },
    		compositionend: () => { this._koIme_isComposingState = false; },
    		mousedown: (event, view) => { this._koIme_interceptAndForceCommit(view.dom); },
    		touchstart: (event, view) => { this._koIme_interceptAndForceCommit(view.dom); },
    		keydown: (event, view) => {
    			const _koIme_restrictedMoveKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
    			if (_koIme_restrictedMoveKeys.includes(event.key)) {
    				this._koIme_interceptAndForceCommit(view.dom);
    			}
    		}
    	});
    }
    
    private _koIme_interceptAndForceCommit(domElement: HTMLElement) {
    	if (this._koIme_isFeatureActivated && this._koIme_isComposingState) {
    		const _koIme_customCompositionEndEvent = new CompositionEvent('compositionend');
    		domElement.dispatchEvent(_koIme_customCompositionEndEvent);
    		this._koIme_isComposingState = false; 
    	}
    }
}
