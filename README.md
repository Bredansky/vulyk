# vulyk

> :bee: vulyk means _hive_ in Ukrainian

`vulyk` is a lightweight, spec-driven package manager for AI agent skills, external agent docs, and generated `AGENTS.md` files. It installs skills from versioned sources or direct URLs, syncs them across clones, and keeps agent context reproducible.

## :package: Install

```sh
npm install -g vulyk
```

## :zap: Quick start

```sh
cd my-project
vulyk init
vulyk add nicobailon/visual-explainer/plugins/visual-explainer
vulyk doc-add "https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md" \
  --targets src \
  --description "Project structure conventions."
vulyk sync
```

## :hammer_and_wrench: Commands

### `vulyk init`

Creates a `vulyk.json` in the current directory.

### `vulyk add <specifier>`

Adds a skill from a configured source, installs it into every `skills.outputPaths` entry, and stores the source in `skills.entries`.

```sh
vulyk add owner/repo/path/to/skill
vulyk add owner/repo/path/to/skill@main
vulyk add https://github.com/owner/repo/tree/main/skills/my-skill
vulyk add owner/repo/path --name my-skill
```

If the path contains multiple skills, all detected skills are installed.

### `vulyk remove <name>`

Removes a managed skill and deletes it from `skills.entries`.

### `vulyk enable <name>` / `vulyk disable <name>`

Toggles a skill on or off without removing it. This uses the optional `skills.enabled` whitelist.

### `vulyk list`

Lists installed skills, external docs, and configured paths.

### `vulyk diff [name]`

Shows what would change if you ran `update`.

### `vulyk update [name]`

Updates git-backed skills and docs to the latest commit reachable from their configured ref. Direct URL sources are refreshed in place.

### `vulyk doc-add <url>`

Tracks an external markdown doc in `docs.entries`.

```sh
vulyk doc-add "https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md" \
  --targets src \
  --description "Project structure conventions."
```

### `vulyk docs`

Scans local docs and synced external docs for frontmatter with `paths` and `description`, then generates `AGENTS.md` at the corresponding target paths.

```sh
vulyk docs
vulyk docs --also CLAUDE.md
```

By default it uses `docs.also` from `vulyk.json`, so alias files are reproducible without passing flags every time.

### `vulyk docs-for <file>`

Prints JSON for tracked docs that apply to a specific file. This is useful when a skill or review workflow wants to answer "which docs should I compare this file against?"

```sh
vulyk docs-for .claude/hooks/context-statusline.ts
vulyk docs-for src/features/editor/poster.tsx
```

It matches:

- local docs with frontmatter `paths`
- external docs declared in `docs.entries`
- exact file targets and directory targets

### `vulyk sync`

The `npm install` for this manifest. It syncs skills, syncs external docs, and regenerates `AGENTS.md` plus aliases from `docs.also`.

## :memo: Local docs

Local docs need frontmatter:

```md
---
paths:
  - src
  - src/features
description: API route conventions and patterns.
---
```

Generated `AGENTS.md` includes the doc title, description, and a pointer to the full markdown file.

## :receipt: `vulyk.json`

```json
{
  "skills": {
    "outputPaths": ["skills"],
    "enabled": ["visual-explainer"],
    "entries": {
      "visual-explainer": {
        "source": "nicobailon/visual-explainer/plugins/visual-explainer@9a97a58..."
      }
    }
  },
  "docs": {
    "localPaths": ["docs"],
    "outputPaths": ["docs/external"],
    "also": ["CLAUDE.md"],
    "entries": {
      "project-structure": {
        "source": "https://github.com/alan2207/bulletproof-react/blob/c66ea06.../docs/project-structure.md",
        "targets": ["src"],
        "description": "Project structure conventions and patterns."
      }
    }
  }
}
```

| Field                   | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `skills.outputPaths`    | Directories where managed skills are installed  |
| `skills.enabled`        | Optional whitelist of enabled skills            |
| `skills.entries.<name>` | Skill source metadata                           |
| `docs.localPaths`       | Local doc roots scanned for frontmatter paths   |
| `docs.outputPaths`      | Directories for synced external docs            |
| `docs.also`             | Alias files to regenerate alongside `AGENTS.md` |
| `docs.entries`          | External docs plus target metadata              |

## :link: Specifier format

| Format                                            | Resolves to                |
| ------------------------------------------------- | -------------------------- |
| `owner/repo/path`                                 | HEAD of the default branch |
| `owner/repo/path@main`                            | A branch or tag            |
| `owner/repo/path@abc123f`                         | A pinned commit            |
| `https://github.com/owner/repo/tree/<commit>/...` | An immutable GitHub tree   |
| `https://github.com/owner/repo/blob/<commit>/...` | An immutable GitHub blob   |
| `https://github.com/owner/repo/tree/branch/path`  | A GitHub URL               |
| `https://example.com/file.md`                     | A direct markdown URL      |
| `https://example.com/archive.zip`                 | A direct archive URL       |

Git-backed sources are pinned to commits during `add`, `sync`, and `update`. Direct URLs remain unchanged and are refreshed as-is.

## :broom: How managed files work

- Each installed skill gets a `.vulyk` marker file.
- Root `.gitignore` is updated with skill/doc paths and generated alias globs.
- Local skills without a `.vulyk` marker are never removed by `sync`.
- External docs are normalized with frontmatter during sync so local and remote docs behave the same way.

## :page_facing_up: License

MIT
