#!/usr/bin/env node
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

const program = new Command();

program
  .name("vulyk")
  .description("npm for AI agent skills")
  .version("0.1.0");

program
  .command("init")
  .description("Create a vulyk.json in the current directory")
  .action(initCommand);

program
  .command("add <specifier>")
  .description("Add a skill (owner/repo/path or GitHub URL)")
  .option("-n, --name <name>", "override the skill name")
  .action((specifier, opts) => addCommand(specifier, { name: opts.name }));

program
  .command("remove <name>")
  .description("Remove a skill")
  .action(removeCommand);

program
  .command("enable <name>")
  .description("Enable a skill")
  .action(enableCommand);

program
  .command("disable <name>")
  .description("Disable a skill")
  .action(disableCommand);

program
  .command("list")
  .alias("ls")
  .description("List all skills")
  .action(listCommand);

program
  .command("diff [name]")
  .description("Show what would change on update")
  .action((name) => diffCommand(name));

program
  .command("update [name]")
  .description("Update skills/docs to latest")
  .action((name) => updateCommand(name));

program
  .command("doc-add <specifier>")
  .description("Add an external doc from a remote source")
  .option("-t, --targets <paths...>", "target paths this doc applies to")
  .option("-d, --description <desc>", "description for AGENTS.md")
  .action((specifier, opts) => docAddCommand(specifier, { targets: opts.targets ?? [], description: opts.description }));

program
  .command("docs")
  .description("Generate AGENTS.md files from docs/ folder")
  .option("--also <filenames...>", "also create these files importing AGENTS.md")
  .action((opts) => docsCommand({ also: opts.also }));

program
  .command("sync")
  .description("Reinstall all enabled skills")
  .action(syncCommand);

program.parse();
