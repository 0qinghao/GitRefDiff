import * as vscode from 'vscode';
import { DiffHunk, getFileDiff, getFileContentAtRef, validateRef } from './git';

export interface DecoratedLine {
    /** 0-based line number in the current file */
    line: number;
    type: 'added' | 'modified' | 'deleted';
    /** 0-based line number in the old file (for modified/deleted, may be approximate) */
    oldLine?: number;
    /** The old content for this line (fetched lazily) */
    oldContent?: string;
}

export interface FileDiffInfo {
    hunks: DiffHunk[];
    /** Whether old content has been fetched */
    oldContentLoaded: boolean;
    /** Full old file content */
    oldContent?: string;
}

export class DiffState {
    private _ref: string | undefined;
    private _refValidated: boolean = false;
    private _fileDiffs: Map<string, FileDiffInfo> = new Map();
    private _decoratedLines: Map<string, DecoratedLine[]> = new Map();
    private _changedFiles: string[] = [];
    private _disposables: vscode.Disposable[] = [];
    private _onDidChange = new vscode.EventEmitter<void>();
    private _onDidChangeFiles = new vscode.EventEmitter<string[]>();

    /** Fired when the ref or overall state changes */
    readonly onDidChange = this._onDidChange.event;
    /** Fired when the list of changed files changes */
    readonly onDidChangeFiles = this._onDidChangeFiles.event;

    get ref(): string | undefined {
        return this._ref;
    }

    get refValidated(): boolean {
        return this._refValidated;
    }

    get changedFiles(): string[] {
        return this._changedFiles;
    }

    /**
     * Set the reference to compare against.
     */
    async setRef(ref: string | undefined): Promise<void> {
        this._ref = ref;
        this._refValidated = false;
        this._fileDiffs.clear();
        this._decoratedLines.clear();
        this._changedFiles = [];

        if (ref) {
            this._refValidated = await validateRef(ref);
        }

        this._onDidChange.fire();
        this._onDidChangeFiles.fire([]);
    }

    /**
     * Clear the current reference.
     */
    clear(): void {
        this._ref = undefined;
        this._refValidated = false;
        this._fileDiffs.clear();
        this._decoratedLines.clear();
        this._changedFiles = [];
        this._onDidChange.fire();
        this._onDidChangeFiles.fire([]);
    }

    /**
     * Get diff hunks for a file, computing if necessary.
     */
    async getHunks(filePath: string): Promise<DiffHunk[]> {
        if (!this._ref) return [];

        let info = this._fileDiffs.get(filePath);
        if (!info) {
            const hunks = await getFileDiff(filePath, this._ref);
            info = { hunks, oldContentLoaded: false };
            this._fileDiffs.set(filePath, info);
        }
        return info.hunks;
    }

    /**
     * Get the decorated lines for a file (1:1 mapping from hunks).
     */
    async getDecoratedLines(filePath: string): Promise<DecoratedLine[]> {
        if (!this._ref) return [];

        const cached = this._decoratedLines.get(filePath);
        if (cached) return cached;

        const hunks = await this.getHunks(filePath);
        const lines: DecoratedLine[] = [];

        for (const hunk of hunks) {
            switch (hunk.type) {
                case 'added': {
                    // Added lines: newStart + 0..newCount-1 (0-based: newStart-1 + i)
                    for (let i = 0; i < hunk.newCount; i++) {
                        lines.push({
                            line: hunk.newStart - 1 + i,
                            type: 'added',
                        });
                    }
                    break;
                }
                case 'deleted': {
                    // Deleted: newStart is where deletion happens in the new file
                    // A block of N deleted lines all map to the same position
                    // (the line that now occupies the spot after deletion)
                    const line = Math.max(0, hunk.newStart - 1);
                    lines.push({
                        line,
                        type: 'deleted',
                        oldLine: hunk.oldStart - 1,
                    });
                    break;
                }
                case 'modified': {
                    // Modified: newStart-1..newStart-1+min(newCount,oldCount)-1
                    // Each line maps to oldStart-1 + offset in the old file
                    for (let i = 0; i < hunk.newCount; i++) {
                        lines.push({
                            line: hunk.newStart - 1 + i,
                            type: 'modified',
                            oldLine: i < hunk.oldCount ? hunk.oldStart - 1 + i : undefined,
                        });
                    }
                    break;
                }
            }
        }

        this._decoratedLines.set(filePath, lines);
        return lines;
    }

    /**
     * Get the old file content at the reference for a file.
     */
    async getOldContent(filePath: string): Promise<string | undefined> {
        if (!this._ref) return undefined;

        let info = this._fileDiffs.get(filePath);
        if (!info || !info.oldContentLoaded) {
            const content = await getFileContentAtRef(filePath, this._ref);
            if (!info) {
                const hunks = await getFileDiff(filePath, this._ref);
                info = { hunks, oldContentLoaded: true, oldContent: content };
            } else {
                info.oldContent = content;
                info.oldContentLoaded = true;
            }
            this._fileDiffs.set(filePath, info);
            return content;
        }

        return info.oldContent;
    }

    /**
     * Get the old content for a specific line.
     */
    async getOldLineContent(filePath: string, decoratedLine: DecoratedLine): Promise<string | undefined> {
        if (decoratedLine.type === 'added') return undefined;
        if (decoratedLine.oldLine === undefined) return undefined;

        const oldContent = await this.getOldContent(filePath);
        if (!oldContent) return undefined;

        const lines = oldContent.split('\n');
        if (decoratedLine.oldLine >= 0 && decoratedLine.oldLine < lines.length) {
            return lines[decoratedLine.oldLine];
        }
        return undefined;
    }

    /**
     * Get the hunk that contains a specific line in the current (new) file.
     * Returns the hunk and the old content range lines.
     */
    async getHunkForLine(filePath: string, newLine: number): Promise<{
        hunk: DiffHunk;
        oldLines: string[];
        newLines: string[];
        oldStart: number;   // 1-based start in old file for context
        newStart: number;   // 1-based start in new file for context
    } | undefined> {
        const hunks = await this.getHunks(filePath);
        if (!hunks || hunks.length === 0) return undefined;

        // Find the hunk that contains this line
        const newLine1Based = newLine + 1;
        const hunk = hunks.find(h => {
            if (h.newCount === 0) {
                // Pure deletions: decoration placed at h.newStart - 1 (0-based)
                // The decorated line's 1-based number = h.newStart
                return newLine1Based === h.newStart;
            }
            const start = h.newStart;
            const end = start + h.newCount - 1;
            return newLine1Based >= start && newLine1Based <= end;
        });
        if (!hunk) return undefined;

        // Get old file content
        const oldContent = await this.getOldContent(filePath);
        if (!oldContent) return undefined;
        const oldContentLines = oldContent.split('\n');

        // Get old lines for the hunk with 3 lines of context
        const oldLines: string[] = [];
        const ctxBeforeOld = 3;
        const startOld = Math.max(0, hunk.oldStart - 1 - ctxBeforeOld);
        const endOld = Math.min(oldContentLines.length, hunk.oldStart - 1 + hunk.oldCount + ctxBeforeOld);
        for (let i = startOld; i < endOld; i++) {
            oldLines.push(oldContentLines[i]);
        }

        // Get new lines from the current document
        const doc = vscode.window.activeTextEditor?.document;
        const newLines: string[] = [];
        if (doc && doc.uri.fsPath === filePath) {
            const ctxBeforeNew = 3;
            const lineCount = doc.lineCount;
            let startNew: number;
            let endNew: number;
            if (hunk.newCount === 0) {
                // Deleted: show context around the deletion point
                startNew = Math.max(0, hunk.newStart - 1 - ctxBeforeNew);
                endNew = Math.min(lineCount, hunk.newStart - 1 + ctxBeforeNew);
            } else {
                startNew = Math.max(0, hunk.newStart - 1 - ctxBeforeNew);
                endNew = Math.min(lineCount, hunk.newStart - 1 + hunk.newCount + ctxBeforeNew);
            }
            for (let i = startNew; i < endNew; i++) {
                newLines.push(doc.lineAt(i).text);
            }
        }

        return {
            hunk,
            oldLines,
            newLines,
            oldStart: Math.max(1, hunk.oldStart - ctxBeforeOld),
            newStart: Math.max(1, hunk.newStart - 3),
        };
    }

    /**
     * Invalidate cached diffs for a file (called when file changes).
     */
    invalidateFile(filePath: string): void {
        this._fileDiffs.delete(filePath);
        this._decoratedLines.delete(filePath);
    }

    /**
     * Update the changed files list.
     */
    async refreshChangedFiles(): Promise<void> {
        if (!this._ref) {
            this._changedFiles = [];
            this._onDidChangeFiles.fire([]);
            return;
        }

        try {
            const { getChangedFiles } = await import('./git');
            const files = await getChangedFiles(this._ref);
            this._changedFiles = files.map(f => f.absolutePath);
            this._onDidChangeFiles.fire(this._changedFiles);
        } catch {
            // Ignore errors
        }
    }

    /**
     * Invalidate all cached diffs (called when ref changes or full refresh).
     */
    invalidateAll(): void {
        this._fileDiffs.clear();
        this._decoratedLines.clear();
    }

    dispose(): void {
        this._onDidChange.dispose();
        this._onDidChangeFiles.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}
