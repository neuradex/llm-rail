import { runCreate } from "./commands/create.js";
import { runStart } from "./commands/start.js";
import { runNext } from "./commands/next.js";
import { runStatus } from "./commands/status.js";
import { runQuery } from "./commands/query.js";
import { runReset } from "./commands/reset.js";
import { runList, runListWorkflows, runListInstances } from "./commands/list.js";
import { runValidate } from "./commands/validate.js";
import { runBash } from "./commands/bash.js";
import { runPolicyGenerate, runPolicyCheck, runPolicyEval } from "./commands/policy.js";
import { runPromote } from "./commands/promote.js";
import { runDocs } from "./commands/docs.js";
import { runLog } from "./commands/log.js";
import { runShow } from "./commands/show.js";
import { runSummary } from "./commands/summary.js";
import { runVariants } from "./commands/variants.js";
import { runMerge } from "./commands/merge.js";
import { runSaveVariant } from "./commands/save-variant.js";
import { resolveInstanceId } from "./engine/state.js";
import { runGlobalLog } from "./commands/global-log.js";
const args = process.argv.slice(2);

function usage(): never {
  console.error(`Usage:
  lrail docs [topic]                                  Browse documentation
  lrail log [-n <count>] [-f] [--raw]                  Show command history
  lrail wf list                                       List all workflows
  lrail wf instances [--status <status>]              List all instances
  lrail wf <name> create [--variant <v>] [--param k=v ...]  Create a new instance
  lrail wf <name> validate [--variant <v>]            Validate workflow YAML
  lrail wf <name> show [--variant <v>]                Show workflow YAML
  lrail wf <name> summary [--variant <v>] [--param k=v]  Structured summary with warnings
  lrail wf <name> variants                            List variants
  lrail wf <name> save-variant <v> --yaml '<content>'  Save a variant YAML file
  lrail wf <name> merge <variant> [--backup <name>]   Merge variant into base
  lrail wf <name> list [--status <status>]             List instances
  lrail wf <name> promote                             Suggest phase promotion
  lrail wf <name> policy check --command '<command>'  Dry-run policy check
  lrail <alias|id> start                              Begin execution
  lrail <alias|id> next --result '<json>'             Submit step result
  lrail <alias|id> status                             Check instance status
  lrail <alias|id> query [--step <stepId>]            Query instance state
  lrail <alias|id> reset <step-id>                    Reset a step
  lrail <alias|id> log [step-id] [-f]                  Show audit log (-f to follow)
  lrail <alias|id> bash '<command>'                   Execute through proxy
  lrail <alias|id> policy generate                    Generate policy from trail`);
  process.exit(1);
}

function banner(): void {
  const v = process.env.npm_package_version || "0.1.0";
  console.log(`
  ───── LLM Rail ─────
   Track & Guardrail  v${v}

  lrail docs [topic]           Browse documentation
  lrail log [-n N] [-f] [--raw] Command history
  lrail wf list                List workflows
  lrail wf <name> create       Create a new instance
  lrail wf <name> variants     List variants
  lrail <alias> start          Begin execution

  Run 'lrail docs' to get started.
`);
}

if (args.length < 1) {
  banner();
  process.exit(0);
}

const target = args[0];

// --- Global commands ---
if (target === "docs") {
  runDocs(args.slice(1).join("/"));
} else if (target === "help" || target === "--help") {
  usage();
} else if (target === "policy" && args[1] === "eval") {
  const cmdIdx = args.indexOf("--command");
  const cmd = cmdIdx !== -1 ? args[cmdIdx + 1] : undefined;
  if (!cmd) {
    console.error("Usage: lrail policy eval --command '<command>'");
    process.exit(1);
  }
  runPolicyEval(cmd);
} else if (target === "log") {
  const followFlag = args.includes("-f") || args.includes("--follow");
  const rawFlag = args.includes("--raw");
  const nIdx = args.indexOf("-n");
  const limit = nIdx !== -1 && args[nIdx + 1] ? parseInt(args[nIdx + 1], 10) : undefined;
  runGlobalLog(limit, followFlag, rawFlag);
} else if (target === "wf") {
  // --- Workflow commands: lrail wf <name> <command> ---
  const workflowName = args[1];
  const command = args[2];

  // lrail wf / lrail wf list — list all workflows
  if (!workflowName || (workflowName === "list" && !command)) {
    runListWorkflows();
    process.exit(0);
  }

  // lrail wf instances [--status <status>] — list all instances
  if (workflowName === "instances" && !command) {
    let statusFilter: string | undefined;
    const statusIdx = args.indexOf("--status");
    if (statusIdx !== -1 && args[statusIdx + 1]) {
      statusFilter = args[statusIdx + 1];
    }
    runListInstances(statusFilter);
    process.exit(0);
  }

  if (!command) {
    console.error(`Usage: lrail wf ${workflowName} <command>

Workflow commands:
  create [--variant <v>] [--param k=v]   Create a new instance
  validate [--variant <v>]               Validate workflow YAML
  show [--variant <v>]                   Show workflow YAML
  summary [--variant <v>] [--param k=v]  Structured summary with warnings
  variants                               List variants
  save-variant <v> --yaml '<content>'   Save a variant YAML file
  merge <variant> [--backup <name>]      Merge variant into base
  list [--status <status>]               List instances
  promote                                Suggest phase promotion
  policy check --command '<command>'     Dry-run policy check

Instance commands (after 'create'):
  lrail <alias> start                    Begin execution
  lrail <alias> next --result '<json>'   Submit step result
  lrail <alias> status                   Check instance status
  lrail <alias> query [--step <stepId>]  Query instance state
  lrail <alias> reset <step-id>          Reset a step
  lrail <alias> log [step-id]            Show audit log
  lrail <alias> bash '<command>'         Execute through proxy
  lrail <alias> policy generate          Generate policy from trail`);
    process.exit(1);
  }

  // Parse --variant flag (shared across subcommands)
  const variantIdx = args.indexOf("--variant");
  const variantFlag = variantIdx !== -1 ? args[variantIdx + 1] : undefined;

  switch (command) {
    case "create": {
      const params: string[] = [];
      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--param" && args[i + 1]) {
          params.push(args[i + 1]);
          i++;
        } else if (args[i] === "--variant") {
          i++; // skip value, already parsed
        }
      }
      runCreate(workflowName, params, variantFlag);
      break;
    }

    case "validate":
      runValidate(workflowName, variantFlag);
      break;

    case "show":
      runShow(workflowName, variantFlag);
      break;

    case "summary": {
      const summaryParams: string[] = [];
      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--param" && args[i + 1]) {
          summaryParams.push(args[i + 1]);
          i++;
        } else if (args[i] === "--variant") {
          i++; // skip value, already parsed
        }
      }
      runSummary(workflowName, summaryParams, variantFlag);
      break;
    }

    case "variants":
      runVariants(workflowName);
      break;

    case "save-variant": {
      const svName = args[3];
      if (!svName) {
        console.error(`Usage: lrail wf ${workflowName} save-variant <variant-name> --yaml '<content>'`);
        process.exit(1);
      }
      const yamlIdx = args.indexOf("--yaml");
      const yamlContent = yamlIdx !== -1 ? args[yamlIdx + 1] : undefined;
      const fromStdin = args.includes("--stdin");
      runSaveVariant(workflowName, svName, yamlContent, fromStdin);
      break;
    }

    case "merge": {
      const mergeVariant = args[3];
      if (!mergeVariant) {
        console.error(`Usage: lrail wf ${workflowName} merge <variant> [--backup <name>]`);
        process.exit(1);
      }
      const backupIdx = args.indexOf("--backup");
      const backupName = backupIdx !== -1 ? args[backupIdx + 1] : undefined;
      runMerge(workflowName, mergeVariant, backupName);
      break;
    }

    case "promote":
      runPromote(workflowName);
      break;

    case "list": {
      let statusFilter: string | undefined;
      const statusIdx = args.indexOf("--status");
      if (statusIdx !== -1 && args[statusIdx + 1]) {
        statusFilter = args[statusIdx + 1];
      }
      runList(workflowName, statusFilter);
      break;
    }

    case "policy": {
      const sub = args[3];
      if (sub === "check") {
        const cmdIdx = args.indexOf("--command");
        const cmd = cmdIdx !== -1 ? args[cmdIdx + 1] : undefined;
        if (!cmd) {
          console.error(`Usage: lrail wf ${workflowName} policy check --command '<command>'`);
          process.exit(1);
        }
        runPolicyCheck(workflowName, cmd);
      } else {
        console.error(`Usage: lrail wf ${workflowName} policy check --command '<command>'`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: '${command}'

Usage: lrail wf ${workflowName} <command>

Workflow commands:
  create [--variant <v>] [--param k=v]   Create a new instance
  validate [--variant <v>]               Validate workflow YAML
  show [--variant <v>]                   Show workflow YAML
  summary [--variant <v>] [--param k=v]  Structured summary with warnings
  variants                               List variants
  save-variant <v> --yaml '<content>'   Save a variant YAML file
  merge <variant> [--backup <name>]      Merge variant into base
  list [--status <status>]               List instances
  promote                                Suggest phase promotion
  policy check --command '<command>'     Dry-run policy check

Instance commands (after 'create'):
  lrail <alias> start                    Begin execution
  lrail <alias> next --result '<json>'   Submit step result
  lrail <alias> status                   Check instance status
  lrail <alias> query [--step <stepId>]  Query instance state
  lrail <alias> reset <step-id>          Reset a step
  lrail <alias> log [step-id]            Show audit log
  lrail <alias> bash '<command>'         Execute through proxy
  lrail <alias> policy generate          Generate policy from trail`);
      process.exit(1);
  }
} else {
  // --- Instance commands: lrail <alias|id> <command> ---
  const command = args[1];

  let id: string;
  try {
    id = resolveInstanceId(target);
  } catch {
    console.error(`Unknown command or instance: '${target}'`);
    console.error("Use 'lrail wf <name> create' to create a new instance.");
    usage();
  }

  if (!command) {
    console.error(`Usage: lrail ${target} <command>

Commands:
  start                        Begin execution
  next --result '<json>'       Submit step result
  status                       Check instance status
  query [--step <stepId>]      Query instance state
  reset <step-id>              Reset a step
  log [step-id] [-f]           Show audit log (-f to follow)
  bash '<command>'             Execute through proxy
  policy generate              Generate policy from trail`);
    process.exit(1);
  }

  switch (command) {
    case "start":
      runStart(id);
      break;

    case "next": {
      const resultIdx = args.indexOf("--result");
      if (resultIdx === -1 || !args[resultIdx + 1]) {
        console.error(`Usage: lrail ${target} next --result '<json>'`);
        process.exit(1);
      }
      runNext(id, args[resultIdx + 1]);
      break;
    }

    case "status":
      runStatus(id);
      break;

    case "query": {
      let stepId: string | undefined;
      const stepIdx = args.indexOf("--step");
      if (stepIdx !== -1 && args[stepIdx + 1]) {
        stepId = args[stepIdx + 1];
      }
      runQuery(id, stepId);
      break;
    }

    case "reset": {
      const stepId = args[2];
      if (!stepId) {
        console.error(`Usage: lrail ${target} reset <step-id>`);
        process.exit(1);
      }
      runReset(id, stepId);
      break;
    }

    case "bash": {
      const bashCmd = args[2];
      if (!bashCmd) {
        console.error(`Usage: lrail ${target} bash '<command>'`);
        process.exit(1);
      }
      runBash(id, bashCmd);
      break;
    }

    case "log": {
      const followFlag = args.includes("-f") || args.includes("--follow");
      const stepId = args.find((a, i) => i >= 2 && a !== "-f" && a !== "--follow");
      runLog(id, stepId, followFlag);
      break;
    }

    case "policy": {
      const sub = args[2];
      if (sub === "generate") {
        runPolicyGenerate(id);
      } else {
        console.error(`Usage: lrail ${target} policy generate`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: '${command}'

Usage: lrail ${target} <command>

Commands:
  start                        Begin execution
  next --result '<json>'       Submit step result
  status                       Check instance status
  query [--step <stepId>]      Query instance state
  reset <step-id>              Reset a step
  log [step-id] [-f]           Show audit log (-f to follow)
  bash '<command>'             Execute through proxy
  policy generate              Generate policy from trail`);
      process.exit(1);
  }
}
