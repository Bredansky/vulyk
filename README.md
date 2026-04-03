# vulyk

> vulyk means _hive_ in Ukrainian

`vulyk` is a package manager for AI agent skills and docs. It installs skills from GitHub, pins them to immutable commit URLs, syncs them across clones, fetches external markdown docs, and generates `AGENTS.md` plus optional alias files.

## Install

```sh
npm install -g vulyk
```

## Quick start

```sh
cd my-project
vulyk init
vulyk add nicobailon/visual-explainer/plugins/visual-explainer
vulyk doc-add "https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md" \
  --targets src \
  --description "Project structure conventions."
vulyk sync
```

## Commands

### `vulyk init`

Creates a `vulyk.json` in the current directory.

### `vulyk add <specifier>`

Adds a skill from GitHub, installs it into `skills.path`, and pins the commit in `skills.entries`.

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

Updates pinned skills and docs to the latest commit reachable from their configured ref.

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

### `vulyk sync`

The `npm install` for this manifest. It syncs skills, syncs external docs, and regenerates `AGENTS.md` plus aliases from `docs.also`.

## Local docs

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

## `vulyk.json`

```json
{
  "skills": {
    "path": "skills",
    "enabled": ["visual-explainer"],
    "entries": {
      "visual-explainer": "nicobailon/visual-explainer/plugins/visual-explainer@9a97a58..."
    }
  },
  "docs": {
    "path": "docs/external",
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

| Field            | Description                                     |
| ---------------- | ----------------------------------------------- |
| `skills.path`    | Directory where managed skills are installed    |
| `skills.enabled` | Optional whitelist of enabled skills            |
| `skills.entries` | Installed skills pinned to a commit             |
| `docs.path`      | Directory for synced external docs              |
| `docs.also`      | Alias files to regenerate alongside `AGENTS.md` |
| `docs.entries`   | External docs pinned to a commit                |

## Specifier format

| Format                                            | Resolves to                |
| ------------------------------------------------- | -------------------------- |
| `owner/repo/path`                                 | HEAD of the default branch |
| `owner/repo/path@main`                            | A branch or tag            |
| `owner/repo/path@abc123f`                         | A pinned commit            |
| `https://github.com/owner/repo/tree/<commit>/...` | An immutable GitHub tree   |
| `https://github.com/owner/repo/blob/<commit>/...` | An immutable GitHub blob   |
| `https://github.com/owner/repo/tree/branch/path`  | A GitHub URL               |

Pinned GitHub URLs are rewritten to real immutable `tree/<commit>` or `blob/<commit>` links during `add`, `sync`, and `update`, so manifest entries stay clickable.

## How managed files work

- Each installed skill gets a `.vulyk` marker file.
- Root `.gitignore` is updated with skill/doc paths and generated alias globs.
- Local skills without a `.vulyk` marker are never removed by `sync`.
- External docs are normalized with frontmatter during sync so local and remote docs behave the same way.

## License

MIT
