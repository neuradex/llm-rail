import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyRule } from "../src/engine/ops-v1.js";
import type { AssertionRule } from "../src/types.js";

const rule = (
  op: AssertionRule["op"],
  field = "f",
  value?: unknown,
  message?: string,
): AssertionRule => {
  const r: AssertionRule = { field, op };
  if (value !== undefined) r.value = value;
  if (message !== undefined) r.message = message;
  return r;
};

// ── exists ──
describe("ops-v1 exists", () => {
  it("returns null for any value (presence is enforced via schema required)", () => {
    assert.equal(applyRule(rule("exists"), "x"), null);
    assert.equal(applyRule(rule("exists"), 0), null);
    assert.equal(applyRule(rule("exists"), false), null);
    assert.equal(applyRule(rule("exists"), null), null);
    assert.equal(applyRule(rule("exists"), undefined), null);
  });
});

// ── not_empty ──
describe("ops-v1 not_empty", () => {
  it("rejects empty string", () => {
    assert.match(applyRule(rule("not_empty"), "")!, /must not be empty/);
  });
  it("rejects empty array", () => {
    assert.match(applyRule(rule("not_empty"), [])!, /must not be empty/);
  });
  it("rejects empty object", () => {
    assert.match(applyRule(rule("not_empty"), {})!, /must not be empty/);
  });
  it("accepts non-empty string", () => {
    assert.equal(applyRule(rule("not_empty"), "x"), null);
  });
  it("accepts non-empty array", () => {
    assert.equal(applyRule(rule("not_empty"), [0]), null);
  });
  it("accepts non-empty object", () => {
    assert.equal(applyRule(rule("not_empty"), { a: 1 }), null);
  });
  it("accepts numeric 0 (not considered empty)", () => {
    assert.equal(applyRule(rule("not_empty"), 0), null);
  });
  it("accepts boolean false (not considered empty)", () => {
    assert.equal(applyRule(rule("not_empty"), false), null);
  });
});

// ── type ──
describe("ops-v1 type", () => {
  it("accepts matching primitive", () => {
    assert.equal(applyRule(rule("type", "f", "string"), "x"), null);
    assert.equal(applyRule(rule("type", "f", "number"), 1), null);
    assert.equal(applyRule(rule("type", "f", "boolean"), true), null);
  });
  it("treats arrays distinctly from objects", () => {
    assert.equal(applyRule(rule("type", "f", "array"), [1, 2]), null);
    assert.match(applyRule(rule("type", "f", "object"), [1])!, /must be type 'object'/);
  });
  it("treats objects as 'object'", () => {
    assert.equal(applyRule(rule("type", "f", "object"), { a: 1 }), null);
    assert.match(applyRule(rule("type", "f", "string"), { a: 1 })!, /must be type 'string'/);
  });
});

// ── min_length / max_length / length ──
describe("ops-v1 min_length / max_length / length", () => {
  it("min_length on string", () => {
    assert.equal(applyRule(rule("min_length", "f", 3), "abc"), null);
    assert.match(applyRule(rule("min_length", "f", 3), "ab")!, /min_length 3 \(got 2\)/);
  });
  it("min_length on array", () => {
    assert.equal(applyRule(rule("min_length", "f", 2), [1, 2]), null);
    assert.match(applyRule(rule("min_length", "f", 2), [1])!, /min_length 2 \(got 1\)/);
  });
  it("max_length on string", () => {
    assert.equal(applyRule(rule("max_length", "f", 3), "abc"), null);
    assert.match(applyRule(rule("max_length", "f", 3), "abcd")!, /max_length 3 \(got 4\)/);
  });
  it("max_length on array", () => {
    assert.match(applyRule(rule("max_length", "f", 2), [1, 2, 3])!, /max_length 2 \(got 3\)/);
  });
  it("length on string (exact)", () => {
    assert.equal(applyRule(rule("length", "f", 3), "abc"), null);
    assert.match(applyRule(rule("length", "f", 3), "ab")!, /length 3 \(got 2\)/);
    assert.match(applyRule(rule("length", "f", 3), "abcd")!, /length 3 \(got 4\)/);
  });
  it("length on array (exact)", () => {
    assert.equal(applyRule(rule("length", "f", 3), [1, 2, 3]), null);
  });
  it("silent-passes on non-string-non-array (use 'type' to enforce shape)", () => {
    assert.equal(applyRule(rule("min_length", "f", 5), 3), null);
    assert.equal(applyRule(rule("max_length", "f", 5), 3), null);
    assert.equal(applyRule(rule("length", "f", 5), 3), null);
  });
});

// ── min / max / between ──
describe("ops-v1 min / max / between", () => {
  it("min on number", () => {
    assert.equal(applyRule(rule("min", "f", 5), 5), null);
    assert.equal(applyRule(rule("min", "f", 5), 6), null);
    assert.match(applyRule(rule("min", "f", 5), 4)!, /must be >= 5 \(got 4\)/);
  });
  it("max on number", () => {
    assert.equal(applyRule(rule("max", "f", 5), 5), null);
    assert.equal(applyRule(rule("max", "f", 5), 4), null);
    assert.match(applyRule(rule("max", "f", 5), 6)!, /must be <= 5 \(got 6\)/);
  });
  it("between (inclusive)", () => {
    assert.equal(applyRule(rule("between", "f", [1, 10]), 5), null);
    assert.equal(applyRule(rule("between", "f", [1, 10]), 1), null);
    assert.equal(applyRule(rule("between", "f", [1, 10]), 10), null);
    assert.match(applyRule(rule("between", "f", [1, 10]), 11)!, /must be between 1 and 10 \(got 11\)/);
    assert.match(applyRule(rule("between", "f", [1, 10]), 0)!, /must be between 1 and 10 \(got 0\)/);
  });
  it("between requires 2-element array", () => {
    assert.equal(applyRule(rule("between", "f", [1]), 5), null);
    assert.equal(applyRule(rule("between", "f", "1,10"), 5), null);
  });
  it("min/max silent-pass on non-number", () => {
    assert.equal(applyRule(rule("min", "f", 5), "x"), null);
    assert.equal(applyRule(rule("max", "f", 5), "x"), null);
  });
});

// ── eq / neq ──
describe("ops-v1 eq / neq", () => {
  it("eq strict equality", () => {
    assert.equal(applyRule(rule("eq", "f", 5), 5), null);
    assert.equal(applyRule(rule("eq", "f", "x"), "x"), null);
    assert.match(applyRule(rule("eq", "f", 5), "5")!, /must equal 5/);
    assert.match(applyRule(rule("eq", "f", 5), 6)!, /must equal 5/);
  });
  it("neq strict equality", () => {
    assert.equal(applyRule(rule("neq", "f", 5), 6), null);
    assert.match(applyRule(rule("neq", "f", 5), 5)!, /must not equal 5/);
  });
  it("eq on objects/arrays uses reference identity (likely fails for distinct refs)", () => {
    // This is the documented behavior: strict === for ref types.
    assert.match(applyRule(rule("eq", "f", { a: 1 }), { a: 1 })!, /must equal/);
  });
});

// ── gt / gte / lt / lte ──
describe("ops-v1 gt / gte / lt / lte", () => {
  it("gt", () => {
    assert.equal(applyRule(rule("gt", "f", 5), 6), null);
    assert.match(applyRule(rule("gt", "f", 5), 5)!, /must be > 5/);
    assert.match(applyRule(rule("gt", "f", 5), 4)!, /must be > 5/);
  });
  it("gte", () => {
    assert.equal(applyRule(rule("gte", "f", 5), 5), null);
    assert.equal(applyRule(rule("gte", "f", 5), 6), null);
    assert.match(applyRule(rule("gte", "f", 5), 4)!, /must be >= 5/);
  });
  it("lt", () => {
    assert.equal(applyRule(rule("lt", "f", 5), 4), null);
    assert.match(applyRule(rule("lt", "f", 5), 5)!, /must be < 5/);
  });
  it("lte", () => {
    assert.equal(applyRule(rule("lte", "f", 5), 5), null);
    assert.match(applyRule(rule("lte", "f", 5), 6)!, /must be <= 5/);
  });
  it("silent-pass on non-number", () => {
    assert.equal(applyRule(rule("gt", "f", 5), "x"), null);
  });
});

// ── contains / not_contains ──
describe("ops-v1 contains / not_contains", () => {
  it("contains substring", () => {
    assert.equal(applyRule(rule("contains", "f", "foo"), "barfoo"), null);
    assert.match(applyRule(rule("contains", "f", "zzz"), "barfoo")!, /must contain 'zzz'/);
  });
  it("contains array element (strict eq)", () => {
    assert.equal(applyRule(rule("contains", "f", 2), [1, 2, 3]), null);
    assert.match(applyRule(rule("contains", "f", 5), [1, 2, 3])!, /must contain 5/);
  });
  it("not_contains substring", () => {
    assert.equal(applyRule(rule("not_contains", "f", "zzz"), "barfoo"), null);
    assert.match(applyRule(rule("not_contains", "f", "foo"), "barfoo")!, /must not contain 'foo'/);
  });
  it("not_contains array element", () => {
    assert.equal(applyRule(rule("not_contains", "f", 9), [1, 2, 3]), null);
    assert.match(applyRule(rule("not_contains", "f", 2), [1, 2, 3])!, /must not contain 2/);
  });
  it("silent-pass on non-string-non-array", () => {
    assert.equal(applyRule(rule("contains", "f", "x"), 42), null);
    assert.equal(applyRule(rule("not_contains", "f", "x"), 42), null);
  });
});

// ── matches ──
describe("ops-v1 matches", () => {
  it("matches simple regex", () => {
    assert.equal(applyRule(rule("matches", "f", "^abc"), "abcdef"), null);
    assert.match(applyRule(rule("matches", "f", "^xyz"), "abcdef")!, /must match pattern '\^xyz'/);
  });
  it("matches with flags-style chars", () => {
    assert.equal(applyRule(rule("matches", "f", "[A-Z]+"), "HELLO"), null);
  });
  it("invalid regex surfaces a clear error", () => {
    const err = applyRule(rule("matches", "f", "(unclosed"), "x");
    assert.match(err!, /invalid regex pattern/);
  });
  it("silent-pass on non-string", () => {
    assert.equal(applyRule(rule("matches", "f", "^x"), 42), null);
    assert.equal(applyRule(rule("matches", "f", "^x"), [1]), null);
  });
});

// ── one_of ──
describe("ops-v1 one_of", () => {
  it("accepts membership", () => {
    assert.equal(applyRule(rule("one_of", "f", ["a", "b", "c"]), "b"), null);
  });
  it("rejects non-member", () => {
    assert.match(applyRule(rule("one_of", "f", ["a", "b"]), "c")!, /must be one of \[a, b\]/);
  });
  it("silent-pass when expected is not an array", () => {
    assert.equal(applyRule(rule("one_of", "f", "a,b,c"), "b"), null);
  });
});

// ── each_has ──
describe("ops-v1 each_has", () => {
  it("accepts array of objects each having the key", () => {
    assert.equal(applyRule(rule("each_has", "f", "id"), [{ id: 1 }, { id: 2 }]), null);
  });
  it("rejects when one item is missing the key", () => {
    assert.match(
      applyRule(rule("each_has", "f", "id"), [{ id: 1 }, { name: "x" }])!,
      /\[1\]' must have key 'id'/,
    );
  });
  it("rejects when an item is not an object", () => {
    assert.match(
      applyRule(rule("each_has", "f", "id"), [{ id: 1 }, "oops"])!,
      /must have key 'id'/,
    );
  });
  it("silent-pass on non-array value", () => {
    assert.equal(applyRule(rule("each_has", "f", "id"), { id: 1 }), null);
  });
});

// ── script ──
describe("ops-v1 script", () => {
  it("passes when shell exits 0", () => {
    assert.equal(applyRule(rule("script", "f", "true"), "anything"), null);
  });
  it("fails with stderr when shell exits non-zero", () => {
    const err = applyRule(rule("script", "f", "echo 'oops' >&2; exit 2"), "x");
    assert.match(err!, /script assertion failed/);
    assert.match(err!, /oops/);
  });
  it("exposes FIELD_VALUE as env", () => {
    assert.equal(
      applyRule(
        rule("script", "f", `[ "$FIELD_VALUE" = '"hello"' ]`),
        "hello",
      ),
      null,
    );
  });
  it("FIELD_VALUE is JSON-encoded for objects", () => {
    assert.equal(
      applyRule(
        rule("script", "f", `echo "$FIELD_VALUE" | grep -q '"a":1'`),
        { a: 1 },
      ),
      null,
    );
  });

  // Cross-field assertions were impossible before STEP_OUTPUT: a rule declared on
  // one field could not see its siblings. Authors reached for an env var that did not
  // exist, and `JSON.parse(process.env.CONTEXT || "{}")` made the assertion pass
  // vacuously instead of failing — silent, and invisible in logs.
  it("exposes the whole step output as STEP_OUTPUT", () => {
    assert.equal(
      applyRule(
        rule("script", "has_relation", `echo "$STEP_OUTPUT" | grep -q '"subject_hint":"entity:e1"'`),
        true,
        { has_relation: true, subject_hint: "entity:e1", object_hint: "entity:e2" },
      ),
      null,
    );
  });

  it("STEP_OUTPUT lets a rule check sibling fields — the case that used to be dead", () => {
    const crossField = rule(
      "script",
      "has_relation",
      `node -e '
        const ctx = JSON.parse(process.env.STEP_OUTPUT || "{}");
        if (ctx.has_relation !== true) process.exit(0);
        if (!/^entity:/.test(ctx.subject_hint || "")) {
          console.error("subject_hint must be entity:<id>");
          process.exit(1);
        }
      '`,
    );
    // sibling is well-formed → passes
    assert.equal(
      applyRule(crossField, true, { has_relation: true, subject_hint: "entity:e1" }),
      null,
    );
    // sibling is malformed → fails, and says why
    const err = applyRule(crossField, true, { has_relation: true, subject_hint: "User" });
    assert.match(err!, /subject_hint must be entity/);
  });

  // CONTEXT is intentionally NOT provided. Scripts that read it have been passing
  // vacuously; switching them on by stealth would flip them to failing every
  // submission, because at least one also depends on a per-rule `env:` map this
  // engine drops. Opting in via STEP_OUTPUT forces the author to look once.
  it("does not provide CONTEXT — silent revival is as bad as silent death", () => {
    assert.equal(
      applyRule(
        rule("script", "f", `[ -z "$CONTEXT" ]`),
        "x",
        { f: "x", sibling: 1 },
      ),
      null,
    );
  });

  it("rule env reaches the script", () => {
    assert.equal(
      applyRule(
        rule("script", "f", `[ "$PAIR_A" = "e1" ]`),
        "x",
        { f: "x" },
        { PAIR_A: "e1" },
      ),
      null,
    );
  });

  // A declared `env:` that never arrives is the failure that hides: the script
  // compares against undefined, the comparison is false, and the assertion rejects
  // every submission. Before this was wired, ontology-fixer's pair check would have
  // done exactly that the moment anything revived it.
  it("missing rule env makes the comparison fail loudly, not silently pass", () => {
    const pairCheck = rule(
      "script",
      "has_relation",
      `node -e '
        const ctx = JSON.parse(process.env.STEP_OUTPUT || "{}");
        const a = process.env.PAIR_A, b = process.env.PAIR_B;
        if (ctx.subject !== a || ctx.object !== b) {
          console.error("subject/object must match the input pair (" + a + ", " + b + ")");
          process.exit(1);
        }
      '`,
    );
    const output = { has_relation: true, subject: "e1", object: "e2" };
    // env supplied → passes
    assert.equal(applyRule(pairCheck, true, output, { PAIR_A: "e1", PAIR_B: "e2" }), null);
    // env missing → rejects, and the message names what was compared
    const err = applyRule(pairCheck, true, output);
    assert.match(err!, /must match the input pair/);
  });

  it("engine-owned names win over a rule env typo", () => {
    assert.equal(
      applyRule(
        rule("script", "f", `[ "$FIELD_VALUE" = '"real"' ]`),
        "real",
        { f: "real" },
        { FIELD_VALUE: "hijacked" },
      ),
      null,
    );
  });

  it("without output, STEP_OUTPUT is {} — the field is still checkable", () => {
    assert.equal(
      applyRule(rule("script", "f", `[ "$STEP_OUTPUT" = '{}' ] && [ "$FIELD_VALUE" = '"x"' ]`), "x"),
      null,
    );
  });
});

// ── unknown op ──
describe("ops-v1 unknown op", () => {
  it("returns clear error for unknown operator", () => {
    const r = { field: "f", op: "no_such_op" } as unknown as AssertionRule;
    const err = applyRule(r, "x");
    assert.match(err!, /Unknown assertion op: 'no_such_op'/);
  });
});

// ── custom message ──
describe("ops-v1 custom message", () => {
  it("replaces default error text with rule.message on failure", () => {
    const err = applyRule(rule("min", "amount", 10, "amount must be at least 10"), 3);
    assert.equal(err, "Field 'amount': amount must be at least 10");
  });
  it("does not surface message on success", () => {
    assert.equal(applyRule(rule("min", "amount", 10, "amount must be at least 10"), 99), null);
  });
});
