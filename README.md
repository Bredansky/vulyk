# vulyk 🐝

> вулик — _hive_ in Ukrainian

A package manager for AI agent context: it installs skills and tracked docs from pinned sources, and generates the `AGENTS.md` / `CLAUDE.md` files that point at them. What an agent works from stays versioned, diffable, and identical on every machine.

---

## 📦 Install

Run it straight from GitHub — unpinned, resolving the default branch:

```sh
npx github:Bredansky/vulyk ...
```

Or pin the published CLI in `devDependencies`, so local runs and CI resolve the same version:

```sh
npm i -D vulyk
npx vulyk ...
```

Node ≥ 22.

## ⚡ Quick start

```sh
cd my-project
npx vulyk init

# a skill
npx vulyk add "https://github.com/nicobailon/visual-explainer/tree/main/plugins/visual-explainer"

# a tracked doc that generates an AGENTS.md in src/
npx vulyk add "https://github.com/alan2207/bulletproof-react/blob/main/docs/project-structure.md" \
  --group docs --targets src --description "Project structure conventions."

# install everything the manifest declares
npx vulyk agents
```

## 🧰 Commands

| Command                    | What it does                                                                   |
| -------------------------- | ------------------------------------------------------------------------------ |
| `vulyk init`               | Creates a typed `vulyk.config.ts` in the current directory                     |
| `vulyk add <specifier>`    | Adds a skill or doc from a local path or remote source                         |
| `vulyk remove <name>`      | Removes an entry, uninstalling its files on the next `agents` run              |
| `vulyk enable` / `disable` | Opts an entry in or out without removing it                                    |
| `vulyk list`               | Lists entries by group, with their resolved output paths                       |
| `vulyk diff [name]`        | Shows what an `update` would change                                            |
| `vulyk update [name]`      | Moves remote entries to the newest commit their ref reaches; refreshes locals  |
| `vulyk sync`               | Installs every enabled entry to its output paths and prunes stale files        |
| `vulyk agents`             | Generates the `AGENTS.md` / `CLAUDE.md` files for entries that declare targets |
| `vulyk find-docs <file>`   | Prints the tracked docs that apply to a file                                   |
| `vulyk find-targets <doc>` | Prints the targets a doc applies to                                            |

`sync` is the install step and `agents` is the generate step — each only writes what changed, and both are safe to re-run.

**`vulyk add` flags:** `--name` sets or reuses an entry name; `--group` forces a group instead of auto-detecting it; `--targets` sets comma-separated target paths; `--description` sets the routing description; `--render` chooses `summary` or `embed`. GitHub sources are pinned to commits, a local path is stored repo-relative, and re-adding an existing `--name` updates only the fields you passed.

**`vulyk agents` flag:** `--agents` takes a comma-separated list of agent file names. The first is primary — it carries the title, description, and `Full documentation:` path — and the rest chain to it with a bare `@<primaryPath>` import, so `CLAUDE.md` can simply pull in `AGENTS.md`.

`vulyk add` auto-detects a group by testing the source against each group's `validate` block, and expands a directory that holds several matching sources into one entry per source. `vulyk find-docs` / `find-targets` match against each entry's `targets`, the same field that decides where agent files are generated.

## ⚙️ `vulyk.config.ts`

A group holds the shared settings; each entry points at one source:

```ts
import { defineConfig } from "vulyk/config";

export default defineConfig({
  groups: {
    skills: {
      outputPaths: [".agents/skills"],
      validate: { mustContain: ["SKILL.md"] },
      gitIgnore: true,
    },
    docs: {
      outputPaths: ["docs/external"],
      validate: { fileExtension: ".md" },
      gitIgnore: true,
      rules: [{ match: ["src/**"], outputPaths: ["docs/external/src"] }],
    },
  },
  entries: {
    "my-skill": {
      source: "skills/my-local-skill",
      group: "skills",
    },
    "project-structure": {
      source:
        "https://github.com/alan2207/bulletproof-react/blob/<commit>/docs/project-structure.md",
      group: "docs",
      targets: ["src"],
      description: "Project structure conventions and patterns.",
    },
  },
});
```

With no groups configured, `vulyk add` inlines the same settings on the entry itself (`outputPaths`, `validate`, `gitIgnore`), which is all a one-entry manifest needs.

| Field                        | Description                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `groups.<name>.outputPaths`  | Directories this group's entries install into                                                      |
| `groups.<name>.validate`     | `mustContain` and/or `fileExtension`, used by `vulyk add` to detect the group                      |
| `groups.<name>.rules`        | Per-group `[{ match, outputPaths }]` overrides that win over the group default                     |
| `groups.<name>.gitIgnore`    | Whether installed files are gitignored                                                             |
| `groups.<name>.enabled`      | Opt-in whitelist. Empty means every entry installs                                                 |
| `groups.<name>.disabled`     | Opt-out list. Always wins over `enabled`                                                           |
| `groups.<name>.render`       | Default render mode for the group                                                                  |
| `entries.<name>.source`      | Local repo-relative path or remote URL                                                             |
| `entries.<name>.group`       | The group it belongs to, optional when the entry is self-grouped                                   |
| `entries.<name>.outputPaths` | Per-entry override of the group's output paths                                                     |
| `entries.<name>.validate`    | Per-entry `validate` block, used by `vulyk add`; ignored at sync time                              |
| `entries.<name>.gitIgnore`   | Per-entry override of the group default                                                            |
| `entries.<name>.targets`     | Paths or globs deciding where agent files go and which files match in `find-docs` / `find-targets` |
| `entries.<name>.description` | One-line summary, used in the generated agent section                                              |
| `entries.<name>.agents`      | Agent files to generate per target directory (default `["AGENTS.md"]`)                             |
| `entries.<name>.render`      | `summary` (default) or `embed`                                                                     |

Resolution runs entry, then group rule, then group, then the manifest default.

## 🔗 Specifier format

| Format                                         | Resolves to                                         |
| ---------------------------------------------- | --------------------------------------------------- |
| `./skills/my-skill`                            | A local skill directory                             |
| `./skills/my-pack`                             | A local collection, expanded into per-skill entries |
| `https://github.com/owner/repo/tree/<ref>/...` | A GitHub tree path                                  |
| `https://github.com/owner/repo/blob/<ref>/...` | A GitHub file path                                  |
| `https://example.com/file.md`                  | A direct markdown URL                               |
| `https://example.com/archive.zip`              | A direct archive URL                                |

Resolved GitHub refs are recorded in `vulyk.lock.json`, which holds nothing else. A folder source is installed as it is; a single-file GitHub source can have its relative links resolved by opting in with `linkResolution`, which copies the linked targets into a shared output path and rewrites the links to point there:

```ts
linkResolution: {
  sharedOutputPath: "docs/shared",
  sharedSourceRoot: "docs",
  maxDepth: 1,
}
```

A broken link, a depth-limit violation, a shared-root escape, or an output collision fails the sync.

## 📝 Render modes

A tracked doc reaches an agent file one of two ways.

**`summary`** — the title, the entry's `description`, and the path of the installed copy, so the agent opens the file only when it needs it:

```markdown
# Code Organization Guide

How to organize components, types, constants, utilities, config, hooks, and locales.

Full documentation: docs/managed/code-organization-guide/code-organization-guide.md
```

**`embed`** — the doc's body written straight into the agent file, for a document an agent should always have in context. The body brings its own title and overview, so neither the description nor the path is written.

Either way the copy still lands in `outputPaths`, so an embedded doc stays on disk and diffable against its source.

## 🧹 Managed files

- `.vulyk/state.json` records which files vulyk installed; `.vulyk/cache/` and `.vulyk/tmp/` hold working data. All three are ignored local state.
- Cleanup is conservative: `vulyk sync` removes only files it recorded **and** that no enabled entry claims. A file you put in an output path yourself is never touched.
- The root `.gitignore` gains the managed copies that are not part of your own tree. A local source path is never gitignored, even when it shares a path with an output path.
- `vulyk.lock.json` is committed; it pins GitHub refs only and never the executable config, which stays the source of intent. `vulyk update [name]` is what moves it forward.

## 📚 Documentation

| What                          | Where                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------ |
| The canonical skills          | [`skills/`](https://github.com/Bredansky/vulyk/tree/master/skills)             |
| The CLI, one file per command | [`src/commands/`](https://github.com/Bredansky/vulyk/tree/master/src/commands) |
| The manifest types            | [`src/types.ts`](https://github.com/Bredansky/vulyk/blob/master/src/types.ts)  |

## 🐝 Sibling packages

| Package                                       | What it does                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| **vulyk**                                     | Installs skills and tracked docs, and generates agent files — this package |
| [pasika](https://github.com/Bredansky/pasika) | The documentation, the rules derived from it, and the helpers              |
| [zirka](https://github.com/Bredansky/zirka)   | Wires ESLint, Prettier, and TypeScript into one `styleguide()` config      |

## 📄 License

MIT
