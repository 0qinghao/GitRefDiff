import * as vscode from 'vscode';
import * as path from 'path';
import { DiffState } from './state';
import { createDecorationTypes, disposeDecorationTypes, applyDecorations, clearDecorations, updateAllEditors } from './decorator';
import { DiffHoverProvider } from './hoverProvider';
import {
    getWorkspaceRoot,
    setWorkspaceRoot,
    getBranches,
    getRemoteBranches,
    getTags,
    getCurrentBranch,
    getFileContentAtRef,
    getChangedFiles,
} from './git';

let state: DiffState;
let statusBarItem: vscode.StatusBarItem;
let disposables: vscode.Disposable[] = [];
let hoverDisposable: vscode.Disposable | undefined;
let debounceTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
    state = new DiffState();

    // Set workspace root
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) {
        setWorkspaceRoot(root);
    }

    // Create decoration types
    createDecorationTypes();

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.command = 'gitRefDiff.pickRef';
    statusBarItem.text = '$(git-compare) Git Ref Diff';
    statusBarItem.tooltip = 'Click to select a reference to compare against';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Update status bar when state changes
    state.onDidChange(() => {
        updateStatusBar();
    });

    // Register hover provider
    registerHoverProvider();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('gitRefDiff.pickRef', pickRef),
        vscode.commands.registerCommand('gitRefDiff.clearRef', clearRef),
        vscode.commands.registerCommand('gitRefDiff.openDiff', openDiff),
        vscode.commands.registerCommand('gitRefDiff.copyOldContent', copyOldContent),
        vscode.commands.registerCommand('gitRefDiff.refresh', refresh),
    );

    // Listen for active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor && state.ref) {
                debouncedUpdate(editor);
            }
        })
    );

    // Listen for document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === event.document && state.ref) {
                // Invalidate cache for this file
                state.invalidateFile(editor.document.uri.fsPath);
                debouncedUpdate(editor);
            }
        })
    );

    // Listen for document saves
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (state.ref) {
                state.invalidateFile(document.uri.fsPath);
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === document) {
                    await applyDecorations(editor, state);
                }
            }
        })
    );

    // Listen for workspace folder changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (newRoot) {
                setWorkspaceRoot(newRoot);
                state.clear();
                updateAllEditors(state);
            }
        })
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('gitRefDiff')) {
                createDecorationTypes();
                if (state.ref) {
                    updateAllEditors(state);
                }
            }
        })
    );

    // Initial update on the active editor
    if (vscode.window.activeTextEditor) {
        debouncedUpdate(vscode.window.activeTextEditor);
    }

    // Cleanup
    context.subscriptions.push({
        dispose: () => {
            disposeDecorationTypes();
            state.dispose();
            if (debounceTimer) clearTimeout(debounceTimer);
        }
    });
}

function registerHoverProvider(): void {
    hoverDisposable?.dispose();
    hoverDisposable = vscode.languages.registerHoverProvider(
        { pattern: '**' },
        new DiffHoverProvider(state)
    );
}

function updateStatusBar(): void {
    if (state.ref) {
        statusBarItem.text = `$(git-compare) Diff: ${state.ref}`;
        statusBarItem.tooltip = `Comparing against \`${state.ref}\`. Click to change.`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(git-compare) Git Ref Diff';
        statusBarItem.tooltip = 'Click to select a reference to compare against';
        statusBarItem.backgroundColor = undefined;
    }
}

function debouncedUpdate(editor: vscode.TextEditor): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
        if (editor && state.ref) {
            await applyDecorations(editor, state);
        }
    }, 200);
}

/**
 * Command: Pick a reference to compare against.
 */
async function pickRef(): Promise<void> {
    try {
        // Fetch branches and tags
        const [branches, remoteBranches, tags, currentBranch] = await Promise.all([
            getBranches(),
            getRemoteBranches(),
            getTags(),
            getCurrentBranch(),
        ]);

        const items: vscode.QuickPickItem[] = [];

        // Option: enter custom reference
        items.push({
            label: '$(symbol-key) Enter commit SHA or reference...',
            description: 'e.g. a1b2c3d, HEAD~5, v1.0.0',
            alwaysShow: true,
        });

        // Separator: branches
        if (branches.length > 0) {
            items.push({ label: 'Local Branches', kind: vscode.QuickPickItemKind.Separator });
            for (const b of branches) {
                const isCurrent = b === currentBranch;
                items.push({
                    label: `${isCurrent ? '$(git-branch)' : '$(git-branch)'} ${b}`,
                    description: isCurrent ? '(current)' : undefined,
                });
            }
        }

        if (remoteBranches.length > 0) {
            items.push({ label: 'Remote Branches', kind: vscode.QuickPickItemKind.Separator });
            for (const b of remoteBranches) {
                items.push({
                    label: `$(remote) ${b}`,
                });
            }
        }

        if (tags.length > 0) {
            items.push({ label: 'Tags', kind: vscode.QuickPickItemKind.Separator });
            for (const t of tags) {
                items.push({
                    label: `$(tag) ${t}`,
                });
            }
        }

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a branch, tag, or enter a custom reference to compare against',
            matchOnDescription: true,
        });

        if (!picked) return;

        let ref: string;

        if (picked.label.startsWith('$(symbol-key)')) {
            // Ask user to enter a custom reference
            const customRef = await vscode.window.showInputBox({
                prompt: 'Enter a git reference (commit SHA, HEAD~N, tag, etc.)',
                placeHolder: 'e.g., a1b2c3d, HEAD~5, v1.0.0',
                validateInput: async (value) => {
                    if (!value.trim()) return 'Reference cannot be empty';
                    return undefined;
                },
            });
            if (!customRef) return;
            ref = customRef.trim();
        } else {
            // Extract the ref from the label (remove icon prefix)
            const parts = picked.label.split(' ');
            ref = parts.slice(1).join(' ').trim();
        }

        await state.setRef(ref);
        await state.refreshChangedFiles();

        // Update all editors
        await updateAllEditors(state);

        // Show summary
        const changedFiles = state.changedFiles;
        if (changedFiles.length > 0) {
            vscode.window.showInformationMessage(
                `Git Ref Diff: comparing against \`${ref}\` — ${changedFiles.length} file(s) changed`,
                'View Changes'
            );
        } else {
            vscode.window.showInformationMessage(
                `Git Ref Diff: comparing against \`${ref}\` — no changes detected`
            );
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Git Ref Diff: Failed to set reference: ${msg}`);
    }
}

/**
 * Command: Clear the current reference.
 */
async function clearRef(): Promise<void> {
    state.clear();
    await updateAllEditors(state);
    vscode.window.showInformationMessage('Git Ref Diff: Comparison cleared.');
}

/**
 * Command: Open side-by-side diff for the current file.
 */
async function openDiff(args?: { filePath?: string; ref?: string }): Promise<void> {
    const ref = args?.ref ?? state.ref;
    if (!ref) {
        vscode.window.showInformationMessage('No reference selected. Use "Git Ref Diff: Select reference" first.');
        return;
    }

    const filePath = args?.filePath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
        vscode.window.showInformationMessage('No active editor.');
        return;
    }

    try {
        const oldContent = await getFileContentAtRef(filePath, ref);
        if (oldContent === undefined) {
            vscode.window.showInformationMessage(`File does not exist on the selected reference (${ref}).`);
            return;
        }

        const cwd = getWorkspaceRoot();
        if (!cwd) return;

        const relativePath = path.relative(cwd, filePath);
        const branchUri = vscode.Uri.parse(
            `gitrefdiff:${relativePath}?ref=${encodeURIComponent(ref)}&ts=${Date.now()}`
        );

        // Register a content provider for the old version
        const registration = vscode.workspace.registerTextDocumentContentProvider('gitrefdiff', {
            provideTextDocumentContent: (_uri: vscode.Uri) => oldContent,
        });

        await vscode.commands.executeCommand(
            'vscode.diff',
            branchUri,
            vscode.Uri.file(filePath),
            `${relativePath} (${ref} ↔ Working Tree)`
        );

        // Clean up content provider after a delay
        setTimeout(() => registration.dispose(), 10000);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Git Ref Diff: Failed to open diff: ${msg}`);
    }
}

/**
 * Command: Copy old line content to clipboard.
 */
async function copyOldContent(args?: { filePath?: string; line?: number }): Promise<void> {
    const filePath = args?.filePath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    const lineNo = args?.line ?? vscode.window.activeTextEditor?.selection.active.line;

    if (!filePath || lineNo === undefined || !state.ref) {
        return;
    }

    const decoratedLines = await state.getDecoratedLines(filePath);
    const dl = decoratedLines.find(d => d.line === lineNo);
    if (!dl) {
        vscode.window.showInformationMessage('No diff data at this line.');
        return;
    }

    const oldContent = await state.getOldLineContent(filePath, dl);
    if (oldContent === undefined) {
        vscode.window.showInformationMessage('Could not retrieve original content.');
        return;
    }

    await vscode.env.clipboard.writeText(oldContent);
    vscode.window.showInformationMessage('Original content copied to clipboard.');
}

/**
 * Command: Refresh all diff data.
 */
async function refresh(): Promise<void> {
    if (!state.ref) {
        vscode.window.showInformationMessage('No reference selected.');
        return;
    }

    state.invalidateAll();
    await state.refreshChangedFiles();
    await updateAllEditors(state);
    vscode.window.showInformationMessage(`Git Ref Diff: Refreshed comparison against \`${state.ref}\`.`);
}

export function deactivate(): void {
    disposeDecorationTypes();
    state.dispose();
    if (debounceTimer) clearTimeout(debounceTimer);
    disposables.forEach(d => d.dispose());
}
