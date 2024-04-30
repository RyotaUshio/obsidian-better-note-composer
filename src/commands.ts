import { Command, Editor, IconName, MarkdownFileInfo, MarkdownView, Menu, MenuItem } from 'obsidian';


interface EditorCommandSpec {
    id: string;
    name: string;
    icon?: IconName;
    checker: (editor: Editor, info: MarkdownView | MarkdownFileInfo) => boolean;
    executor: (editor: Editor, info: MarkdownView | MarkdownFileInfo) => any;
    menu?: boolean;
}


export class BetterNoteComposerEditorCommand {
    constructor(public spec: EditorCommandSpec) { }

    toCommand(): Command {
        return {
            id: this.spec.id,
            name: this.spec.name,
            icon: this.spec.icon,
            editorCheckCallback: (checking, editor, info) => {
                if (!this.spec.checker(editor, info)) return false;
                if (!checking) this.spec.executor(editor, info);
                return true;
            }
        };
    }

    onEditorMenu(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo): MenuItem | undefined {
        const shouldAddItem = this.spec.menu ?? true;

        if (shouldAddItem && this.spec.checker(editor, info)) {
            let ret: MenuItem | undefined;

            menu.addItem((item) => {
                ret = item;
                item.setTitle(this.spec.name)
                    .onClick(() => this.spec.executor(editor, info));
                if (this.spec.icon) item.setIcon(this.spec.icon);
            });

            return ret;
        }
    }
}
