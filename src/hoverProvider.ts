import * as vscode from 'vscode';
import { DiffState } from './state';

const CONTEXT_LINES = 3;

/**
 * Hover provider that shows the full hunk diff when hovering over a marked line.
 * Modeled after GitMarginDiff: shows the entire block of changes with +/- markers
 * and surrounding context lines.
 */
export class DiffHoverProvider implements vscode.HoverProvider {
    private state: DiffState;

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

        const filePath = document.uri.fsPath;

        // Get the hunk containing this line
        const hunkInfo = await this.state.getHunkForLine(filePath, position.line);
        if (!hunkInfo) return null;

        const { hunk, oldLines, newLines, oldStart, newStart } = hunkInfo;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // === Header ===
        const typeLabel = hunk.type === 'added' ? 'Added' : hunk.type === 'deleted' ? 'Deleted' : 'Modified';
        const lineRangeStr = hunk.type === 'deleted'
            ? `Line ${hunk.newStart}`
            : `Lines ${hunk.newStart}–${hunk.newStart + hunk.newCount - 1}`;

        markdown.appendMarkdown(`**${typeLabel} block** — ${lineRangeStr} vs \`${ref}\`\n\n`);
        markdown.appendMarkdown(`---\n\n`);

        // === Unified diff body ===
        if (hunk.type === 'added') {
            // Pure addition
            markdown.appendMarkdown('```diff\n');
            const ctxEnd = CONTEXT_LINES;
            for (let i = 0; i < newLines.length; i++) {
                const lineNum = newStart + i;
                const inHunk = lineNum >= hunk.newStart && lineNum < hunk.newStart + hunk.newCount;
                if (inHunk) {
                    markdown.appendMarkdown(`+ ${newLines[i]}\n`);
                } else if (i < ctxEnd) {
                    // Context lines before the hunk
                    markdown.appendMarkdown(`  ${newLines[i]}\n`);
                } else {
                    // Context lines after the hunk
                    markdown.appendMarkdown(`  ${newLines[i]}\n`);
                }
            }
            markdown.appendMarkdown('```\n');

        } else if (hunk.type === 'deleted') {
            // Pure deletion: show what was removed
            markdown.appendMarkdown('```diff\n');
            for (let i = 0; i < oldLines.length; i++) {
                const lineNum = oldStart + i;
                const inHunk = lineNum >= hunk.oldStart && lineNum < hunk.oldStart + hunk.oldCount;
                if (inHunk) {
                    markdown.appendMarkdown(`- ${oldLines[i]}\n`);
                } else {
                    markdown.appendMarkdown(`  ${oldLines[i]}\n`);
                }
            }
            markdown.appendMarkdown('```\n');

            // Show current context at the same position
            if (newLines.length > 0) {
                markdown.appendMarkdown('\n_Current context at this position:_\n\n');
                markdown.appendMarkdown('```\n');
                for (const line of newLines) {
                    markdown.appendMarkdown(`  ${line}\n`);
                }
                markdown.appendMarkdown('```\n');
            }

        } else {
            // Modified: unified diff: context → removed lines → added lines → context
            markdown.appendMarkdown('```diff\n');

            const oldHunkEnd = hunk.oldStart + hunk.oldCount - 1;
            const newHunkEnd = hunk.newStart + hunk.newCount - 1;

            // --- Old side (context before + removed) ---
            for (let i = 0; i < oldLines.length; i++) {
                const lineNum = oldStart + i;
                const inHunk = lineNum >= hunk.oldStart && lineNum <= oldHunkEnd;
                if (inHunk) {
                    markdown.appendMarkdown(`- ${oldLines[i]}\n`);
                } else {
                    markdown.appendMarkdown(`  ${oldLines[i]}\n`);
                }
            }

            // Separator between old and new hunk only if there are
            // non-adjacent context lines (rare)
            const afterCtxOld = Math.max(0, oldLines.length - hunk.oldCount - CONTEXT_LINES);
            const beforeCtxNew = Math.min(newLines.length, CONTEXT_LINES);
            if (afterCtxOld > 0 && beforeCtxNew > 0) {
                // The "new" side starts - but we don't repeat context already shown
            }

            // --- New side (added lines + context after) ---
            // Skip the context-before lines from new side (already shown from old side)
            for (let i = 0; i < newLines.length; i++) {
                const lineNum = newStart + i;
                const inHunk = lineNum >= hunk.newStart && lineNum <= newHunkEnd;
                if (inHunk) {
                    markdown.appendMarkdown(`+ ${newLines[i]}\n`);
                } else if (lineNum < hunk.newStart) {
                    // Context before — skip, already shown from old side
                    continue;
                } else {
                    // Context after — show it
                    markdown.appendMarkdown(`  ${newLines[i]}\n`);
                }
            }

            markdown.appendMarkdown('```\n');
        }

        // === Action buttons ===
        markdown.appendMarkdown(`---\n\n`);

        // Side-by-side diff
        markdown.appendMarkdown(
            `[📂 Open Diff](command:gitRefDiff.openDiff?${encodeURIComponent(JSON.stringify({ filePath, ref }))})`
        );

        // Revert hunk button (always show)
        markdown.appendMarkdown(
            ` · [↩️ Revert Block](command:gitRefDiff.revertHunk?${encodeURIComponent(JSON.stringify({ filePath, ref, line: position.line }))})`
        );

        return new vscode.Hover(markdown);
    }
}
