# vulyk 🐝

> вулик — *hive* in Ukrainian

**vulyk** is a package manager for AI agent skills. Install, update, and sync skills across your projects — the same way you manage npm packages.

---

## Install

```sh
npm install -g vulyk
```

---

## Concepts

**Skills** are reusable instruction sets for AI agents (Claude, Codex, etc.). Each skill lives in its own directory with a `SKILL.md` file describing what it does.

**vulyk** fetches skills from GitHub, pins them to a commit, and tracks them in `vulyk.json` — like `package.json` but for agent behavior.

---

## Quick start

```sh
cd my-project
vulyk init
vulyk add nicobailon/visual-explainer/plugins/visual-explainer
vulyk docs
```

---

## Commands

### `vulyk init`
Creates a `vulyk.json` in the current directory.

### `vulyk add <specifier>`
Installs a skill from GitHub.

```sh
vulyk add owner/repo/path/to/skill
vulyk add https://github.com/owner/repo/tree/main/skills/my-skill
vulyk add owner/repo/path@main --name my-skill   # override name
```

Pins to the latest commit at install time.

### `vulyk remove <name>`
Removes a skill and cleans up `.gitignore`.

### `vulyk enable <name>` / `vulyk disable <name>`
Toggles a skill on/off without removing it.

### `vulyk list`
Lists all installed skills and their status.

```
  ✔ visual-explainer   9a97a58   nicobailon/visual-explainer
  ✔ audit-scope        (local)
```

### `vulyk diff [name]`
Shows what would change if you ran `update`. Safe to run anytime — nothing is modified.

```
  visual-explainer 9a97a58 → 3f2c1a0
    SKILL.md | 3 ++-
    commands/generate-web-diagram.md | 1 +
    2 files changed, 3 insertions(+), 1 deletion(-)

  doc:project-structure up to date (c66ea06)
```

### `vulyk update [name]`
Updates skills and external docs to their latest commits. Bumps pinned hashes in `vulyk.json`.

```sh
vulyk update                  # update everything
vulyk update visual-explainer # update one skill
```

### `vulyk sync`
Reinstalls all enabled skills from `vulyk.json`. Useful after cloning a repo or switching branches.

```sh
git clone ...
vulyk sync
```

### `vulyk docs`
Scans your `docs/` folder for markdown files with `paths` frontmatter and generates `AGENTS.md` files at those paths.

```sh
vulyk docs
vulyk docs --also CLAUDE.md   # also generate CLAUDE.md import files
```

Each doc file needs frontmatter:

```md
---
paths:
  - src
  - src/features
description: API route conventions and patterns.
---
```

### `vulyk doc-add <url>`
Fetches an external markdown doc from GitHub and tracks it in `vulyk.json`.

```sh
vulyk doc-add "https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md" \
  --targets src \
  --description "Project structure conventions."
```

Stored in `docs/external/`, gitignored, included in `vulyk docs` output.

---

## vulyk.json

```json
{
  "paths": {
    "skills": [".claude/skills"],
    "docs": ["docs/external"]
  },
  "skills": {
    "visual-explainer": "nicobailon/visual-explainer/plugins/visual-explainer@9a97a58..."
  },
  "docs": {
    "project-structure": {
      "source": "https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md@c66ea06...",
      "targets": ["src"],
      "description": "Project structure conventions and patterns."
    }
  }
}
```

---

## Skill specifier format

```
owner/repo/path/to/skill@commitHash
```

- No `@` → resolves to `HEAD` of the default branch
- `@main` / `@v1.0.0` → branch or tag
- `@abc123f` → pinned commit (what vulyk stores after `add` or `update`)

Full GitHub URLs (`https://github.com/...`) are also accepted.

---

## How skills are tracked

- Each installed skill gets a `.vulyk` marker file inside its directory
- Root `.gitignore` is auto-updated with managed skill paths and `**/AGENTS.md` / `**/CLAUDE.md` globs
- Local skills (no `.vulyk` marker) are never touched by `sync` or `remove`

---

## License

MIT
