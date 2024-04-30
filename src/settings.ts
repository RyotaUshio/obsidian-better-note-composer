import { PluginSettingTab, Setting } from 'obsidian';
import BetterNoteComposerPlugin from 'main';


const REPLACEMENT_TEXT = {
	'link': 'Link', // The core plugin uses "Link to new file" but it doesn't make sense since the destination file can be an existing one
	'embed': 'Embed',
	'none': 'None',
	'same': 'Same as the core Note Composer',
};

export interface BetterNoteComposerSettings {
	replacementText: keyof typeof REPLACEMENT_TEXT;
}

export const DEFAULT_SETTINGS: BetterNoteComposerSettings = {
	replacementText: 'same',
};

export class BetterNoteComposerSettingTab extends PluginSettingTab {
	constructor(public plugin: BetterNoteComposerPlugin) {
		super(plugin.app, plugin);
	}
	
	display(): void {
		this.containerEl.empty();

		new Setting(this.containerEl)
			.setName('Text after extraction')
			.setDesc('What to show in place of the extracted text after extraction.')
			.addDropdown((dropdown) => {
				dropdown.addOptions(REPLACEMENT_TEXT)
					.setValue(this.plugin.settings.replacementText)
					.onChange(async (value: keyof typeof REPLACEMENT_TEXT) => {
						this.plugin.settings.replacementText = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
