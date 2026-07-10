import * as vscode from 'vscode';
import { DiffState, DecoratedLine } from './state';

let addedDecoration: vscode.TextEditorDecorationType | undefined;
let modifiedDecoration: vscode.TextEditorDecorationType | undefined;
let deletedDecoration: vscode.TextEditorDecorationType | undefined;

let addedDecorationDark: vscode.TextEditorDecorationType | undefined;
let modifiedDecorationDark: vscode.TextEditorDecorationType | undefined;
let deletedDecorationDark: vscode.TextEditorDecorationType | undefined;

function getConfig(key: string, defaultValue: string): string {
    const config = vscode.workspace.getConfiguration('gitRefDiff');
    return config.get<string>(key, defaultValue);
}

function createDecoration(
    borderColor: string,
    overviewRulerColor: string,
    isDeleted: boolean = false
): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: !isDeleted,
        borderWidth: '0 0 0 3px',
        borderStyle: 'solid',
        borderColor,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        overviewRulerColor,
        gutterIconPath: undefined,
    });
}

export function createDecorationTypes(): void {
    disposeDecorationTypes();

    const addedColor = getConfig('addedColor', '#4CAF50');
    const modifiedColor = getConfig('modifiedColor', '#E6A817');
    const deletedColor = getConfig('deletedColor', '#F44336');

    // Light theme
    addedDecoration = createDecoration(addedColor, addedColor);
    modifiedDecoration = createDecoration(modifiedColor, modifiedColor);
    deletedDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        borderWidth: '0 0 0 3px',
        borderStyle: 'solid',
        borderColor: deletedColor,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        overviewRulerColor: deletedColor,
    });
}

export function disposeDecorationTypes(): void {
    addedDecoration?.dispose();
    modifiedDecoration?.dispose();
    deletedDecoration?.dispose();
    addedDecorationDark?.dispose();
    modifiedDecorationDark?.dispose();
    deletedDecorationDark?.dispose();

    addedDecoration = undefined;
    modifiedDecoration = undefined;
    deletedDecoration = undefined;
    addedDecorationDark = undefined;
    modifiedDecorationDark = undefined;
    deletedDecorationDark = undefined;
}

/**
 * Apply decorations to an editor based on the diff state.
 */
export async function applyDecorations(
    editor: vscode.TextEditor,
    state: DiffState
): Promise<void> {
    if (!addedDecoration || !modifiedDecoration || !deletedDecoration) {
        createDecorationTypes();
    }

    const filePath = editor.document.uri.fsPath;
    const decoratedLines = await state.getDecoratedLines(filePath);

    const addedRanges: vscode.DecorationOptions[] = [];
    const modifiedRanges: vscode.DecorationOptions[] = [];
    const deletedRanges: vscode.DecorationOptions[] = [];

    const docLineCount = editor.document.lineCount;

    for (const dl of decoratedLines) {
        const rangeLine = dl.line;
        if (rangeLine < 0 || rangeLine >= docLineCount) continue;

        const lineText = editor.document.lineAt(rangeLine).text;

        const range = new vscode.Range(rangeLine, 0, rangeLine, lineText.length);

        if (dl.type === 'deleted') {
            deletedRanges.push({ range });
            continue;
        }

        // added and modified both use full-line decorations

        if (dl.type === 'added') {
            addedRanges.push({ range });
        } else {
            modifiedRanges.push({ range });
        }
    }

    // Apply decorations
    editor.setDecorations(addedDecoration!, addedRanges);
    editor.setDecorations(modifiedDecoration!, modifiedRanges);
    editor.setDecorations(deletedDecoration!, deletedRanges);
}

/**
 * Clear all decorations from an editor.
 */
export function clearDecorations(editor: vscode.TextEditor): void {
    if (addedDecoration) editor.setDecorations(addedDecoration, []);
    if (modifiedDecoration) editor.setDecorations(modifiedDecoration, []);
    if (deletedDecoration) editor.setDecorations(deletedDecoration, []);
}

/**
 * Update decorations on all visible editors.
 */
export async function updateAllEditors(state: DiffState): Promise<void> {
    for (const editor of vscode.window.visibleTextEditors) {
        if (state.ref && editor.document.uri.scheme === 'file') {
            await applyDecorations(editor, state);
        } else {
            clearDecorations(editor);
        }
    }
}
