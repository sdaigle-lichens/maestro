#!/usr/bin/env node
// Maestro epics (`084`): create an epic, link or unlink tasks, show an epic with its tasks'
// statuses, and the durable report inbox between a worker session's done step and the manager.
// The mechanics live in lib/maestro-epic.cjs (generated from apps/maestro/src/core/epics.ts); this
// script is argument parsing and output. Project root: $CLAUDE_PROJECT_DIR, then the cwd.
//
//   node maestro-epic.cjs create <slug> [--goal "<text>"] [--manager "<session name>"]
//   node maestro-epic.cjs list
//   node maestro-epic.cjs link <slug> <NNN-task.md>...      writes `epic` on each task's tracker entry
//   node maestro-epic.cjs unlink <NNN-task.md>...           removes it again
//       Both are all or nothing: a task that does not exist is named and NOTHING is written (exit 1).
//   node maestro-epic.cjs show <slug> [--json]
//       The epic's manager and worker session NAMES, its tasks with their statuses and, for a
//       running task, the NAME of the session that claimed it (or "(unnamed)"), and every
//       unacknowledged report with its file path. Task membership is read from the tracker.
//   node maestro-epic.cjs set-manager <slug> <session name>
//   node maestro-epic.cjs add-worker <slug> <session name> [--task <NNN-task.md>]
//   node maestro-epic.cjs remove-worker <slug> <session name>
//   node maestro-epic.cjs report --task <NNN-task.md> [--file <path>|-] [--from "<session name>"]
//       The orchestrator's done step. Writes the report body (a file, or stdin when --file is "-" or
//       omitted) into the inbox of the epic the task belongs to and logs it. Prints the report file
//       path and, when the epic has a manager recorded, the name to message. A task that belongs
//       to no epic prints a single line and exits 0: nothing else happens.
//   node maestro-epic.cjs reports <slug>             the unacknowledged reports
//   node maestro-epic.cjs ack <slug> <report id>... [--by "<session name>"]
//       Record that the manager received a report. Cross-session messages have no delivery
//       receipt, so the acknowledgement lives in the epic's state.
//
// Every write reads the file immediately before writing and changes only its own entries, so the
// manager and the workers can write at the same time without losing each other's work.

const fs = require("fs");
const path = require("path");
const epics = require("./lib/maestro-epic.cjs");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const argv = process.argv.slice(2);
const command = argv[0];

// Split the arguments after the command into positionals and `--flag value` pairs.
function parse(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--json") flags.json = true;
    else if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i += 1;
    } else positional.push(args[i]);
  }
  return { positional, flags };
}

function fail(message) {
  process.stderr.write(`maestro-epic: ${message}\n`);
  process.exit(1);
}

function need(value, usage) {
  if (!value) fail(`missing argument. Usage: ${usage}`);
  return value;
}

function readBody(file) {
  if (file && file !== "-") return fs.readFileSync(path.resolve(file), "utf8");
  return fs.readFileSync(0, "utf8");
}

const { positional, flags } = parse(argv.slice(1));

try {
  switch (command) {
    case "create": {
      const slug = need(positional[0], "create <slug> [--goal <text>] [--manager <name>]");
      const { dir } = epics.createEpic(projectDir, slug, { goal: flags.goal, manager: flags.manager });
      process.stdout.write(`Maestro epic: created "${slug}" at ${dir}\n  edit ${path.join(dir, "EPIC.md")} for the goal, scope and decisions\n`);
      break;
    }
    case "list": {
      const all = epics.listEpics(projectDir);
      process.stdout.write(all.length ? `${all.join("\n")}\n` : "Maestro epic: no epics\n");
      break;
    }
    case "link": {
      const slug = need(positional[0], "link <slug> <task.md>...");
      const tasks = positional.slice(1);
      need(tasks[0], "link <slug> <task.md>...");
      const r = epics.linkTasks(projectDir, slug, tasks);
      if (r.missing.length) fail(`no such task file: ${r.missing.join(", ")}. Nothing was linked.`);
      process.stdout.write(`Maestro epic: linked ${r.changed.length} task(s) to "${slug}": ${r.changed.join(", ")}\n`);
      break;
    }
    case "unlink": {
      need(positional[0], "unlink <task.md>...");
      const r = epics.unlinkTasks(projectDir, positional);
      if (r.missing.length) fail(`no such task file: ${r.missing.join(", ")}. Nothing was unlinked.`);
      process.stdout.write(`Maestro epic: unlinked ${r.changed.length} task(s): ${r.changed.join(", ")}\n`);
      break;
    }
    case "show": {
      const view = epics.showEpic(projectDir, need(positional[0], "show <slug> [--json]"));
      process.stdout.write(flags.json ? `${JSON.stringify(view)}\n` : `${epics.formatEpic(view)}\n`);
      break;
    }
    case "set-manager": {
      epics.setManager(projectDir, need(positional[0], "set-manager <slug> <name>"), need(positional[1], "set-manager <slug> <name>"));
      process.stdout.write(`Maestro epic: manager of "${positional[0]}" is now "${positional[1]}"\n`);
      break;
    }
    case "add-worker": {
      epics.addWorker(projectDir, need(positional[0], "add-worker <slug> <name>"), need(positional[1], "add-worker <slug> <name>"), flags.task);
      process.stdout.write(`Maestro epic: recorded worker "${positional[1]}" on "${positional[0]}"\n`);
      break;
    }
    case "remove-worker": {
      epics.removeWorker(projectDir, need(positional[0], "remove-worker <slug> <name>"), need(positional[1], "remove-worker <slug> <name>"));
      process.stdout.write(`Maestro epic: removed worker "${positional[1]}" from "${positional[0]}"\n`);
      break;
    }
    case "report": {
      const task = need(flags.task, 'report --task <NNN-task.md> [--file <path>|-] [--from "<session name>"]');
      // Checked before the body is read: a task outside any epic must cost nothing, not block on stdin.
      if (!epics.epicOfTask(projectDir, task)) {
        process.stdout.write(`Maestro epic: "${path.basename(task)}" belongs to no epic — no report written\n`);
        break;
      }
      const r = epics.writeReport(projectDir, task, readBody(flags.file), flags.from);
      process.stdout.write(
        `Maestro epic: report ${r.id} for "${path.basename(task)}" written to ${r.file}\n` +
          (r.manager
            ? `  Now message the manager session "${r.manager}" (SendMessage) with ONE short line: report ${r.id} for ${path.basename(task)} is in ${r.file}. The file is the report; do not paste its contents.\n`
            : `  No manager session is recorded for "${r.epic}", so there is nobody to message. The report is saved and a resumed manager will list it as unacknowledged.\n`)
      );
      break;
    }
    case "reports": {
      const view = epics.showEpic(projectDir, need(positional[0], "reports <slug>"));
      process.stdout.write(
        view.unacknowledged.length
          ? `${view.unacknowledged.map((r) => `${r.id}  ${r.task}  ${r.path}`).join("\n")}\n`
          : "Maestro epic: no unacknowledged reports\n"
      );
      break;
    }
    case "ack": {
      const slug = need(positional[0], "ack <slug> <report id>... [--by <name>]");
      const ids = positional.slice(1);
      need(ids[0], "ack <slug> <report id>... [--by <name>]");
      for (const id of ids) {
        const outcome = epics.acknowledgeReport(projectDir, slug, id, flags.by);
        process.stdout.write(`Maestro epic: ${outcome === "already" ? `${id} was already acknowledged` : `acknowledged ${id}`}\n`);
      }
      break;
    }
    default:
      fail(
        "unknown command. Usage:\n  create <slug>\n  list\n  link <slug> <task.md>...\n  unlink <task.md>...\n  show <slug> [--json]\n" +
          "  set-manager <slug> <name>\n  add-worker <slug> <name>\n  remove-worker <slug> <name>\n  report --task <task.md> [--file <path>|-]\n  reports <slug>\n  ack <slug> <id>..."
      );
  }
} catch (err) {
  fail(err.message);
}
