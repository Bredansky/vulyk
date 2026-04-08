---
name: doc-drift-review
description: Review whether a file and its tracked documentation have drifted using vulyk as the source of truth for doc targeting. Use when asked to check if implementation matches docs, whether docs are stale, whether code should be updated to match documentation, or whether local and external docs have diverged for a specific file or config.
---

# Doc Drift Review

Review either:

- one file against the docs that `vulyk` says apply to it, or
- one doc against the files that `vulyk` says it targets

Use `vulyk` for path resolution. Do not reimplement doc matching manually.

## Workflow

### 1. Choose the flow

Use file-first when the implementation changed.

Use doc-first when a doc changed or when you want to know which implementation targets may now need review.

### 2. Collect evidence

For file-first review, run:

```bash
npx tsx .claude/skills/doc-drift-review/scripts/review-doc-drift.ts <file>
```

For doc-first review, run:

```bash
npx tsx .claude/skills/doc-drift-review/scripts/review-doc-drift.ts --doc <doc>
```

This script:

- calls `npx vulyk docs-for <file>`
- calls `npx vulyk targets-for <doc>` in reverse mode
- reads the file
- reads all matched local docs
- reads synced external docs when a local markdown copy exists
- reports missing synced external docs when they are tracked but not present locally
- bundles target file reviews for doc-first mode when the target is a file
- reports `directory` targets as scope warnings rather than pretending to review a whole tree automatically
- reports untracked docs as structured scope warnings rather than crashing

If the script reports `externalSyncMissing`, treat missing synced docs as a real signal. Prefer `insufficient_evidence` unless the local evidence is still strong enough for a clear call.

### 3. Review the evidence

Compare the implementation with the matched docs from broadest to most specific.

Look for:

- behavior described in docs but absent from the file
- behavior present in the file but not documented
- contradictions between local docs and synced external docs
- cases where docs are too broad or indirect to support a strong judgment

Prefer the current repo state over historical assumptions. If a file moved or ownership changed, evaluate the current target path that `vulyk` returns.

In doc-first mode:

- inspect each bundled target review separately
- use file targets as the primary evidence
- treat directory targets as scope warnings that require narrowing

### 4. Choose one status

Use exactly one of:

- `up_to_date`
- `file_needs_update`
- `doc_needs_update`
- `both_need_review`
- `insufficient_evidence`

Use these meanings:

- `up_to_date`: docs and file agree on the important behavior
- `file_needs_update`: docs are clear and the implementation is missing or violating them
- `doc_needs_update`: the implementation is coherent and docs are stale or misleading
- `both_need_review`: the file and docs disagree in multiple directions, or local and external docs disagree in a meaningful way
- `insufficient_evidence`: not enough specific evidence to make a reliable call

### 5. Set confidence

Use:

- `high`: direct and specific evidence from the file and matched docs
- `medium`: partial evidence or one missing source, but still enough to make a practical call
- `low`: broad docs, missing synced externals, or unresolved ambiguity

### 6. Return a structured result

For file-first review, return JSON using this schema:

```json
{
  "file": "<repo-relative path>",
  "status": "up_to_date",
  "confidence": "high",
  "summary": "Short conclusion.",
  "findings": [
    {
      "type": "doc_mismatch",
      "severity": "medium",
      "source": "docs/agent-hooks.md",
      "evidence": "Specific mismatch or supporting detail."
    }
  ],
  "recommended_actions": [
    {
      "kind": "update_doc",
      "target": "docs/agent-hooks.md",
      "reason": "Why this action should be taken."
    }
  ]
}
```

Allowed `findings[].type` values:

- `doc_mismatch`
- `implementation_gap`
- `missing_doc_coverage`
- `doc_conflict`
- `missing_external_sync`
- `missing_file`
- `untracked_doc`
- `insufficient_specificity`

Allowed `findings[].severity` values:

- `low`
- `medium`
- `high`

Allowed `recommended_actions[].kind` values:

- `update_file`
- `update_doc`
- `sync_external_docs`
- `review_scope`
- `no_action`

## Reverse flow

When the user starts from a doc, use:

```bash
npx tsx .claude/skills/doc-drift-review/scripts/review-doc-drift.ts --doc <doc>
```

That bundle includes:

- the doc itself
- all declared `vulyk` targets
- a nested file review for each file target
- a scope warning for each directory target

For doc-first responses:

- summarize each target separately
- do not collapse multiple targets into one fake global status unless the user explicitly asks for an overall rollup
- if every target agrees, you may add a short overall conclusion after the per-target results
