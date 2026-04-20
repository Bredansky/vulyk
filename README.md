# vulyk

> :bee: vulyk means _hive_ in Ukrainian

`vulyk` is a lightweight, spec-driven package manager for AI agent skills, tracked docs, and generated `AGENTS.md` files. It installs skills from local paths or remote sources, syncs them across clones, and keeps agent context reproducible.

This repo can also host canonical skills under `skills/` that projects consume via pinned GitHub `tree/<commit>` URLs.

## :package: Install

```sh
npm install -g vulyk
```

## :zap: Quick start

```sh
cd my-project
vulyk init
vulyk add "https://github.com/nicobailon/visual-explainer/tree/main/plugins/visual-explainer"
vulyk doc-add "https://github.com/alan2207/bulletproof-react/blob/main/docs/project-structure.md" \
  --targets src \
  --description "Project structure conventions."
vulyk sync
```

## :hammer_and_wrench: Commands

### `vulyk init`

Creates a `vulyk.json` in the current directory.

### `vulyk add <specifier>`

Adds a skill from a local path or remote source, installs it into every `skills.outputPaths` entry, and stores the normalized source in `skills.entries`. GitHub sources are pinned to commits.

```sh
vulyk add ./skills/my-local-skill
vulyk add ./skills/my-pack
vulyk add https://github.com/owner/repo/tree/main/skills/my-skill
vulyk add https://github.com/owner/repo/tree/main/skills/my-skill --name my-skill
vulyk add https://example.com/my-skill.zip
```

If the path contains multiple skills, all detected skills are installed. Local sources are stored as repo-relative paths.

### `vulyk remove <name>`

Removes a managed skill and deletes it from `skills.entries`.

### `vulyk skill-output-add <path>` / `vulyk skill-output-remove <path>`

Adds or removes a path in `skills.outputPaths`.

```sh
vulyk skill-output-add .claude/skills
vulyk skill-output-add skills
vulyk skill-output-remove .claude/skills
```

### `vulyk enable <name>` / `vulyk disable <name>`

Toggles a skill on or off without removing it. This uses the optional `skills.enabled` whitelist.

### `vulyk list`

Lists installed skills, tracked docs, and configured paths.

### `vulyk diff [name]`

Shows what would change if you ran `update`.

### `vulyk update [name]`

Updates remote git-backed skills and docs to the latest commit reachable from their configured ref. Direct URL sources are refreshed in place. Local skills are refreshed from disk.

### `vulyk doc-add <url>`

Tracks an external markdown doc in `docs.entries`.

```sh
vulyk doc-add "https://github.com/alan2207/bulletproof-react/blob/main/docs/project-structure.md" \
  --targets src \
  --description "Project structure conventions."
```

### `vulyk doc-remove <name>`

Removes a tracked doc from `docs.entries`.

```sh
vulyk doc-remove claude-statusline
```

### `vulyk doc-rule-set <name>` / `vulyk doc-rule-remove <name>`

Creates, replaces, or removes a rule in `docs.rules`.

```sh
vulyk doc-rule-set claude \
  --match ".claude/**" \
  --output-paths docs/external \
  --also CLAUDE.md
vulyk doc-rule-remove claude
```

### `vulyk docs`

Generates `AGENTS.md` from tracked docs in `docs.entries`.

```sh
vulyk docs
vulyk docs --also CLAUDE.md
```

This uses `docs.rules` to determine where generated aliases should appear and whether generated files should be gitignored.
Targets without a matching rule fall back to `docs/external`, no aliases, and gitignored generated files.

### `vulyk docs-for <file>`

Prints JSON for tracked docs that apply to a specific file. This is useful when a skill or review workflow wants to answer "which docs should I compare this file against?"

```sh
vulyk docs-for .claude/hooks/context-statusline.cjs
vulyk docs-for src/features/editor/poster.tsx
```

It matches:

- local docs declared in `docs.entries`
- external docs declared in `docs.entries`
- exact file targets and directory targets

### `vulyk targets-for <doc>`

Prints JSON for tracked targets declared by a specific doc. This is useful when a doc changes and you want to know which files or folders may need review.

```sh
vulyk targets-for docs/agent-hooks.md
vulyk targets-for docs/external/claude-statusline.md
```

It returns:

- the declared `targets` from `docs.entries`
- target kinds for each path: `directory`, `file`, or `glob`

### `vulyk sync`

The `npm install` for this manifest. It syncs local and remote skills, syncs remote docs into rule-selected output paths, and regenerates `AGENTS.md` plus aliases.

## :receipt: `vulyk.json`

```json
{
  "skills": {
    "outputPaths": ["skills"],
    "enabled": ["visual-explainer"],
    "entries": {
      "visual-explainer": {
        "source": "https://github.com/nicobailon/visual-explainer/tree/9a97a58.../plugins/visual-explainer"
      },
      "my-local-skill": {
        "source": "skills/my-local-skill"
      }
    }
  },
  "docs": {
    "rules": {
      "claude": {
        "match": [".claude/**"],
        "outputPaths": ["docs/external"],
        "also": ["CLAUDE.md"]
      }
    },
    "entries": {
      "api-routes": {
        "source": "docs/api-routes.md",
        "targets": ["src/app/api"],
        "description": "API route conventions and patterns."
      },
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
| `skills.entries.<name>` | Local or remote skill source metadata           |
| `docs.rules`            | Optional path-scoped output and alias overrides |
| `docs.entries`          | Local and external docs plus target metadata    |

## :link: Specifier format

| Format                                         | Resolves to               |
| ---------------------------------------------- | ------------------------- |
| `./skills/my-skill`                            | A local skill directory   |
| `./skills/my-pack`                             | A local skill collection  |
| `https://github.com/owner/repo/tree/<ref>/...` | A GitHub-backed tree path |
| `https://github.com/owner/repo/blob/<ref>/...` | A GitHub-backed file path |
| `https://example.com/file.md`                  | A direct markdown URL     |
| `https://example.com/archive.zip`              | A direct archive URL      |

GitHub-backed remote sources in `vulyk.json` must use commit-pinned `blob` or `tree` URLs. During `add`, `sync`, and `update`, GitHub sources are normalized to pinned commit URLs. Local sources are stored as repo-relative paths.

## :broom: How managed files work

- Each installed skill gets a `.vulyk` marker file.
- Root `.gitignore` is updated with skill paths and generated doc files that are configured to be ignored.
- Local skills without a `.vulyk` marker are never removed by `sync`.
- Local skills are installed directly from their source directories, while remote skills are fetched into managed outputs.
- If a local skill already lives under one of the configured `skills.outputPaths`, Vulyk preserves that source directory in place instead of copying it into itself or gitignoring it.
- Local docs are referenced directly from the manifest, while remote docs are materialized into the matched rule's `outputPaths`.

## :page_facing_up: License

MIT
