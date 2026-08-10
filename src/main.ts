import { Editor, MarkdownView, Notice, Plugin, TFile, View } from 'obsidian';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CommandSlotFeature } from './features/CommandSlot';
import { CursorCenterFeature } from './features/CursorCenter';
import { CutCopyFeature } from './features/CutCopy';
import { CutCreateNewMdFeature } from './features/CutCreateNewMd';
import { ExecutesFeature } from './features/Executes';
import { MobileFeature } from './features/Mobile';
import { MoveCurrentFileFeature } from './features/MoveCurrentFile';
import { PropertiesFeature } from './features/Properties';
import { QuickSlotFeature, toPathArray, fromPathArray } from './features/QuickSlot';
import { SidebarTabCycleFeature } from './features/SidebarTabCycle';
import { SnippetsSuggestions } from './features/Snippets';
import { SymbolsFeature, SymbolSuggestions } from './features/Symbols';
import { WorkFeature } from './features/Work';
import { ATOZSettingTab } from './setting';
import { ATOZSettings, DEFAULT_SETTINGS } from './types';
import { t } from './locales';
import { LaterFeature, LaterView, VIEW_TYPE_LATER } from './features/Later';
import { InfoFeature } from './features/Info';
import { isRecord } from './utils';

interface PluginRegistry {
    enabledPlugins: Set<string>;
    plugins: Record<string, unknown>;
}

export default class ATOZPlugin extends Plugin {
    settings!: ATOZSettings;
    executes!: ExecutesFeature;
    cursorCenter!: CursorCenterFeature;
    properties!: PropertiesFeature;
    cutCopy!: CutCopyFeature;
    symbols!: SymbolsFeature;
    work!: WorkFeature;
    cutCreateNewMd!: CutCreateNewMdFeature;
    mobile!: MobileFeature;
    moveCurrentFile!: MoveCurrentFileFeature;
    sidebarTabCycle!: SidebarTabCycleFeature;
    quickSlot!: QuickSlotFeature;
    commandSlot!: CommandSlotFeature;
    later!: LaterFeature;
    info!: InfoFeature;

    activeSidebarMode: 'later' | null = null;

    topicCandidates: string[] = [];
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
        this.cutCreateNewMd = new CutCreateNewMdFeature(this);
        this.mobile = new MobileFeature(this);
        this.moveCurrentFile = new MoveCurrentFileFeature(this);
        this.sidebarTabCycle = new SidebarTabCycleFeature(this);
        this.quickSlot = new QuickSlotFeature(this);
        this.commandSlot = new CommandSlotFeature(this);
        this.later = new LaterFeature(this);
        this.info = new InfoFeature(this);

        this.addSettingTab(new ATOZSettingTab(this.app, this));
        this.registerRibbonIcon();
        this.registerCommands();
        this.registerEvents();

        this.registerEditorSuggest(new SnippetsSuggestions(this));
        this.registerEditorSuggest(new SymbolSuggestions(this));

        this.registerView(VIEW_TYPE_LATER, (leaf) => new LaterView(leaf, this));
        this.later.install();
        this.info.install();

        this.app.workspace.onLayoutReady(() => {
            this.app.workspace.detachLeavesOfType('atoz-clipboard-view');
            this.topicCandidates = this.collectTopicCandidates();
            this.mobile.install();
            this.later.captureCurrentRootFile();
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
        this.later.uninstall();
        this.info.uninstall();
    }

    async loadSettings() {
        const loadedData: unknown = await this.loadData();
        const data: Record<string, unknown> = typeof loadedData === 'object' && loadedData !== null
            ? { ...loadedData }
            : {};
        delete data.laterFilePath;
        delete data.workTimestampFormat;
        delete data.moveLineSuffix;
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
        const presets = Array.isArray(this.settings.writingTargetPresets)
            ? this.settings.writingTargetPresets
            : DEFAULT_SETTINGS.writingTargetPresets;
        this.settings.writingTargetPresets = presets
            .filter((preset) => preset && Number.isInteger(preset.target) && preset.target > 0 &&
                Number.isInteger(preset.tolerance) && preset.tolerance > 0 &&
                preset.tolerance < preset.target)
            .map((preset) => ({ ...preset }));
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

    collectTopicCandidates(): string[] {
        const candidates = new Set<string>();

        for (const file of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter: unknown = cache?.frontmatter;
            const topics = isRecord(frontmatter) ? frontmatter.topics : undefined;
            if (!Array.isArray(topics)) continue;

            for (const value of topics) {
                if (typeof value === 'string') {
                    candidates.add(value);
                }
            }
        }

        return [...candidates];
    }

    registerRibbonIcon() {
        this.addRibbonIcon('lucide-file-pen', t('ribbon.openWorkFile'), () => void this.work.openWorkFile());
        this.addRibbonIcon('lucide-panel-bottom', t('ribbon.toggleMobileToolbar'), () => this.mobile.toggleMobileToolbarHidden());
        this.addRibbonIcon('lucide-archive-restore', t('ribbon.openLaterView'), () => void this.later.activateView());
        for (let i = 1; i <= 4; i++) {
            this.addRibbonIcon(`lucide-dice-${i}`, t('ribbon.openQuickSlot', { slot: i }), () => void this.quickSlot.openSlot(i));
        }
    }

    registerCommands() {
        this.addCommand({ id: 'toggle-cursor-center', name: t('command.toggleCursorCenter'), callback: () => this.cursorCenter.toggleCursorCenter() });

        this.addCommand({ id: 'copy-all-document', name: t('command.copyEntireDocument'), editorCallback: (editor) => this.cutCopy.copyAll(editor) });
        this.addCommand({ id: 'cut-all-document', name: t('command.cutEntireDocument'), editorCallback: (editor: Editor) => this.cutCopy.cutAll(editor) });
        this.addCommand({ id: 'cut-to-clipboard', name: t('command.cut'), icon: 'lucide-scissors', editorCallback: (editor) => this.cutCopy.handleCutCopy(editor, true) });
        this.addCommand({ id: 'copy-to-clipboard', name: t('command.copy'), icon: 'copy', editorCallback: (editor) => this.cutCopy.handleCutCopy(editor, false) });

        this.addCommand({ id: 'cut-and-create-new-md', name: t('command.cutToNewNote'), icon: 'lucide-file-input', editorCallback: (editor: Editor) => void this.cutCreateNewMd.cutAndCreateNewMd(editor) });
        
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
        this.addCommand({ id: 'clipboard-select-prev', name: t('command.selectPreviousSidebarItem'), callback: () => this.selectSidebarItem('prev') });
        this.addCommand({ id: 'clipboard-select-next', name: t('command.selectNextSidebarItem'), callback: () => this.selectSidebarItem('next') });
        this.addCommand({ id: 'paste-clipboard-selected', name: t('command.takeSelectedSidebarItem'), icon: 'lucide-clipboard-check', callback: () => void this.takeSidebarItem() });
        this.addCommand({ id: 'open-later-view', name: t('command.openLaterView'), callback: () => void this.later.activateView() });
        this.addCommand({ id: 'resolve-later-links', name: t('command.resolveLaterLinks'), callback: () => void this.later.resolveDuplicateLinks() });

        this.addCommand({ id: 'cycle-left-sidebar-next', name: t('command.nextLeftSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('left', 1) });
        this.addCommand({ id: 'cycle-left-sidebar-prev', name: t('command.previousLeftSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('left', -1) });
        this.addCommand({ id: 'cycle-right-sidebar-next', name: t('command.nextRightSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('right', 1) });
        this.addCommand({ id: 'cycle-right-sidebar-prev', name: t('command.previousRightSidebarTab'), callback: () => this.sidebarTabCycle.cycleTab('right', -1) });

        this.addCommand({ id: 'move-line-to-target', name: t('command.moveSelectionToLater'), icon: 'lucide-archive-restore', editorCallback: (editor, view) => void this.later.moveSelectionToLater(editor, view.file) });
        this.addCommand({ id: 'ko-ime-fix-reset-runtime-status', name: t('command.restartKoreanImeFix'), callback: () => { this._koIme_resetFeatureState(); } });

        this.addCommand({ id: 'open-quick-slot-assigner', name: t('command.openQuickSlotAssigner'), callback: () => this.quickSlot.openAssignModal() });
        this.addCommand({ id: 'open-quick-slot-selector', name: t('command.openQuickSlotSelector'), callback: () => this.quickSlot.openSelectModal() });
        this.addCommand({ id: 'clear-all-slots', name: t('command.clearQuickSlots'), callback: async () => {
            this.settings.quickSlots = [null, null, null, null];
            await this.saveSettings();
            new Notice(t('notice.quickSlotsCleared'));
        }});
        for (let i = 1; i <= 4; i++) {
            this.addCommand({ id: `open-quick-slot-${i}`, name: t('command.openQuickSlot', { slot: i }), callback: () => void this.quickSlot.openSlot(i) });
        }

        this.addCommand({ id: 'open-action-slot-assigner', name: t('command.openCommandSlotAssigner'), callback: () => this.commandSlot.openAssignModal() });
        this.addCommand({ id: 'open-action-slot-selector', name: t('command.openCommandSlotSelector'), callback: () => this.commandSlot.openSelectModal() });
        this.addCommand({ id: 'clear-all-action-slots', name: t('command.clearCommandSlots'), callback: async () => {
        	this.settings.commandSlots = [];
        	await this.saveSettings();
            new Notice(t('notice.commandSlotsCleared'));
        }});
    }

    private selectSidebarItem(direction: 'prev' | 'next'): void {
        if (this.activeSidebarMode === 'later' && this.app.workspace.getLeavesOfType(VIEW_TYPE_LATER).length > 0) {
            if (direction === 'prev') this.later.selectPrev();
            else this.later.selectNext();
            return;
        }

        new Notice(t('notice.selectLaterSidebarTab'));
    }

    private async takeSidebarItem(): Promise<void> {
        if (this.activeSidebarMode === 'later' && this.app.workspace.getLeavesOfType(VIEW_TYPE_LATER).length > 0) {
            await this.later.takeSelected();
            return;
        }

        new Notice(t('notice.selectLaterSidebarTab'));
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
                        item.setTitle(t('menu.openQuickSlotAssigner'))
                        	.setIcon('lucide-square-dot')
                            .onClick(() => this.quickSlot.openAssignModal());
                    });


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
            this.app.vault.on('rename', async (file, oldPath) => {
                let changed = false;
                for (let i = 0; i < this.settings.quickSlots.length; i++) {
                    const paths = toPathArray(this.settings.quickSlots[i]);
                    if (paths.length === 0) continue;
                    let slotChanged = false;
                    const updated = paths.map((p) => {
                    	if (p === oldPath) { slotChanged = true; return file.path; }
                    	if (p.startsWith(oldPath + '/')) { slotChanged = true; return p.replace(oldPath, file.path); }
                    	return p;
                    });
                    if (slotChanged) {
                    	this.settings.quickSlots[i] = fromPathArray(updated);
                    	changed = true;
                    }
                }
                if (changed) {
                	await this.saveSettings();
                new Notice(t('notice.quickSlotPathUpdated'));
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                let changed = false;
                for (let i = 0; i < this.settings.quickSlots.length; i++) {
                    const paths = toPathArray(this.settings.quickSlots[i]);
                    if (paths.length === 0) continue;
                    const remaining = paths.filter((p) => p !== file.path && !p.startsWith(file.path + '/'));
                    if (remaining.length !== paths.length) {
                    	this.settings.quickSlots[i] = fromPathArray(remaining);
                    	changed = true;
                    }
                }
                if (changed) {
                	await this.saveSettings();
                new Notice(t('notice.quickSlotFileRemoved'));
                }
            })
        );

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
