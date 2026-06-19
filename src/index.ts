import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { removeCommand } from "./commands/remove.js";
import { enableCommand } from "./commands/enable.js";
import { disableCommand } from "./commands/disable.js";
import { listCommand } from "./commands/list.js";
import { agentsCommand } from "./commands/agents.js";
import { updateCommand } from "./commands/update.js";
import { diffCommand } from "./commands/diff.js";
import { findDocsCommand } from "./commands/find-docs.js";
import { findTargetsCommand } from "./commands/find-targets.js";

const program = new Command();

program
  .name("vulyk")
  .description("Package manager for AI agent skills and tracked docs")
  .version("0.9.6");

program
  .command("init")
  .description("Create a vulyk.json in the current directory")
  .action(initCommand);

program
  .command("add <specifier>")
  .description("Add a skill or doc from a local path or remote URL")
  .option("-n, --name <name>", "override the entry name")
  .option("-g, --group <name>", "force a specific group")
  .action(
    async (specifier: string, opts: { name?: string; group?: string }) => {
      await addCommand(specifier, { name: opts.name, group: opts.group });
    },
  );

program
  .command("remove <name>")
  .description("Remove an entry")
  .action(removeCommand);

program
  .command("enable <name>")
  .description("Re-enable a disabled entry")
  .action((name: string) => {
    enableCommand(name);
  });

program
  .command("disable <name>")
  .description("Disable an entry (kept in manifest, not synced)")
  .action(disableCommand);

program
  .command("list")
  .alias("ls")
  .description("List entries grouped by group")
  .action(listCommand);

program
  .command("diff [name]")
  .description("Show what would change on update")
  .action((name: string | undefined) => {
    diffCommand(name);
  });

program
  .command("update [name]")
  .description("Update entries to latest")
  .action(async (name: string | undefined) => {
    await updateCommand(name);
  });

program
  .command("find-docs <file>")
  .description("List tracked docs that apply to a specific file")
  .action(findDocsCommand);

program
  .command("find-targets <doc>")
  .description("List tracked targets for a specific doc")
  .action(findTargetsCommand);

program
  .command("agents")
  .description("Sync all enabled entries to their output paths")
  .option(
    "-a, --aliases <list>",
    "comma-separated alias files to generate per target dir (overrides entry.aliases)",
  )
  .action(async (opts: { aliases?: string }) => {
    const cliOverrides: { aliases?: string[] } = {};
    if (opts.aliases) {
      cliOverrides.aliases = opts.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
    }
    await agentsCommand(cliOverrides);
  });

program.parse();
