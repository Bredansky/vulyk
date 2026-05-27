---
name: agent-doc-router-review
description: Review and improve AGENTS.md section descriptions so agents know when to open each referenced doc. Use when asked to challenge AGENTS.md, validate doc routing, improve Vulyk doc descriptions, or make agents understand why and when to look up docs.
---

# Agent Doc Router Review

Improve `AGENTS.md` as a routing index, using Vulyk doc descriptions as the source of truth.

Use this skill when the problem is not the doc body itself, but whether an agent can choose the right doc from the short `AGENTS.md` section descriptions.

## Workflow

### 1. Read the routing surface

Read:

- `AGENTS.md`
- `vulyk.json`
- headings or short summaries of referenced docs

Prefer `rg -n '^#|^Full documentation:' AGENTS.md docs/**/*.md` and targeted `sed` reads over loading every doc in full.

### 2. Build routing puzzles

Create 4-8 realistic task prompts that should map to specific docs.

Good puzzle shapes:

- "I am extracting nested JSX with repeated sibling blocks."
- "I am creating a reusable Button/Card/Dialog primitive."
- "I need to decide whether a child owns handler/state."
- "I am adding a shared hook and pure format utility."
- "I am changing Tailwind token classes."
- "I need browser E2E auth setup."

Each puzzle should have an expected primary doc and, when useful, one secondary doc.

### 3. Challenge agents when available

If the user asked to use agents/subagents and agent tools are available, ask 2-3 agents to read `AGENTS.md` and solve the puzzles.

Ask for:

- which docs they would open
- why
- which section descriptions were unclear or overlapping
- exact shorter wording for unclear descriptions

Do not give agents your expected answers unless you are running a second pass after edits.

If new agents cannot be spawned because of limits, reuse existing agents with `interrupt: true` when appropriate. If no agents are available, do the same puzzle review locally and say that agent validation was unavailable.

### 4. Tighten descriptions

Update `vulyk.json` descriptions, not generated `AGENTS.md`, unless the repo intentionally hand-edits `AGENTS.md`.

Good descriptions answer "when should I open this?" Examples:

- `When splitting feature JSX: flatten nested interactive/custom components and extract repeated or nameable sibling groups.`
- `When choosing or adding shadcn theme tokens: surfaces, foreground pairs, borders, inputs, rings, and status roles.`

Prefer descriptions that start with "When..." for implementation docs.

Mark broad overview docs as supplements, not competing catch-alls:

- `Repo-specific UI defaults that refine the external component, Tailwind, and class-composition rules.`

Avoid vague descriptions:

- `Component rules`
- `Tailwind and UI stuff`
- `Project conventions`

### 5. Sync and repeat

Run:

```bash
npx vulyk sync
```

Then re-run the puzzle challenge against the regenerated `AGENTS.md`.

Repeat until agents route the puzzles correctly and no description feels unclear enough to change.

### 6. Report

Summarize:

- which descriptions changed
- whether `npx vulyk sync` succeeded
- agent validation result, including unresolved ambiguity if any
- tracked files changed

Mention if generated docs or `AGENTS.md` are ignored by git but refreshed on disk.
