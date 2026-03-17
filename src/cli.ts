import { runCreate } from "./commands/create.js";
import { runStart } from "./commands/start.js";
import { runNext } from "./commands/next.js";
import { runStatus } from "./commands/status.js";

const args = process.argv.slice(2);

function usage(): never {
  console.error(`Usage:
  llm-rail create <workflow-name>
  llm-rail <id> start
  llm-rail <id> next --result '<json>'
  llm-rail <id> status`);
  process.exit(1);
}

if (args.length < 2) usage();

const first = args[0];

if (first === "create") {
  const workflowName = args[1];
  if (!workflowName) usage();
  runCreate(workflowName);
} else {
  // first arg is instance ID
  const id = first;
  const command = args[1];

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

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}
