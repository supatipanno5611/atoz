import { App, Notice, SuggestModal } from 'obsidian';
import type ATOZPlugin from '../main';

interface CommandEntry {
    id: string;
    name: string;
}

function getAllCommands(app: App): CommandEntry[] {
    const commands = (app as any).commands.commands as Record<string, { id: string; name: string }>;
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
        new Notice(`슬롯 ${slotId}에 "${commandName}" 명령어를 지정했습니다.`);
    }

    executeSlot(slotId: number): void {
        const index = slotId - 1;
        const commandId = this.plugin.settings.commandSlots[index];

        if (!commandId) {
            new Notice(`명령어 슬롯 ${slotId}이 비어 있습니다.`);
            return;
        }

        const executed = (this.plugin.app as any).commands.executeCommandById(commandId);
        if (!executed) {
            new Notice(`명령어를 실행할 수 없습니다: ${commandId}`);
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
        super.onOpen();
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
    abstract onChooseSuggestion(slotId: number, evt: MouseEvent | KeyboardEvent): Promise<void> | void;
}

class CommandSlotAssignModal extends BaseCommandSlotModal {
    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin, '명령어를 지정할 슬롯을 선택하세요.');
    }

    renderSuggestion(slotId: number, el: HTMLElement): void {
        const index = slotId - 1;
        const commandId = this.plugin.settings.commandSlots[index];
        if (!commandId) {
            el.setText(`[${slotId}] 슬롯: (비어 있음)`);
            return;
        }

        const commands = getAllCommands(this.app);
        const command = commands.find(c => c.id === commandId);
        el.setText(`[${slotId}] 슬롯: ${command ? command.name : commandId}`);
    }

    onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): void {
        new CommandSearchModal(this.app, (command) => {
            void this.plugin.commandSlot.assignSlot(slotId, command.id, command.name);
        }).open();
    }
}

class CommandSlotOpenModal extends BaseCommandSlotModal {
    constructor(app: App, plugin: ATOZPlugin) {
        super(app, plugin, '실행할 명령어 슬롯을 선택하세요.');
    }

    renderSuggestion(slotId: number, el: HTMLElement): void {
        const index = slotId - 1;
        const commandId = this.plugin.settings.commandSlots[index];
        if (!commandId) {
            el.setText(`[${slotId}] 슬롯: (비어 있음)`);
            return;
        }

        const commands = getAllCommands(this.app);
        const command = commands.find(c => c.id === commandId);
        el.setText(`[${slotId}] 슬롯: ${command ? command.name : commandId} (누르면 실행)`);
    }

    onChooseSuggestion(slotId: number, _evt: MouseEvent | KeyboardEvent): void {
        this.plugin.commandSlot.executeSlot(slotId);
    }
}

class CommandSearchModal extends SuggestModal<CommandEntry> {
    constructor(app: App, private onSubmit: (command: CommandEntry) => void) {
        super(app);
        this.setPlaceholder('지정할 명령어를 검색하세요.');
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
