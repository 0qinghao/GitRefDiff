# Git Ref Diff

> **Compare your working tree against any git reference — in the editor gutter.**

A VS Code extension inspired by the Visual Studio extension [Git Diff Margin](https://github.com/laurentkempe/GitDiffMargin). Pin any commit, branch, or tag and see exactly what's changed, right in the gutter.

## Features

### 📌 Arbitrary Reference Comparison
Compare against **any** git reference — not just the current branch's HEAD:
- Branch names (`main`, `feature/login`)
- Commit SHAs (`a1b2c3d`, full or short)
- Relative references (`HEAD~5`, `main~3`)
- Tags (`v1.0.0`)
- Remote branches (`origin/develop`)

### 🎨 Gutter Indicators
Color-coded left-border markers at a glance:

| Color | Meaning |
|-------|---------|
| Green | Line was **added** after the reference |
| Yellow | Line was **modified** vs the reference |
| Red | Line was **deleted** from the reference |

> Colors match VS Code's built-in diff conventions. All colors are customizable via `gitRefDiff.*Color` settings.

### 🔍 Hover to Preview Full Hunk Diff
Hover over any marked line to see the **complete unified diff block** with context lines — just like `git diff` inline in your editor.

```diff
  // context before
  int a = 1;
- int old = compute(a);
+ int new = compute(a, b);
  int c = a + b;
  // context after
```

### 📂 One-Click Side-by-Side Diff
Click the **Open Side-by-Side Diff** button in the hover popup to open VS Code's full diff view.

### 📋 Copy Original Content
For modified/deleted lines, hover and click **Copy Original** to copy the old version to clipboard.

### ⚡ Real-Time Updates
Gutter indicators update automatically when you:
- Switch between files
- Edit and save the current file
- Switch git references

### 📜 Scrollbar Overview Ruler
Colored markers on the scrollbar show where changes are located across the entire file.

## Usage

1. Click the **`$(git-compare) Git Ref Diff`** button in the bottom status bar
2. Choose from the list of branches, remote branches, tags — or select **Enter commit SHA or reference...** to input anything
3. Gutter indicators appear immediately on all open files
4. **Hover** over any marked line to see the full diff
5. Click **Open Side-by-Side Diff** in the hover popup for VS Code's native diff view

To stop comparing, click the status bar item again and select **Clear** (via `Git Ref Diff: Clear comparison` command).

## Commands

| Command | Description |
|---------|-------------|
| `Git Ref Diff: Select reference to compare against` | Pick a branch, tag, or enter a custom reference |
| `Git Ref Diff: Clear comparison` | Remove all indicators |
| `Git Ref Diff: Open side-by-side diff for current file` | Open VS Code diff panel |
| `Git Ref Diff: Copy old line content to clipboard` | Copy original from the reference |
| `Git Ref Diff: Refresh diff decorations` | Re-fetch and redraw all indicators |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `gitRefDiff.addedColor` | `#4CAF50` | Gutter color for added lines |
| `gitRefDiff.modifiedColor` | `#2196F3` | Gutter color for modified lines |
| `gitRefDiff.deletedColor` | `#F44336` | Gutter color for deleted lines |

## Requirements

- VS Code 1.85+
- Git installed and available on `PATH`

## Why This Extension?

The Visual Studio plugin **Git Diff Margin** provides an incredibly smooth workflow: it shows git changes in the editor margin, and clicking on a change reveals the diff inline. For years, VS Code lacked a direct equivalent — the built-in gutter only compares against `HEAD`, and existing alternatives either didn't support arbitrary references or couldn't show diff content on hover.

**Git Ref Diff** fills this gap. It's designed for:
- **Code reviews**: Pin the base branch and see exactly what your feature branch changed
- **Refactoring**: Keep track of modifications against the original starting point
- **Bug investigation**: Compare current state with a known-good commit
- **Release preparation**: Review all changes since the last release tag

## Limitations

- Binary files are not highlighted (git limitation)
- Large repositories may experience slight delays when switching references
- Only the first workspace folder is used in multi-root workspaces
- Gutter indicators for deletions show on the line where the deletion occurred (no visual space is consumed for removed lines)

## License

MIT
