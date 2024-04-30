import { BlockSubpathResult, CachedMetadata, Editor, FrontmatterLinkCache, HeadingSubpathResult, LinkCache, Loc, MarkdownView, PaneType, Reference, ReferenceCache, TFile, getLinkpath, parseLinktext, resolveSubpath } from 'obsidian';
import { TransactionSpec, Line } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import BetterNoteComposerPlugin from 'main';
import { BetterNoteComposerComponent, contains, getDisplayText, isEmbed, isFrontmatterLinkCache, isHeading, isReferenceCache, offsetToLoc, replaceSubstringByPos } from 'utils';


export interface InFileRange {
    file: TFile;
    start: Loc;
    end: Loc;
}

export interface ExtractionSpec {
    srcRange: InFileRange;
    dstFile: TFile;
}


export class Extractor extends BetterNoteComposerComponent {
    async extract(srcRange: InFileRange, dstFile: TFile, cm: EditorView, paneType: PaneType | boolean): Promise<void> {
        await new ExtractionTask(this.plugin, { srcRange, dstFile }).process(cm, paneType);
    }

    async extractSelection(srcFile: TFile, editor: Editor, dstFile: TFile, paneType: PaneType | boolean): Promise<void> {
        // @ts-ignore
        const cm: EditorView = editor.cm;
        const srcRange = {
            file: srcFile,
            start: offsetToLoc(editor, cm.state.selection.main.from),
            end: offsetToLoc(editor, cm.state.selection.main.to)
        };

        return this.extract(srcRange, dstFile, cm, paneType);
    }

    async extractHeading(srcFile: TFile, editor: Editor, dstFile: TFile, paneType: PaneType | boolean): Promise<void> {
        // @ts-ignore
        const cm: EditorView = editor.cm;
        const currentLine = cm.state.doc.lineAt(cm.state.selection.main.anchor);

        let currentHeadingLine: Line | null = null;
        for (let i = currentLine.number; i > 0; i--) {
            const line = cm.state.doc.line(i);
            if (isHeading(line.text)) {
                currentHeadingLine = line;
                break;
            }
        }

        let nextHeadingLine: Line | null = null;
        for (let i = currentLine.number + 1; i <= cm.state.doc.lines; i++) {
            const line = cm.state.doc.line(i);
            if (isHeading(line.text)) {
                nextHeadingLine = line;
                break;
            }
        }

        const numLines = cm.state.doc.lines;
        const srcRange = {
            file: srcFile,
            start: currentHeadingLine
                ? offsetToLoc(editor, currentHeadingLine.from)
                : { line: 0, col: 0, offset: 0 },
            end: nextHeadingLine
                ? offsetToLoc(editor, nextHeadingLine.from - 1)
                : { line: numLines - 1, col: cm.state.doc.line(numLines).length, offset: cm.state.doc.length }
        };

        return this.extract(srcRange, dstFile, cm, paneType);
    }
}


export class ExtractionTask extends BetterNoteComposerComponent {
    extraction: ExtractionSpec;

    constructor(plugin: BetterNoteComposerPlugin, extraction: ExtractionSpec) {
        super(plugin);
        this.extraction = extraction;

        if (this.extraction.dstFile.extension !== 'md') {
            throw Error(`${this.plugin.manifest.name}: Cannot extract to non-markdown file`);
        }
    }

    async updateMetadataCache() {
        // @ts-ignore
        return new Promise<void>((resolve) => this.app.metadataCache.onCleanCache(resolve))
    }

    async process(cm: EditorView, paneType: PaneType | boolean) {
        const extractedContent = await this.getExtractedContent();
        await this.updateSrcFile(cm);
        await this.updateBacklinksInOtherFiles();
        await this.openAndAppendToDstFile(extractedContent, paneType);
    }

    async getExtractedContent() {
        let data = await this.app.vault.cachedRead(this.extraction.srcRange.file);
        data = await this.updateOutgoingLinks(data);
        return data;
    }

    async updateOutgoingLinks(data: string): Promise<string> {
        await this.updateMetadataCache();
        const cache = this.app.metadataCache.getFileCache(this.extraction.srcRange.file);
        if (!cache) throw Error(`${this.plugin.manifest.name}: Cache not found for ${this.extraction.srcRange.file.path}`);

        const oldSourcePath = this.extraction.srcRange.file.path;
        const newSourcePath = this.extraction.dstFile.path;

        let endOffset = this.extraction.srcRange.end.offset;

        const links = [...cache.links ?? [], ...cache.embeds ?? []];
        for (const link of links.sort((a, b) => b.position.start.offset - a.position.start.offset)) {
            if (contains(this.extraction.srcRange, link.position)) {
                const newLink = this.updateLinkSource(link, oldSourcePath, newSourcePath);
                if (typeof newLink === 'string') {
                    data = replaceSubstringByPos(data, link.position, newLink);
                    endOffset += newLink.length - link.original.length;
                }
            }
        }

        return data.slice(this.extraction.srcRange.start.offset, endOffset);
    }

    async updateSrcFile(cm: EditorView) {
        const sourcePath = this.extraction.srcRange.file.path;
        const cache = this.app.metadataCache.getCache(sourcePath);
        if (!cache) throw Error(`${this.plugin.manifest.name}: Cache not found for ${sourcePath}$`);

        await this.updateSrcFileFrontmatter(cache);
        this.updateSrcFileContent(cm, cache);
    }

    async updateSrcFileFrontmatter(cache: CachedMetadata) {
        const sourcePath = this.extraction.srcRange.file.path;
        const backlinks = (cache.frontmatterLinks ?? [])
            .filter((link) => {
                const linkpath = getLinkpath(link.link);
                const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
                return targetFile?.path === sourcePath;
            });
        await this.updateBacklinksInFile(backlinks, sourcePath, {
            updateFrontmatter: true,
            updateContent: false,
        });
    }

    updateSrcFileContent(cm: EditorView, cache: CachedMetadata) {
        const sourcePath = this.extraction.srcRange.file.path;

        const links = [...cache.links ?? [], ...cache.embeds ?? []];
        const shouldBeUpdated = (link: ReferenceCache) => {
            const isInExtractedRange = contains(this.extraction.srcRange, link.position);
            if (isInExtractedRange) return false;

            const { targetFile, subpathResult } = this.resolveFullLink(link, sourcePath);
            if (targetFile?.path === sourcePath && subpathResult && this.extractionRangeContainsSubpathTarget(subpathResult)) {
                return true;
            }

            return false;
        };

        const linkUpdateTransactionSpec: TransactionSpec = {
            changes: links
                .filter(shouldBeUpdated)
                .map((link) => {
                    const newLink = this.updateLinkTarget(link, this.extraction.dstFile, sourcePath);
                    return { from: link.position.start.offset, to: link.position.end.offset, insert: newLink }
                })
        };

        let replacement = '';
        const option = this.plugin.getReplacementText();
        if (option !== 'none') {
            const linkToExtraction = this.app.fileManager.generateMarkdownLink(this.extraction.dstFile, sourcePath);
            replacement = option === 'link' ? linkToExtraction : '!' + linkToExtraction;
        }

        const replaceSrcRangeTransactionSpec: TransactionSpec = {
            changes: {
                from: this.extraction.srcRange.start.offset,
                to: this.extraction.srcRange.end.offset,
                insert: replacement,
            }
        };

        cm.dispatch(linkUpdateTransactionSpec, replaceSrcRangeTransactionSpec);
    }

    async updateBacklinksInOtherFiles() {
        // @ts-ignore
        const allBacklinks = this.app.metadataCache.getBacklinksForFile(this.extraction.srcRange.file);
        const promises: Promise<void>[] = [];
        for (const sourcePath of allBacklinks.keys()) {
            if (sourcePath === this.extraction.srcRange.file.path) continue;

            const backlinks: (ReferenceCache | FrontmatterLinkCache)[] = allBacklinks.get(sourcePath) ?? [];
            const promise = this.updateBacklinksInFile(backlinks, sourcePath);
            promises.push(promise);
        }
        await Promise.all(promises);
    }

    async updateBacklinksInFile(backlinks: (ReferenceCache | FrontmatterLinkCache)[], sourcePath: string, options?: { updateFrontmatter: boolean, updateContent: boolean }) {
        options = { updateFrontmatter: true, updateContent: true, ...options };

        const linksToBeUpdated: ReferenceCache[] = [];
        const frontmatterLinksToBeUpdated: FrontmatterLinkCache[] = [];

        const addToQueue = (link: ReferenceCache | FrontmatterLinkCache) => {
            isFrontmatterLinkCache(link) ? frontmatterLinksToBeUpdated.push(link) : linksToBeUpdated.push(link);
        }

        for (const backlink of backlinks) {
            if (isReferenceCache(backlink) && sourcePath === this.extraction.srcRange.file.path && contains(this.extraction.srcRange, backlink.position)) {
                continue;
            }

            const { subpath } = parseLinktext(backlink.link);
            const result = this.resolveBacklinkSubpath(subpath);
            if (result) {
                if (this.extractionRangeContainsSubpathTarget(result)) {
                    addToQueue(backlink);
                }
            }
        }

        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) return;

        if (options.updateContent && linksToBeUpdated.length > 0) {
            await this.app.vault.process(file, (data) => {
                linksToBeUpdated
                    .sort((a, b) => b.position.start.offset - a.position.start.offset)
                    .forEach((backlink) => {
                        const newLink = this.updateLinkTarget(backlink, this.extraction.dstFile, sourcePath);
                        data = replaceSubstringByPos(data, backlink.position, newLink);
                    });
                return data;
            })
        }

        if (options.updateFrontmatter && frontmatterLinksToBeUpdated.length > 0) {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatterLinksToBeUpdated
                    .forEach((backlink) => {
                        const newLink = this.updateLinkTarget(backlink, this.extraction.dstFile, sourcePath);
                        frontmatter[backlink.key] = newLink;
                    });
            });
        }
    }

    updateLinkSource(link: LinkCache, oldSourcePath: string, newSourcePath: string) {
        const { subpath, targetFile, subpathResult } = this.resolveFullLink(link, oldSourcePath);
        if (targetFile) {
            if (targetFile === this.extraction.srcRange.file && subpathResult && this.extractionRangeContainsSubpathTarget(subpathResult)) {
                // targetFile = this.extraction.dstFile;
                return;
            }

            const display = getDisplayText(link);
            let newLink = this.app.fileManager.generateMarkdownLink(targetFile, newSourcePath, subpath, display);
            const embed = isEmbed(link);
            if (embed && newLink.charAt(0) !== '!') newLink = '!' + newLink;
            if (!embed && newLink.charAt(0) === '!') newLink = newLink.slice(1);
            return newLink;
        }
        return null;
    }

    updateLinkTarget(link: Reference, newTargetFile: TFile, sourcePath: string) {
        const { subpath } = parseLinktext(link.link);
        const display = getDisplayText(link);
        const newLink = this.app.fileManager.generateMarkdownLink(newTargetFile, sourcePath, subpath, display);
        return newLink;
    }

    resolveFullLink(link: Reference, sourcePath: string) {
        const { path: linkpath, subpath } = parseLinktext(link.link);
        const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
        const cache = targetFile && this.app.metadataCache.getFileCache(targetFile);
        const subpathResult = cache && resolveSubpath(cache, subpath);
        return { linkpath, subpath, targetFile, subpathResult };
    }

    resolveBacklinkSubpath(subpath: string) {
        const cache = this.app.metadataCache.getFileCache(this.extraction.srcRange.file);
        const subpathResult = cache && resolveSubpath(cache, subpath);
        return subpathResult;
    }

    extractionRangeContainsSubpathTarget(result: HeadingSubpathResult | BlockSubpathResult) {
        return (result.type === 'heading' && contains(this.extraction.srcRange, result.current.position))
            || (result.type === 'block' && contains(this.extraction.srcRange, result.block.position))
    }

    async openAndAppendToDstFile(extractedContent: string, paneType: PaneType | boolean) {
        const leaf = this.app.workspace.getLeaf(paneType);
        await leaf.openFile(this.extraction.dstFile);

        // If possible, use Editor instead of Vault to make it undo-able
        if (leaf.view instanceof MarkdownView) {
            const editor = leaf.view.editor;
            let data = editor.getValue();
            if (data.trimEnd()) data += '\n\n';
            data += extractedContent;
            editor.setValue(data);
        } else {
            await this.app.vault.process(this.extraction.dstFile, (data) => {
                if (data.trimEnd()) data += '\n\n';
                data += extractedContent;
                return data;
            });
        }
    }
}
