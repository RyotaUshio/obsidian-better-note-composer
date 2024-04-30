import { App, Editor, FrontmatterLinkCache, Loc, Pos, Reference, ReferenceCache, TFile } from "obsidian";

import BetterNoteComposerPlugin from "main";


export class BetterNoteComposerComponent {
    constructor(public plugin: BetterNoteComposerPlugin) { }

    get app() {
        return this.plugin.app;
    }

    get settings() {
        return this.plugin.settings;
    }
}

export function isOverlapping(pos1: Pos, pos2: Pos) {
    return pos1.start.offset <= pos2.end.offset && pos2.start.offset <= pos1.end.offset;
}

export function contains(pos1: Pos, pos2: Pos) {
    return pos1.start.offset <= pos2.start.offset && pos2.end.offset <= pos1.end.offset;
}

export function getDisplayText(link: Reference) {
    if (isWikilink(link)) {
        return getDisplayTextFromWikilink(link);
    }
    return link.displayText;
}

export function getDisplayTextFromWikilink(wikilink: Reference) {
    return wikilink.original.match(/\|(.*)\]\]/)?.[1];
}

export function replaceSubstring(src: string, from: number, to: number, replace: string) {
    return src.substring(0, from) + replace + src.substring(to);
}

export function replaceSubstringByPos(src: string, pos: Pos, replace: string) {
    return replaceSubstring(src, pos.start.offset, pos.end.offset, replace);
}

export function isWikilink(link: Reference) {
    return !!link.original.match(/^!?\[\[/);
}

export function isEmbed(link: Reference) {
    return link.original.startsWith('!');
}

export function isHeading(line: string) {
    return /^#{1,6} /.test(line);
}

export function offsetToLoc(editor: Editor, offset: number): Loc {
    const pos = editor.offsetToPos(offset);
    return { line: pos.line, col: pos.ch, offset };
}

export async function createFileIfNotExist(app: App, path: string, data: string): Promise<TFile | null> {
    const file = app.vault.getAbstractFileByPath(path)
        ?? await app.vault.create(path, data);
    if (!(file instanceof TFile)) return null;
    return file;
}

export function isFrontmatterLinkCache(refCache: ReferenceCache | FrontmatterLinkCache): refCache is FrontmatterLinkCache {
    return refCache.hasOwnProperty('key');
}

export function isReferenceCache(refCache: ReferenceCache | FrontmatterLinkCache): refCache is ReferenceCache {
    return refCache.hasOwnProperty('position');
}
