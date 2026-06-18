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
import { docsForCommand } from "./commands/docs-for.js";
import { targetsForCommand } from "./commands/targets-for.js";

const program = new Command();

program
  .name("vulyk")
  .description("Package manager for AI agent skills and tracked docs")
  .version("0.9.0");

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
  .command("agents")
  .description("Sync all enabled entries to their output paths")
  .action(async () => {
    await agentsCommand();
  });

program.parse();
