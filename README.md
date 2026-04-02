# vulyk 🐝

> вулик — _hive_ in Ukrainian

**vulyk** is a package manager for AI agent skills. Install skills from GitHub, pin them to a commit, keep them in sync — the same way you manage npm packages.

---

## Install

```sh
npm install -g vulyk
```

---

## Quick start

```sh
cd my-project
vulyk init
vulyk add nicobailon/visual-explainer/plugins/visual-explainer
vulyk docs
```

---

## vulyk.json

Everything is tracked in `vulyk.json` at the project root:

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

- `paths.skills` — directories where skills are installed
- `paths.docs` — directory where external docs are stored (default: `docs/external`)
- `skills` — installed skills, pinned to a commit hash
- `docs` — external markdown docs fetched from GitHub
- `enabled` — optional whitelist of active skills (omit to enable all)

---

## Commands

### `vulyk init`

Creates a `vulyk.json` in the current directory.

### `vulyk add <specifier>`

Fetches a skill from GitHub, installs it, and pins the commit in `vulyk.json`.

```sh
vulyk add owner/repo/path/to/skill
vulyk add owner/repo/path/to/skill@main
vulyk add https://github.com/owner/repo/tree/main/skills/my-skill
vulyk add owner/repo/path --name my-skill
```

If the path points to a directory containing multiple skills (each with a `SKILL.md`), all of them are installed.

### `vulyk remove <name>`

Removes a skill and cleans up `.gitignore`.

### `vulyk enable <name>` / `vulyk disable <name>`

Toggles a skill on/off without removing it. Requires an `enabled` whitelist in `vulyk.json`.

### `vulyk list`

Lists installed skills and external docs with their pinned versions and paths.

### `vulyk diff [name]`

Shows what would change if you ran `update`. Nothing is modified.

```
  visual-explainer 9a97a58 → 3f2c1a0
    SKILL.md | 3 ++-
    2 files changed, 3 insertions(+), 1 deletion(-)

  doc:project-structure up to date (c66ea06)
```

### `vulyk update [name]`

Updates skills and external docs to their latest commits, bumps pinned hashes in `vulyk.json`.

```sh
vulyk update                   # update everything
vulyk update visual-explainer  # update one skill
```

### `vulyk sync`

Reinstalls all enabled skills from `vulyk.json`. Run this after cloning a repo.

```sh
git clone ...
vulyk sync
```

### `vulyk docs`

Scans `docs/` for markdown files with `paths` and `description` frontmatter, and generates `AGENTS.md` files at those paths. Also includes external docs from `vulyk.json`.

```sh
vulyk docs
vulyk docs --also CLAUDE.md   # also write CLAUDE.md import files
```

Doc files need frontmatter:

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

## Specifier format

```
owner/repo/path/to/skill@commitHash
```

| Format                                           | Resolves to                                 |
| ------------------------------------------------ | ------------------------------------------- |
| `owner/repo/path`                                | HEAD of default branch                      |
| `owner/repo/path@main`                           | branch or tag                               |
| `owner/repo/path@abc123f`                        | pinned commit (stored after `add`/`update`) |
| `https://github.com/owner/repo/tree/branch/path` | GitHub URL                                  |

---

## How skills are tracked

- Each installed skill gets a `.vulyk` marker file inside its directory — this distinguishes managed skills from local ones
- Root `.gitignore` is auto-updated with skill paths and `**/AGENTS.md` / `**/CLAUDE.md` globs
- Local skills (no `.vulyk` marker) are never touched by `sync` or `remove`
- Skill name is read from `SKILL.md` frontmatter (`name:` field) if present, otherwise derived from the specifier

---

## License

MIT
