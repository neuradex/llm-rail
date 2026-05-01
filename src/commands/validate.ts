import { runCompile } from "./compile.js";

/**
 * v1 has compile (a strict superset of legacy validate). validate is
 * kept as an alias for muscle memory and existing scripts: it forwards
 * to runCompile with the same arguments.
 */
export function runValidate(workflowName: string, _variant?: string, filePath?: string): void {
  runCompile({
    workflowName: filePath ? undefined : workflowName,
    filePath,
  });
}
