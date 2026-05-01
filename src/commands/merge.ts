/**
 * Variant merging is a legacy-only feature. v1 variants are an open
 * follow-up RFC; until then this command surfaces a migration message.
 */
export function runMerge(workflowName: string, variantName: string, _backup?: string): void {
  console.error(
    [
      `Variants are not yet supported in v1 (workflow '${workflowName}', variant '${variantName}').`,
      `Track the follow-up RFC for v1 variant semantics.`,
      `If you have a legacy workflow with variants, run 'lrail wf migrate' to convert the base, then re-author variants once v1 variant support lands.`,
    ].join("\n"),
  );
  process.exit(1);
}
