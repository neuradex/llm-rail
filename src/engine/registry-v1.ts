import * as fs from "node:fs";
import * as path from "node:path";
import { loadYaml, resolvePackageDir } from "../util.js";
import { isV1Workflow, type WorkflowV1Def } from "../types-v1.js";
import type { V1WorkflowRegistry } from "./call-v1.js";

/**
 * Build a registry that resolves workflow names against the user's
 * `workflows/` directory first, then the package's `builtins/` directory.
 *
 * Both single-file (`workflows/<name>.yml`) and directory-style
 * (`workflows/<name>/workflow.yml`) layouts are supported. Files that
 * are not v1 are silently skipped — `call` to a legacy workflow is not
 * meaningful in the v1 runtime.
 */
export function makeFilesystemV1Registry(): V1WorkflowRegistry {
  const cache = new Map<string, WorkflowV1Def | null>();

  const candidates = (name: string): string[] => {
    const userDir = path.resolve("workflows");
    const builtinsDir = resolvePackageDir("builtins");
    const dirs = [userDir, builtinsDir].filter(Boolean);
    const out: string[] = [];
    for (const d of dirs) {
      out.push(path.resolve(d, `${name}.yml`));
      out.push(path.resolve(d, `${name}.yaml`));
      out.push(path.resolve(d, name, "workflow.yml"));
      out.push(path.resolve(d, name, "workflow.yaml"));
    }
    return out;
  };

  return {
    load(name: string): WorkflowV1Def | undefined {
      if (cache.has(name)) return cache.get(name) ?? undefined;

      for (const candidate of candidates(name)) {
        if (!fs.existsSync(candidate)) continue;
        try {
          const raw = loadYaml<unknown>(candidate);
          if (isV1Workflow(raw) && raw.name === name) {
            cache.set(name, raw);
            return raw;
          }
        } catch {
          /* skip unreadable */
        }
      }
      cache.set(name, null);
      return undefined;
    },
  };
}
