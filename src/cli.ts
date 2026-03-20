import { runCreate } from "./commands/create.js";
import { runStart } from "./commands/start.js";
import { runNext } from "./commands/next.js";
import { runStatus } from "./commands/status.js";
import { runQuery } from "./commands/query.js";
import { runReset } from "./commands/reset.js";
import { runList } from "./commands/list.js";
import { runValidate } from "./commands/validate.js";
import { runBash } from "./commands/bash.js";
import { runPolicyGenerate, runPolicyCheck } from "./commands/policy.js";

const args = process.argv.slice(2);

function usage(): never {
  console.error(`Usage:
  llm-rail create <workflow-name> [--param k=v ...]
  llm-rail <id> start
  llm-rail <id> next --result '<json>'
  llm-rail <id> status
  llm-rail <id> query [--step <stepId>]
  llm-rail <id> reset <step-id>
  llm-rail <id> bash '<command>'
  llm-rail list [--status <status>]
  llm-rail validate <workflow-name>
  llm-rail policy generate <id> --workflow <name>
  llm-rail policy check <workflow-name> --command '<command>'`);
  process.exit(1);
}

if (args.length < 1) usage();

const first = args[0];

if (first === "create") {
  const workflowName = args[1];
  if (!workflowName) usage();
  // Parse --param flags
  const params: string[] = [];
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--param" && args[i + 1]) {
      params.push(args[i + 1]);
      i++;
    }
  }
  runCreate(workflowName, params);
} else if (first === "list") {
  let statusFilter: string | undefined;
  const statusIdx = args.indexOf("--status");
  if (statusIdx !== -1 && args[statusIdx + 1]) {
    statusFilter = args[statusIdx + 1];
  }
  runList(statusFilter);
} else if (first === "validate") {
  const workflowName = args[1];
  if (!workflowName) usage();
  runValidate(workflowName);
} else if (first === "policy") {
  const subcommand = args[1];
  if (subcommand === "generate") {
    const instanceId = args[2];
    const wfIdx = args.indexOf("--workflow");
    const workflowName = wfIdx !== -1 ? args[wfIdx + 1] : undefined;
    if (!instanceId || !workflowName) {
      console.error("Usage: llm-rail policy generate <id> --workflow <name>");
      process.exit(1);
    }
    runPolicyGenerate(instanceId, workflowName);
  } else if (subcommand === "check") {
    const workflowName = args[2];
    const cmdIdx = args.indexOf("--command");
    const command = cmdIdx !== -1 ? args[cmdIdx + 1] : undefined;
    if (!workflowName || !command) {
      console.error("Usage: llm-rail policy check <workflow-name> --command '<command>'");
      process.exit(1);
    }
    runPolicyCheck(workflowName, command);
  } else {
    usage();
  }
} else {
  // first arg is instance ID
  const id = first;
  const command = args[1];

  if (!command) usage();

  switch (command) {
    case "start":
      runStart(id);
      break;

    case "next": {
      const resultIdx = args.indexOf("--result");
      if (resultIdx === -1 || !args[resultIdx + 1]) {
        console.error("Missing --result argument");
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
        console.error("Missing step-id for reset command");
        process.exit(1);
      }
      runReset(id, stepId);
      break;
    }

    case "bash": {
      const bashCmd = args[2];
      if (!bashCmd) {
        console.error("Missing command for bash");
        process.exit(1);
      }
      runBash(id, bashCmd);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}
