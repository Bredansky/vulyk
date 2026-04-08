import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface VulykDoc {
  kind: "local" | "external";
  name: string;
  description: string;
  targets: string[];
  relativePath?: string;
  filePath?: string;
  source?: string;
}

interface DocsForResult {
  file: string;
  docs: VulykDoc[];
}

interface TargetMatch {
  path: string;
  kind: "file" | "directory";
}

interface TargetsForResult {
  doc: string;
  kind: "local" | "external";
  name: string;
  description: string;
  targets: TargetMatch[];
}

interface LoadedDoc {
  kind: "local" | "external";
  name: string;
  description: string;
  targets: string[];
  relativePath?: string;
  filePath?: string;
  source?: string;
  content: string | null;
  availability: "loaded" | "missing_synced_copy";
}

interface FileEvidence {
  inputPath: string;
  relativePath: string;
  absolutePath: string;
  content: string | null;
}

interface ReviewBundle {
  mode: "file";
  file: FileEvidence;
  docs: LoadedDoc[];
  metadata: {
    docsForCommand: string;
    externalSyncMissing: boolean;
    missingDocs: string[];
  };
}

interface MissingFileBundle {
  mode: "file";
  file: FileEvidence;
  status: "insufficient_evidence";
  confidence: "low";
  summary: string;
  findings: {
    type: "missing_file";
    severity: "high";
    source: string;
    evidence: string;
  }[];
  recommended_actions: {
    kind: "review_scope";
    target: string;
    reason: string;
  }[];
  metadata: {
    docsForCommand: null;
    externalSyncMissing: false;
    missingDocs: string[];
  };
}

interface DirectoryReviewBundle {
  mode: "file";
  status: "insufficient_evidence";
  confidence: "low";
  summary: string;
  findings: {
    type: "insufficient_specificity";
    severity: "medium";
    source: string;
    evidence: string;
  }[];
  recommended_actions: {
    kind: "review_scope";
    target: string;
    reason: string;
  }[];
}

interface ReverseTargetBundle {
  path: string;
  kind: "file" | "directory";
  review: ReviewBundle | MissingFileBundle | DirectoryReviewBundle;
}

interface ReverseReviewBundle {
  mode: "doc";
  doc: {
    inputPath: string;
    relativePath: string;
    absolutePath: string;
    kind: "local" | "external";
    name: string;
    description: string;
    content: string | null;
  };
  targets: ReverseTargetBundle[];
  metadata: {
    targetsForCommand: string;
  };
}

interface UntrackedDocBundle {
  mode: "doc";
  doc: {
    inputPath: string;
    relativePath: string;
    absolutePath: string;
    kind: "local" | "external" | "unknown";
    name: string;
    description: string;
    content: string | null;
  };
  status: "insufficient_evidence";
  confidence: "low";
  summary: string;
  findings: {
    type: "untracked_doc";
    severity: "medium";
    source: string;
    evidence: string;
  }[];
  recommended_actions: {
    kind: "review_scope";
    target: string;
    reason: string;
  }[];
  metadata: {
    targetsForCommand: string;
  };
}

function failUsage(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function printJson(
  bundle:
    | MissingFileBundle
    | ReviewBundle
    | ReverseReviewBundle
    | UntrackedDocBundle,
): void {
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
}

function summarizeCliError(message: string, inputPath?: string): string {
  const unresolvedPlaceholder = String.raw`No tracked doc found for "\${docPath}".`;
  if (message.includes(unresolvedPlaceholder)) {
    return `No tracked doc found for "${inputPath ?? "the requested doc"}".`;
  }

  const noTrackedDocMatch = /No tracked doc found for "[^"]+"\./.exec(message);
  if (noTrackedDocMatch) {
    return noTrackedDocMatch[0];
  }

  const firstNonEmptyLine = message
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return firstNonEmptyLine ?? message.trim();
}

function isDocsForResult(value: unknown): value is DocsForResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "file" in value &&
    typeof value.file === "string" &&
    "docs" in value &&
    Array.isArray(value.docs)
  );
}

function isTargetsForResult(value: unknown): value is TargetsForResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "doc" in value &&
    typeof value.doc === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "description" in value &&
    typeof value.description === "string" &&
    "targets" in value &&
    Array.isArray(value.targets)
  );
}

function runDocsFor(targetFile: string, projectRoot: string): DocsForResult {
  const stdout = execFileSync("npx", ["vulyk", "docs-for", targetFile], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  const parsed: unknown = JSON.parse(stdout);
  if (!isDocsForResult(parsed)) {
    throw new Error(`Unexpected vulyk docs-for output for ${targetFile}.`);
  }

  return parsed;
}

function runTargetsFor(docPath: string, projectRoot: string): TargetsForResult {
  const result = spawnSync("npx", ["vulyk", "targets-for", docPath], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const message =
      stderr || stdout || `Failed to resolve tracked targets for ${docPath}.`;
    throw new Error(message);
  }

  const parsed: unknown = JSON.parse(result.stdout);
  if (!isTargetsForResult(parsed)) {
    throw new Error(`Unexpected vulyk targets-for output for ${docPath}.`);
  }

  return parsed;
}

function loadDoc(doc: VulykDoc): LoadedDoc {
  if (!doc.filePath) {
    return {
      ...doc,
      content: null,
      availability: "missing_synced_copy",
    };
  }

  return {
    ...doc,
    content: fs.readFileSync(doc.filePath, "utf8"),
    availability: "loaded",
  };
}

function buildMissingFileBundle(
  inputPath: string,
  absolutePath: string,
): MissingFileBundle {
  return {
    mode: "file",
    file: {
      inputPath,
      relativePath: inputPath,
      absolutePath,
      content: null,
    },
    status: "insufficient_evidence",
    confidence: "low",
    summary: "The requested file does not exist in the current repo state.",
    findings: [
      {
        type: "missing_file",
        severity: "high",
        source: inputPath,
        evidence: `No file exists at ${inputPath}. This may indicate the file moved, was deleted, or the review target is outdated.`,
      },
    ],
    recommended_actions: [
      {
        kind: "review_scope",
        target: inputPath,
        reason:
          "Confirm the intended current file path before attempting a doc drift review.",
      },
    ],
    metadata: {
      docsForCommand: null,
      externalSyncMissing: false,
      missingDocs: [],
    },
  };
}

function buildFileReviewBundle(
  inputPath: string,
  projectRoot: string,
): MissingFileBundle | ReviewBundle {
  const absolutePath = path.resolve(projectRoot, inputPath);

  if (!fs.existsSync(absolutePath)) {
    return buildMissingFileBundle(inputPath, absolutePath);
  }

  const docsFor = runDocsFor(inputPath, projectRoot);
  const docs = docsFor.docs.map(loadDoc);

  return {
    mode: "file",
    file: {
      inputPath,
      relativePath: docsFor.file,
      absolutePath,
      content: fs.readFileSync(absolutePath, "utf8"),
    },
    docs,
    metadata: {
      docsForCommand: `npx vulyk docs-for ${inputPath}`,
      externalSyncMissing: docs.some(
        (doc) =>
          doc.kind === "external" && doc.availability === "missing_synced_copy",
      ),
      missingDocs: docs
        .filter((doc) => doc.availability === "missing_synced_copy")
        .map((doc) => doc.relativePath ?? doc.source ?? doc.name),
    },
  };
}

function buildDocReviewBundle(
  inputPath: string,
  projectRoot: string,
): ReverseReviewBundle | UntrackedDocBundle {
  const absolutePath = path.resolve(projectRoot, inputPath);
  let targetsFor: TargetsForResult;

  try {
    targetsFor = runTargetsFor(inputPath, projectRoot);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error while resolving doc targets.";

    return {
      mode: "doc",
      doc: {
        inputPath,
        relativePath: inputPath,
        absolutePath,
        kind: "unknown",
        name: path.basename(inputPath),
        description: "",
        content: fs.existsSync(absolutePath)
          ? fs.readFileSync(absolutePath, "utf8")
          : null,
      },
      status: "insufficient_evidence",
      confidence: "low",
      summary:
        "The requested doc is not tracked by vulyk, so reverse doc-to-target review cannot be resolved.",
      findings: [
        {
          type: "untracked_doc",
          severity: "medium",
          source: inputPath,
          evidence: summarizeCliError(message, inputPath),
        },
      ],
      recommended_actions: [
        {
          kind: "review_scope",
          target: inputPath,
          reason:
            "Use a tracked doc from vulyk.json or add this doc to the vulyk doc graph before running reverse review.",
        },
      ],
      metadata: {
        targetsForCommand: `npx vulyk targets-for ${inputPath}`,
      },
    };
  }

  return {
    mode: "doc",
    doc: {
      inputPath,
      relativePath: targetsFor.doc,
      absolutePath,
      kind: targetsFor.kind,
      name: targetsFor.name,
      description: targetsFor.description,
      content: fs.existsSync(absolutePath)
        ? fs.readFileSync(absolutePath, "utf8")
        : null,
    },
    targets: targetsFor.targets.map((target) => {
      if (target.kind === "directory") {
        return {
          path: target.path,
          kind: target.kind,
          review: {
            mode: "file",
            status: "insufficient_evidence",
            confidence: "low",
            summary:
              "This doc maps to a directory target, which is too broad for automatic single-file drift review.",
            findings: [
              {
                type: "insufficient_specificity",
                severity: "medium",
                source: target.path,
                evidence:
                  "The reverse flow found a directory target rather than a specific file, so a narrower review target is needed.",
              },
            ],
            recommended_actions: [
              {
                kind: "review_scope",
                target: target.path,
                reason:
                  "Pick a specific file inside this directory or narrow the doc target before running drift review.",
              },
            ],
          },
        };
      }

      return {
        path: target.path,
        kind: target.kind,
        review: buildFileReviewBundle(target.path, projectRoot),
      };
    }),
    metadata: {
      targetsForCommand: `npx vulyk targets-for ${inputPath}`,
    },
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const projectRoot = process.cwd();

  if (args.length === 0) {
    failUsage(
      "Usage: npx tsx .claude/skills/doc-drift-review/scripts/review-doc-drift.ts <file> | --doc <doc>",
    );
  }

  if (args[0] === "--doc") {
    const inputPath = args[1];
    if (!inputPath) {
      failUsage(
        "Usage: npx tsx .claude/skills/doc-drift-review/scripts/review-doc-drift.ts --doc <doc>",
      );
    }

    printJson(buildDocReviewBundle(inputPath, projectRoot));
    return;
  }

  const inputPath = args[0];
  if (!inputPath) {
    failUsage(
      "Usage: npx tsx .claude/skills/doc-drift-review/scripts/review-doc-drift.ts <file>",
    );
  }

  printJson(buildFileReviewBundle(inputPath, projectRoot));
}

main();
