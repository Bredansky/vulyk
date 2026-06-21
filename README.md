# vulyk

> :bee: vulyk means _hive_ in Ukrainian

`vulyk` is a lightweight, spec-driven package manager for AI agent skills, tracked docs, and generated `AGENTS.md` files. It installs skills from local paths or remote sources, keeps agent context reproducible, and stays out of your way.

This repo can also host canonical skills under `skills/` that projects consume via pinned GitHub `tree/<commit>` URLs.

## :package: Install

```sh
npx github:Bredansky/vulyk ...
```

Vulyk is a GitHub-only package. All commands are run via `npx github:Bredansky/vulyk` — no install step.

## :zap: Quick start

```sh
cd my-project
npx github:Bredansky/vulyk init

# Add a skill
npx github:Bredansky/vulyk add \
  "https://github.com/nicobailon/visual-explainer/tree/main/plugins/visual-explainer"

# Add a tracked doc that generates an AGENTS.md in src/
npx github:Bredansky/vulyk add \
  "https://github.com/alan2207/bulletproof-react/blob/main/docs/project-structure.md" \
  --group docs --targets src --description "Project structure conventions."

# Install everything from the manifest
npx github:Bredansky/vulyk agents
```

## :hammer_and_wrench: Commands

### `vulyk init`

Creates a `vulyk.json` in the current directory with a `skills` group (default output `.agents/skills`) and a `docs` group (default output `docs/external`).

### `vulyk add <specifier>`

Adds an entry from a local path or remote source. Auto-detects the group by inspecting the source against each group's `validate` block (e.g. `mustContain: ["SKILL.md"]` for skills, `fileExtension: ".md"` for docs). If the source is a directory containing multiple matching sub-sources (a "pack"), every sub-source is added as a separate entry.

```sh
vulyk add ./skills/my-local-skill
vulyk add ./skills/my-pack                    # expands to per-skill entries
vulyk add https://github.com/owner/repo/tree/main/skills/my-skill
vulyk add https://github.com/owner/repo/blob/main/docs/my-doc.md --targets src
vulyk add https://example.com/archive.zip
```

GitHub sources are pinned to commits on add. Local sources are stored as repo-relative paths.

### `vulyk remove <name>`

Removes an entry from the manifest and uninstalls its installed files on the next `vulyk agents` run.

### `vulyk enable <name>` / `vulyk disable <name>`

Opt a single entry in or out without removing it. Empty `enabled` array on a group means "all entries install" (opt-out model). The disabled list always wins over the enabled list.

### `vulyk list`

Lists entries grouped by their `group` field, the resolved `outputPaths`, and the per-group `enabled`/`disabled` sets.

### `vulyk diff [name]`

Shows what would change if you ran `update`.

### `vulyk update [name]`

Updates remote git-backed entries to the latest commit reachable from their configured ref. Local entries are refreshed from disk. On success, remote sources are repinned in `vulyk.json`.

### `vulyk sync`

Installs every enabled entry from its source into the configured output paths, refreshes gitignore, and prunes stale managed files. This is the actual `npm install` for your manifest — it does NOT generate AGENTS.md/CLAUDE.md files. Run `vulyk agents` after (or instead) for that.

### `vulyk agents`

Generates AGENTS.md/CLAUDE.md files for every enabled entry that declares `targets`. Does NOT install from sources — run `vulyk sync` first if your entries are remote.

**Flags:**

- `--agents <list>` — comma-separated agent file names (overrides per-entry `agents` for this run)

The first agent in the list is the **primary** — it gets a full `# Title` + description + `Full documentation: <path>` section. All subsequent agents are **secondary** and chain to the primary with a bare `@<primaryPath>` line — useful when CLAUDE.md should just `@import AGENTS.md`.

The import is straight `@<path>` text — no framing, no separators. See the [Claude Code memory docs](https://docs.claude.com/en/docs/claude-code/memory) for the import behavior.

### `vulyk find-docs <file>`

Prints JSON for tracked docs that apply to a specific file. Useful when a skill or review workflow wants to answer "which docs should I compare this file against?"

```sh
vulyk find-docs src/features/editor/poster.tsx
```

### `vulyk find-targets <doc>`

Prints JSON for tracked targets declared by a specific doc. Useful when a doc changes and you want to know which files or folders may need review.

```sh
vulyk find-targets docs/external/project-structure.md
```

## :receipt: `vulyk.json`

### Grouped form (shared config across entries)

```json
{
  "groups": {
    "skills": {
      "outputPaths": [".agents/skills"],
      "validate": { "mustContain": ["SKILL.md"] },
      "gitIgnore": true
    },
    "docs": {
      "outputPaths": ["docs/external"],
      "validate": { "fileExtension": ".md" },
      "gitIgnore": true,
      "rules": [{ "match": ["src/**"], "outputPaths": ["docs/external/src"] }]
    }
  },
  "entries": {
    "visual-explainer": {
      "source": "https://github.com/nicobailon/visual-explainer/tree/9a97a58.../plugins/visual-explainer",
      "group": "skills"
    },
    "my-local-skill": {
      "source": "skills/my-local-skill",
      "group": "skills"
    },
    "api-routes": {
      "source": "docs/api-routes.md",
      "group": "docs",
      "targets": ["src/app/api"],
      "description": "API route conventions and patterns."
    },
    "project-structure": {
      "source": "https://github.com/alan2207/bulletproof-react/blob/c66ea06.../docs/project-structure.md",
      "group": "docs",
      "targets": ["src"],
      "description": "Project structure conventions and patterns."
    }
  }
}
```

### Inline form (single entry, no `groups` block)

For a single entry the full group config can be inlined directly on the entry — no shared group needed.

```json
{
  "groups": {},
  "entries": {
    "my-skill": {
      "source": "https://github.com/owner/skill/tree/<commit>/skill",
      "outputPaths": [".agents/skills"],
      "validate": { "mustContain": ["SKILL.md"] },
      "gitIgnore": true
    }
  }
}
```

Entry-level fields override group-level fields. Resolution order: `entry.outputPaths` → `group.rules[match].outputPaths` → `group.outputPaths` → `["docs/external"]`. Same chain for `gitIgnore` and (where applicable) `validate`.

`vulyk add` writes the inline form automatically when the manifest has no `groups` configured — handy for new projects that only need one entry.

| Field                        | Description                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `groups.<name>.outputPaths`  | Directories where this group's entries are installed                                                                      |
| `groups.<name>.validate`     | `mustContain` (required files) and/or `fileExtension` (expected ext) used by `vulyk add` to auto-detect the group         |
| `groups.<name>.rules`        | Optional per-group `[{ match, outputPaths }]` overrides that take precedence over the group default                       |
| `groups.<name>.gitIgnore`    | Whether to gitignore the group's installed files (per-group default; can be overridden per entry)                         |
| `groups.<name>.enabled`      | Per-group opt-in whitelist. Empty array = all entries install (opt-out).                                                  |
| `groups.<name>.disabled`     | Per-group opt-out list. Always wins over `enabled`.                                                                       |
| `entries.<name>.source`      | Local repo-relative path or remote URL                                                                                    |
| `entries.<name>.group`       | Name of the group this entry belongs to (optional if the entry is self-grouped inline)                                    |
| `entries.<name>.outputPaths` | Optional per-entry override of the group's `outputPaths`                                                                  |
| `entries.<name>.validate`    | Optional per-entry `validate` block (used by `vulyk add` for auto-detection; ignored at sync time)                        |
| `entries.<name>.gitIgnore`   | Optional per-entry override of the group's `gitIgnore`                                                                    |
| `entries.<name>.targets`     | Optional list of dirs where agent files should be generated for this entry (doc entries only)                             |
| `entries.<name>.description` | Optional one-line summary, used in generated `AGENTS.md` sections                                                         |
| `entries.<name>.agents`      | Agent files to generate in each target dir (default: `["AGENTS.md"]`). First entry is primary; rest chain via `@primary`. |

## :link: Specifier format

| Format                                         | Resolves to                                             |
| ---------------------------------------------- | ------------------------------------------------------- |
| `./skills/my-skill`                            | A local skill directory                                 |
| `./skills/my-pack`                             | A local skill collection (expands to per-skill entries) |
| `https://github.com/owner/repo/tree/<ref>/...` | A GitHub-backed tree path                               |
| `https://github.com/owner/repo/blob/<ref>/...` | A GitHub-backed file path                               |
| `https://example.com/file.md`                  | A direct markdown URL                                   |
| `https://example.com/archive.zip`              | A direct archive URL                                    |

GitHub-backed remote sources in `vulyk.json` must use commit-pinned `blob` or `tree` URLs. During `add`, `sync`, and `update`, GitHub sources are normalized to pinned commit URLs. Local sources are stored as repo-relative paths.

## :broom: How managed files work

- Every vulyk-managed location has a `.vulyk` manifest listing exactly the files vulyk created there. The manifest is the source of truth for cleanup.
- **Cleanup is conservative.** `vulyk sync` only removes files that are listed in a `.vulyk` manifest AND no longer claimed by an enabled entry. Files you put in an output path yourself are never touched, even if they have a `.md` extension.
- **The root `.gitignore`** is updated with paths to vulyk-managed copies that aren't part of your own source tree. A local source path is never gitignored — even if it happens to share a path with one of the configured `outputPaths`.
- **Agent file generation.** For every doc entry with a `targets` list, the primary agent file (default `AGENTS.md`) is generated in each target dir. Additional agents declared via `entry.agents` (e.g. `CLAUDE.md`) chain to the primary with `@AGENTS.md`. See the `vulyk agents` flags above for details.
- **Idempotency.** `vulyk sync` and `vulyk agents` can both be run repeatedly. Each only writes files that changed; `agents` does not duplicate `AGENTS.md` sections.

## :page_facing_up: License

MIT
