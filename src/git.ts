import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DiffHunk {
    /** 1-based start line in the NEW (current) file */
    newStart: number;
    /** Number of lines in the new file */
    newCount: number;
    /** 1-based start line in the OLD (reference) file */
    oldStart: number;
    /** Number of lines in the old file */
    oldCount: number;
    type: 'added' | 'modified' | 'deleted';
}

export interface ChangedFile {
    relativePath: string;
    absolutePath: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
}

let _workspaceRoot: string | undefined;

export function setWorkspaceRoot(root: string): void {
    _workspaceRoot = root;
}

export function getWorkspaceRoot(): string | undefined {
    return _workspaceRoot;
}

/**
 * Sanitize a file path for use in git commands.
 * On Windows, converts backslashes to forward slashes.
 */
function gitPath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Get relative path from workspace root, with proper forward slashes.
 */
function getRelativePath(absoluteFilePath: string): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) return undefined;
    const rel = path.relative(cwd, absoluteFilePath);
    return gitPath(rel);
}

/**
 * Execute a git command in the workspace root.
 */
async function git(args: string[], options?: { cwd?: string; maxBuffer?: number }): Promise<string> {
    const cwd = options?.cwd ?? getWorkspaceRoot();
    if (!cwd) throw new Error('No workspace root set');
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
    });
    return stdout;
}

/**
 * List all local branches.
 */
export async function getBranches(): Promise<string[]> {
    try {
        const stdout = await git(['branch', '--format=%(refname:short)']);
        return stdout.trim().split('\n').filter(b => b.length > 0);
    } catch {
        return [];
    }
}

/**
 * List all remote branches.
 */
export async function getRemoteBranches(): Promise<string[]> {
    try {
        const stdout = await git(['branch', '-r', '--format=%(refname:short)']);
        return stdout.trim().split('\n').filter(b => b.length > 0);
    } catch {
        return [];
    }
}

/**
 * List all tags.
 */
export async function getTags(): Promise<string[]> {
    try {
        const stdout = await git(['tag', '--sort=-creatordate']);
        return stdout.trim().split('\n').filter(t => t.length > 0);
    } catch {
        return [];
    }
}

/**
 * Get current branch name.
 */
export async function getCurrentBranch(): Promise<string | undefined> {
    try {
        const stdout = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
        const branch = stdout.trim();
        return branch === 'HEAD' ? undefined : branch;
    } catch {
        return undefined;
    }
}

/**
 * Validate that a git reference exists.
 */
export async function validateRef(ref: string): Promise<boolean> {
    try {
        await git(['rev-parse', '--verify', ref]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the full SHA of a reference.
 */
export async function resolveRef(ref: string): Promise<string | undefined> {
    try {
        const stdout = await git(['rev-parse', ref]);
        return stdout.trim();
    } catch {
        return undefined;
    }
}

/**
 * Parse git diff --unified=0 output to extract hunks.
 */
function parseDiffOutput(diffOutput: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

    for (const line of diffOutput.split('\n')) {
        const match = hunkHeaderRegex.exec(line);
        if (!match) continue;

        const oldStart = parseInt(match[1], 10);
        const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;

        let type: DiffHunk['type'];
        if (oldCount === 0 && newCount > 0) {
            type = 'added';
        } else if (oldCount > 0 && newCount === 0) {
            type = 'deleted';
        } else {
            type = 'modified';
        }

        hunks.push({ oldStart, oldCount, newStart, newCount, type });
    }

    return hunks;
}

/**
 * Get diff hunks between working tree and a reference for a specific file.
 */
export async function getFileDiff(filePath: string, ref: string): Promise<DiffHunk[]> {
    try {
        const stdout = await git(['diff', '--unified=0', ref, '--', gitPath(filePath)]);
        return parseDiffOutput(stdout);
    } catch {
        return [];
    }
}

/**
 * Get the full content of a file at a specific git ref.
 * Returns undefined if the file doesn't exist at that ref.
 * Uses forward-slashed relative path to avoid Windows path issues.
 */
export async function getFileContentAtRef(filePath: string, ref: string): Promise<string | undefined> {
    try {
        const relPath = getRelativePath(filePath);
        if (!relPath) return undefined;
        const stdout = await git(['show', `${ref}:${relPath}`]);
        return stdout;
    } catch {
        return undefined;
    }
}

/**
 * Get changed files between working tree and a reference.
 */
export async function getChangedFiles(ref: string): Promise<ChangedFile[]> {
    try {
        const stdout = await git(['diff', '--name-status', ref]);
        const files: ChangedFile[] = [];
        const cwd = getWorkspaceRoot();
        if (!cwd) return [];

        for (const line of stdout.trim().split('\n')) {
            if (!line) continue;
            const parts = line.split('\t');
            const rawStatus = parts[0].charAt(0);
            const relativePath = parts[parts.length - 1];
            const absolutePath = path.join(cwd, relativePath);

            let status: ChangedFile['status'];
            if (rawStatus === 'A') status = 'added';
            else if (rawStatus === 'D') status = 'deleted';
            else if (rawStatus === 'R') status = 'renamed';
            else status = 'modified';

            files.push({ relativePath, absolutePath, status });
        }
        return files;
    } catch {
        return [];
    }
}

/**
 * Check if a file is tracked by git.
 */
export async function isFileTracked(filePath: string): Promise<boolean> {
    try {
        await git(['ls-files', '--error-unmatch', gitPath(filePath)]);
        return true;
    } catch {
        return false;
    }
}
