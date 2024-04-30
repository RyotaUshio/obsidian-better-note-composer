import BetterNoteComposerPlugin from 'main';
import { FuzzySuggestModal, Keymap, Notice, Platform, TFile } from 'obsidian';
import { createFileIfNotExist } from 'utils';


export class MarkdownFileChooserModal extends FuzzySuggestModal<TFile> {
    callbacks: ((file: TFile, evt: MouseEvent | KeyboardEvent) => any)[] = [];
    filters: ((file: TFile) => boolean)[] = [];

    constructor(public plugin: BetterNoteComposerPlugin) {
        super(plugin.app);

        this.setInstructions([{
            command: '↑↓',
            purpose: 'navigate',
        }, {
            command: '↵',
            purpose: 'open',
        }, {
            command: Platform.isMacOS ? '⌘ ↵' : 'ctrl ↵',
            purpose: 'open in new tab'
        }, {
            command: Platform.isMacOS ? '⌘ ⌥ ↵' : 'ctrl alt ↵',
            purpose: 'open to the right'
        }, {
            command: 'shift ↵',
            purpose: 'create',
        }, {
            command: 'esc',
            purpose: 'dismiss'
        }]);

        // Setting modifiers to null makes this keymap modifier-independent, 
        // allowing mod+Enter etc to be used without explicit registeration
        // @ts-ignore
        this.scope.register(null, 'Enter', (evt) => {
            if (!evt.isComposing) {
                if (Keymap.isModifier(evt, 'Shift')) {
                    let path = this.inputEl.value;

                    if (path.includes('.')) {
                        const extension = path.split('.').last();
                        if (extension && extension !== 'md') {
                            new Notice(`${this.plugin.manifest.name}: Non-markdown file is not allowed`);
                            return;
                        }
                    }

                    if (!path.endsWith('.md')) {
                        path += '.md';
                    }

                    createFileIfNotExist(this.app, path, '')
                        .then((file) => {
                            if (file) this.onSubmit(file, evt);
                        });
                    this.close();

                    return false;
                }

                // @ts-ignore
                this.chooser.useSelectedItem(evt);
                return false;
            }
        });
    }

    get settings() {
        return this.plugin.settings;
    }

    getItems() {
        return this.app.vault.getMarkdownFiles().filter((file) => this.filters.every((filter) => filter(file)));
    }

    getItemText(file: TFile) {
        return file.path;
    }

    onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
        this.onSubmit(file, evt);
    }

    suggestFiles() {
        this.open();
        return this;
    }

    then(callback: (file: TFile, evt: MouseEvent | KeyboardEvent) => any) {
        this.callbacks.push(callback);
        return this;
    }

    setFilter(filter: (file: TFile) => boolean) {
        this.filters.push(filter);
        return this;
    }

    onSubmit(file: TFile, evt: MouseEvent | KeyboardEvent) {
        this.callbacks.forEach((callback) => callback(file, evt));
    }
}
