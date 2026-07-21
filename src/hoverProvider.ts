import * as vscode from 'vscode';
import { DiffState } from './state';

/**
 * Hover provider that shows only the changed lines (no context).
 */
export class DiffHoverProvider implements vscode.HoverProvider {
    private state: DiffState;
    static enabled: boolean = true;

    constructor(state: DiffState) {
        this.state = state;
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const ref = this.state.ref;
        if (!ref || !this.state.refValidated) return null;
        if (!DiffHoverProvider.enabled) return null;

        const filePath = document.uri.fsPath;

        const hunkInfo = await this.state.getHunkForLine(filePath, position.line);
        if (!hunkInfo) return null;

        const { hunk, oldLines, newLines, oldStart, newStart } = hunkInfo;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // === Buttons (always on top) ===
        const typeLabel = hunk.type === 'added' ? 'Added' : hunk.type === 'deleted' ? 'Deleted' : 'Modified';
        const lineRangeStr = hunk.type === 'deleted'
            ? `Line ${hunk.newStart}`
            : `Lines ${hunk.newStart}–${hunk.newStart + hunk.newCount - 1}`;
        markdown.appendMarkdown(`**${typeLabel}** — ${lineRangeStr} vs \`${ref}\`  \n`);
        markdown.appendMarkdown(
            `[📂 Open Diff](command:gitRefDiff.openDiff?${encodeURIComponent(JSON.stringify({ filePath, ref }))})`
        );
        markdown.appendMarkdown(
            ` · [↩️ Revert](command:gitRefDiff.revertHunk?${encodeURIComponent(JSON.stringify({ filePath, ref, line: position.line }))})`
        );
        markdown.appendMarkdown(`\n\n---\n\n`);

        // === Diff content below ===
        if (hunk.type === 'added') {
            markdown.appendMarkdown('```diff\n');
            for (let i = 0; i < newLines.length; i++) {
                const lineNum = newStart + i;
                if (lineNum >= hunk.newStart && lineNum < hunk.newStart + hunk.newCount) {
                    markdown.appendMarkdown(`+ ${newLines[i]}\n`);
                }
            }
            markdown.appendMarkdown('```\n');

        } else if (hunk.type === 'deleted') {
            markdown.appendMarkdown('```diff\n');
            for (let i = 0; i < oldLines.length; i++) {
                const lineNum = oldStart + i;
                if (lineNum >= hunk.oldStart && lineNum < hunk.oldStart + hunk.oldCount) {
                    markdown.appendMarkdown(`- ${oldLines[i]}\n`);
                }
            }
            markdown.appendMarkdown('```\n');

        } else {
            // Modified: show old lines (red) then new lines (green)
            markdown.appendMarkdown('```diff\n');
            const oldHunkEnd = hunk.oldStart + hunk.oldCount - 1;
            const newHunkEnd = hunk.newStart + hunk.newCount - 1;

            for (let i = 0; i < oldLines.length; i++) {
                const lineNum = oldStart + i;
                if (lineNum >= hunk.oldStart && lineNum <= oldHunkEnd) {
                    markdown.appendMarkdown(`- ${oldLines[i]}\n`);
                }
            }
            markdown.appendMarkdown('```\n\n```diff\n');
            for (let i = 0; i < newLines.length; i++) {
                const lineNum = newStart + i;
                if (lineNum >= hunk.newStart && lineNum <= newHunkEnd) {
                    markdown.appendMarkdown(`+ ${newLines[i]}\n`);
                }
            }
            markdown.appendMarkdown('```\n');
        }

        return new vscode.Hover(markdown);
    }
}
