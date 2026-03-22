import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkflowPath } from "../engine/variant.js";

/**
 * Save a variant YAML file for a workflow.
 *
 * Usage:
 *   lrail wf <name> save-variant <variant-name> --yaml '<yaml-string>'
 *   echo '<yaml>' | lrail wf <name> save-variant <variant-name> --stdin
 */
export function runSaveVariant(
  workflowName: string,
  variantName: string,
  yamlContent?: string,
  fromStdin?: boolean,
): void {
  if (!variantName) {
    console.error("Usage: lrail wf <name> save-variant <variant-name> --yaml '<content>'");
    process.exit(1);
  }

  // Resolve workflow directory
  const { basePath, isDirectory } = resolveWorkflowPath(workflowName);
  if (!isDirectory) {
    console.error(`Workflow '${workflowName}' must be in directory format to use variants`);
    process.exit(1);
  }

  const workflowDir = path.dirname(basePath);
  const variantPath = path.resolve(workflowDir, `${variantName}.workflow.yml`);

  let content: string;

  if (fromStdin) {
    content = fs.readFileSync(0, "utf8");
  } else if (yamlContent) {
    content = yamlContent;
  } else {
    console.error("Provide YAML content via --yaml '<content>' or --stdin");
    process.exit(1);
  }

  fs.writeFileSync(variantPath, content, "utf8");
  console.log(`Variant saved: ${variantPath}`);
  console.log(`  Validate: lrail wf ${workflowName} validate --variant ${variantName}`);
  console.log(`  Create:   lrail wf ${workflowName} create --variant ${variantName}`);
  console.log(`  Show:     lrail wf ${workflowName} show --variant ${variantName}`);
}
