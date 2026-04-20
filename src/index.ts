import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { removeCommand } from "./commands/remove.js";
import { enableCommand, disableCommand } from "./commands/toggle.js";
import { listCommand } from "./commands/list.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { diffCommand } from "./commands/diff.js";
import { docsCommand } from "./commands/docs.js";
import { docAddCommand } from "./commands/doc-add.js";
import { docRemoveCommand } from "./commands/doc-remove.js";
import {
  docRuleRemoveCommand,
  docRuleSetCommand,
} from "./commands/doc-rule.js";
import { docsForCommand } from "./commands/docs-for.js";
import {
  skillOutputAddCommand,
  skillOutputRemoveCommand,
} from "./commands/skill-output.js";
import { targetsForCommand } from "./commands/targets-for.js";

const program = new Command();

program.name("vulyk").description("npm for AI agent skills").version("0.7.9");

program
  .command("init")
  .description("Create a vulyk.json in the current directory")
  .action(initCommand);

program
  .command("add <specifier>")
  .description("Add a skill from a local path or remote URL")
  .option("-n, --name <name>", "override the skill name")
  .action(async (specifier: string, opts: { name?: string }) => {
    await addCommand(specifier, { name: opts.name });
  });

program
  .command("remove <name>")
  .description("Remove a skill")
  .action(removeCommand);

program
  .command("skill-output-add <path>")
  .description("Add a managed skill output path")
  .action(skillOutputAddCommand);

program
  .command("skill-output-remove <path>")
  .description("Remove a managed skill output path")
  .action(skillOutputRemoveCommand);

program
  .command("enable <name>")
  .description("Enable a skill")
  .action(async (name: string) => {
    await enableCommand(name);
  });

program
  .command("disable <name>")
  .description("Disable a skill")
  .action(disableCommand);

program
  .command("list")
  .alias("ls")
  .description("List managed skills and tracked docs")
  .action(listCommand);

program
  .command("diff [name]")
  .description("Show what would change on update")
  .action((name: string | undefined) => {
    diffCommand(name);
  });

program
  .command("update [name]")
  .description("Update skills/docs to latest")
  .action(async (name: string | undefined) => {
    await updateCommand(name);
  });

program
  .command("doc-add <specifier>")
  .description("Add an external doc from a remote source")
  .option("-t, --targets <paths...>", "target paths this doc applies to")
  .option("-d, --description <desc>", "description for AGENTS.md")
  .action(
    (specifier: string, opts: { targets?: string[]; description?: string }) => {
      docAddCommand(specifier, {
        targets: opts.targets ?? [],
        description: opts.description,
      });
    },
  );

program
  .command("doc-remove <name>")
  .description("Remove a tracked doc")
  .action(docRemoveCommand);

program
  .command("doc-rule-set <name>")
  .description("Create or replace a docs rule")
  .requiredOption("-m, --match <patterns...>", "target match patterns")
  .option("-o, --output-paths <paths...>", "paths for fetched external docs")
  .option("--also <filenames...>", "extra alias files for matched targets")
  .option("--gitignore-generated", "gitignore generated files for this rule")
  .option(
    "--no-gitignore-generated",
    "do not gitignore generated files for this rule",
  )
  .action(
    (
      name: string,
      opts: {
        match: string[];
        outputPaths?: string[];
        also?: string[];
        gitignoreGenerated?: boolean;
      },
    ) => {
      docRuleSetCommand(name, {
        match: opts.match,
        outputPaths: opts.outputPaths,
        also: opts.also,
        gitignoreGenerated: opts.gitignoreGenerated,
      });
    },
  );

program
  .command("doc-rule-remove <name>")
  .description("Remove a docs rule")
  .action(docRuleRemoveCommand);

program
  .command("docs")
  .description("Generate AGENTS.md files from tracked docs")
  .option(
    "--also <filenames...>",
    "add extra alias files importing AGENTS.md for this run",
  )
  .action((opts: { also?: string[] }) => {
    docsCommand({ also: opts.also });
  });

program
  .command("docs-for <file>")
  .description("List tracked docs that apply to a specific file")
  .action((file: string) => {
    docsForCommand(file);
  });

program
  .command("targets-for <doc>")
  .description("List tracked targets for a specific doc")
  .action((doc: string) => {
    targetsForCommand(doc);
  });

program
  .command("sync")
  .description("Reinstall all enabled skills")
  .action(async () => {
    await syncCommand();
  });

program.parse();
