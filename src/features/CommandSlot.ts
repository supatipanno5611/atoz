import { App, Notice, SuggestModal } from 'obsidian';
import type ATOZPlugin from '../main';
import { t } from '../locales';

interface CommandEntry {
    id: string;
    name: string;
}

interface CommandManager {
    commands: Record<string, CommandEntry>;
    executeCommandById(commandId: string): boolean;
}

function getCommandManager(app: App): CommandManager {
    return (app as App & { commands: CommandManager }).commands;
}

function getAllCommands(app: App): CommandEntry[] {
    const commands = getCommandManager(app).commands;
    return Object.values(commands).map(c => ({ id: c.id, name: c.name }));
}

export class CommandSlotFeature {
    constructor(private plugin: ATOZPlugin) {}

    async assignSlot(slotId: number, commandId: string, commandName: string): Promise<void> {
        const index = slotId - 1;
        const slots = this.plugin.settings.commandSlots;

        while (slots.length <= index) {
            slots.push(null);
        }

        slots[index] = commandId;
        await this.plugin.saveSettings();
        new Notice(t('commandSlot.assigned', { slot: slotId, command: commandName }));
    }

    async clearSlot(slotId: number): Promise<void> {
        const index = slotId - 1;
        this.plugin.settings.commandSlots[index] = null;
        await this.plugin.saveSettings();
        new Notice(t('commandSlot.cleared', { slot: slotId }));
    }

    executeSlot(slotId: number): void {
        const index = slotId - 1;
        const commandId = this.plugin.settings.commandSlots[index];

        if (!commandId) {
            new Notice(t('commandSlot.empty', { slot: slotId }));
            return;
        }

        const executed = getCommandManager(this.plugin.app).executeCommandById(commandId);
        if (!executed) {
            new Notice(t('commandSlot.cannotRun', { command: commandId }));
        }
    }

    openAssignModal(): void {
        new CommandSlotAssignModal(this.plugin.app, this.plugin).open();
    }

    openSelectModal(): void {
        new CommandSlotOpenModal(this.plugin.app, this.plugin).open();
    }
}

abstract class BaseCommandSlotModal extends SuggestModal<number> {
    constructor(app: App, protected plugin: ATOZPlugin, placeholder: string) {
        super(app);
        this.setPlaceholder(placeholder);
    }

    onOpen(): void {
        void super.onOpen();
        const count = this.plugin.settings.commandSlotCount;
        for (let i = 1; i <= Math.min(count, 9); i++) {
            const key = String(i);
            this.scope.register(['Alt'], key, (evt: KeyboardEvent) => {
                evt.preventDefault();
                void this.onChooseSuggestion(i, evt);
                this.close();
                return false;
            });
        }
    }

    getSuggestions(_query: string): number[] {
        const count = this.plugin.settings.commandSlotCount;
        return Array.from({ length: count }, (_, i) => i + 1);
    }

    abstract renderSuggestion(slotId: number, el: HTMLElement): void;
    abstract onChooseSuggestion(slotId: number, evt: MouseEvent | KeyboardEvent): void;
}

class CommandSlotAssignModal extends BaseCommandSlotModal {
    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin, t('commandSlot.assignTitle'));
    }

    renderSuggestion(slotId: number, el: HTMLElement): void {
        const index = slotId - 1;
        const commandId = this.plugin.settings.commandSlots[index];
        if (!commandId) {
            el.setText(t('commandSlot.emptyItem', { slot: slotId }));
            return;
        }

        const commands = getAllCommands(this.app);
        const command = commands.find(c => c.id === commandId);
        el.setText(t('commandSlot.removeItem', { slot: slotId, command: command ? command.name : commandId }));
    }

    onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): void {
        const index = slotId - 1;
        const commandId = this.plugin.settings.commandSlots[index];

        if (commandId) {
            void this.plugin.commandSlot.clearSlot(slotId);
            return;
        }

        new CommandSearchModal(this.app, (command) => {
            void this.plugin.commandSlot.assignSlot(slotId, command.id, command.name);
        }).open();
    }
}

class CommandSlotOpenModal extends BaseCommandSlotModal {
    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin, t('commandSlot.runTitle'));
    }

    renderSuggestion(slotId: number, el: HTMLElement): void {
        const index = slotId - 1;
        const commandId = this.plugin.settings.commandSlots[index];
        if (!commandId) {
            el.setText(t('commandSlot.emptyItem', { slot: slotId }));
            return;
        }

        const commands = getAllCommands(this.app);
        const command = commands.find(c => c.id === commandId);
        el.setText(t('commandSlot.runItem', { slot: slotId, command: command ? command.name : commandId }));
    }

    onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): void {
        this.plugin.commandSlot.executeSlot(slotId);
    }
}

class CommandSearchModal extends SuggestModal<CommandEntry> {
    constructor(app: App, private onSubmit: (command: CommandEntry) => void) {
        super(app);
        this.setPlaceholder(t('commandSlot.searchPlaceholder'));
    }

    getSuggestions(query: string): CommandEntry[] {
        const all = getAllCommands(this.app);
        if (!query) return all;
        const lower = query.toLowerCase();
        return all.filter(c => c.name.toLowerCase().includes(lower));
    }

    renderSuggestion(command: CommandEntry, el: HTMLElement): void {
        el.setText(command.name);
    }

    onChooseSuggestion(command: CommandEntry): void {
        this.onSubmit(command);
    }
}
