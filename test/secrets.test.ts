import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveSecretValues,
  parseEnvFile,
  resolveAllSecrets,
  buildSanitizedEnv,
  redactSecrets,
  matchSecretFilePath,
  checkFileForSecrets,
  mergeEnvPolicies,
} from "../src/engine/secrets.js";

// ── resolveSecretValues ──

describe("resolveSecretValues", () => {
  it("resolves existing env vars", () => {
    process.env.TEST_SECRET_A = "my-secret-value";
    const result = resolveSecretValues(["TEST_SECRET_A"]);
    assert.equal(result.get("TEST_SECRET_A"), "my-secret-value");
    delete process.env.TEST_SECRET_A;
  });

  it("skips missing env vars", () => {
    delete process.env.NONEXISTENT_SECRET_VAR;
    const result = resolveSecretValues(["NONEXISTENT_SECRET_VAR"]);
    assert.equal(result.size, 0);
  });

  it("skips empty string values", () => {
    process.env.EMPTY_SECRET_VAR = "";
    const result = resolveSecretValues(["EMPTY_SECRET_VAR"]);
    assert.equal(result.size, 0);
    delete process.env.EMPTY_SECRET_VAR;
  });

  it("resolves multiple vars", () => {
    process.env.SEC_A = "aaa";
    process.env.SEC_B = "bbb";
    const result = resolveSecretValues(["SEC_A", "SEC_B"]);
    assert.equal(result.size, 2);
    assert.equal(result.get("SEC_A"), "aaa");
    assert.equal(result.get("SEC_B"), "bbb");
    delete process.env.SEC_A;
    delete process.env.SEC_B;
  });
});

// ── parseEnvFile ──

describe("parseEnvFile", () => {
  const tmpDir = path.resolve("test-env-parse-tmp");

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses KEY=VALUE pairs", () => {
    const file = path.join(tmpDir, ".env");
    fs.writeFileSync(file, "API_KEY=sk-123\nDB_HOST=localhost\n");
    const result = parseEnvFile(file);
    assert.equal(result.get("API_KEY"), "sk-123");
    assert.equal(result.get("DB_HOST"), "localhost");
  });

  it("parses double-quoted values", () => {
    const file = path.join(tmpDir, ".env-dq");
    fs.writeFileSync(file, 'SECRET="my secret value"\n');
    const result = parseEnvFile(file);
    assert.equal(result.get("SECRET"), "my secret value");
  });

  it("parses single-quoted values", () => {
    const file = path.join(tmpDir, ".env-sq");
    fs.writeFileSync(file, "SECRET='my secret value'\n");
    const result = parseEnvFile(file);
    assert.equal(result.get("SECRET"), "my secret value");
  });

  it("parses export prefix", () => {
    const file = path.join(tmpDir, ".env-export");
    fs.writeFileSync(file, "export TOKEN=abc123\n");
    const result = parseEnvFile(file);
    assert.equal(result.get("TOKEN"), "abc123");
  });

  it("skips comments and blank lines", () => {
    const file = path.join(tmpDir, ".env-comments");
    fs.writeFileSync(file, "# This is a comment\n\nKEY=value\n# Another comment\n");
    const result = parseEnvFile(file);
    assert.equal(result.size, 1);
    assert.equal(result.get("KEY"), "value");
  });

  it("skips empty values", () => {
    const file = path.join(tmpDir, ".env-empty");
    fs.writeFileSync(file, "EMPTY=\nFILLED=yes\n");
    const result = parseEnvFile(file);
    assert.equal(result.size, 1);
    assert.equal(result.get("FILLED"), "yes");
  });

  it("returns empty map for nonexistent file", () => {
    const result = parseEnvFile("/nonexistent/.env");
    assert.equal(result.size, 0);
  });

  it("skips non-matching lines", () => {
    const file = path.join(tmpDir, ".env-mixed");
    fs.writeFileSync(file, "[section]\nKEY=value\ninvalid line\n");
    const result = parseEnvFile(file);
    assert.equal(result.size, 1);
    assert.equal(result.get("KEY"), "value");
  });
});

// ── resolveAllSecrets ──

describe("resolveAllSecrets", () => {
  const tmpDir = path.resolve("test-all-secrets-tmp");

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves inject vars from process.env", () => {
    process.env.TEST_INJECT_SEC = "inject-val";
    const result = resolveAllSecrets({ inject: ["TEST_INJECT_SEC"] });
    assert.equal(result.get("TEST_INJECT_SEC"), "inject-val");
    delete process.env.TEST_INJECT_SEC;
  });

  it("resolves secrets from secret_files", () => {
    const file = path.join(tmpDir, ".env");
    fs.writeFileSync(file, "FILE_SECRET=file-val\n");
    const result = resolveAllSecrets({ secret_files: [file] });
    assert.equal(result.get("FILE_SECRET"), "file-val");
  });

  it("inject takes priority over secret_files", () => {
    process.env.OVERLAP_KEY = "from-env";
    const file = path.join(tmpDir, ".env-overlap");
    fs.writeFileSync(file, "OVERLAP_KEY=from-file\n");
    const result = resolveAllSecrets({
      inject: ["OVERLAP_KEY"],
      secret_files: [file],
    });
    assert.equal(result.get("OVERLAP_KEY"), "from-env");
    delete process.env.OVERLAP_KEY;
  });

  it("combines inject and secret_files", () => {
    process.env.ENV_VAR = "env-val";
    const file = path.join(tmpDir, ".env-combo");
    fs.writeFileSync(file, "FILE_VAR=file-val\n");
    const result = resolveAllSecrets({
      inject: ["ENV_VAR"],
      secret_files: [file],
    });
    assert.equal(result.size, 2);
    assert.equal(result.get("ENV_VAR"), "env-val");
    assert.equal(result.get("FILE_VAR"), "file-val");
    delete process.env.ENV_VAR;
  });

  it("returns empty map when no config", () => {
    const result = resolveAllSecrets({});
    assert.equal(result.size, 0);
  });
});

// ── buildSanitizedEnv ──

describe("buildSanitizedEnv", () => {
  it("inherits full env when no passthrough specified", () => {
    process.env.TEST_INJECT_KEY = "inject-value";
    const env = buildSanitizedEnv({ inject: ["TEST_INJECT_KEY"] });
    assert.equal(env.TEST_INJECT_KEY, "inject-value");
    assert.equal(env.PATH, process.env.PATH);
    delete process.env.TEST_INJECT_KEY;
  });

  it("strict mode with passthrough", () => {
    process.env.TEST_SEC = "secret";
    process.env.TEST_PASS = "pass";
    process.env.TEST_OTHER = "other";
    const env = buildSanitizedEnv({
      inject: ["TEST_SEC"],
      passthrough: ["TEST_PASS"],
    });
    assert.equal(env.TEST_SEC, "secret");
    assert.equal(env.TEST_PASS, "pass");
    assert.equal(env.TEST_OTHER, undefined);
    delete process.env.TEST_SEC;
    delete process.env.TEST_PASS;
    delete process.env.TEST_OTHER;
  });

  it("includes inject vars even without passthrough list", () => {
    process.env.MY_API_KEY = "sk-123";
    const env = buildSanitizedEnv({
      inject: ["MY_API_KEY"],
      passthrough: ["PATH"],
    });
    assert.equal(env.MY_API_KEY, "sk-123");
    assert.equal(env.PATH, process.env.PATH);
    delete process.env.MY_API_KEY;
  });

  it("injects file-derived secrets into env", () => {
    const fileSecrets = new Map([["FILE_KEY", "file-secret-val"]]);
    const env = buildSanitizedEnv({ secret_files: [".env"] }, fileSecrets);
    assert.equal(env.FILE_KEY, "file-secret-val");
  });

  it("process.env inject takes priority over fileSecrets", () => {
    process.env.OVERLAP = "from-process";
    const fileSecrets = new Map([["OVERLAP", "from-file"]]);
    const env = buildSanitizedEnv({ inject: ["OVERLAP"] }, fileSecrets);
    assert.equal(env.OVERLAP, "from-process");
    delete process.env.OVERLAP;
  });
});

// ── redactSecrets ──

describe("redactSecrets", () => {
  it("redacts exact match", () => {
    const secrets = new Map([["KEY", "sk-abc123"]]);
    assert.equal(redactSecrets("token: sk-abc123", secrets), "token: [REDACTED]");
  });

  it("redacts multiple occurrences", () => {
    const secrets = new Map([["KEY", "secret"]]);
    assert.equal(
      redactSecrets("a secret is secret", secrets),
      "a [REDACTED] is [REDACTED]",
    );
  });

  it("redacts longer values first", () => {
    const secrets = new Map([
      ["SHORT", "abc"],
      ["LONG", "abc123"],
    ]);
    const result = redactSecrets("value: abc123", secrets);
    // abc123 should be redacted as one unit, not abc then 123 left over
    assert.equal(result, "value: [REDACTED]");
  });

  it("skips empty values", () => {
    const secrets = new Map([["EMPTY", ""]]);
    assert.equal(redactSecrets("hello world", secrets), "hello world");
  });

  it("handles no secrets", () => {
    assert.equal(redactSecrets("hello", new Map()), "hello");
  });

  it("redacts across multiple lines", () => {
    const secrets = new Map([["KEY", "secret-val"]]);
    const input = "line1: secret-val\nline2: other\nline3: secret-val again";
    const expected = "line1: [REDACTED]\nline2: other\nline3: [REDACTED] again";
    assert.equal(redactSecrets(input, secrets), expected);
  });
});

// ── matchSecretFilePath ──

describe("matchSecretFilePath", () => {
  it("matches exact path", () => {
    assert.ok(matchSecretFilePath(".env", [".env"]));
  });

  it("matches absolute path", () => {
    const abs = path.resolve(".env");
    assert.ok(matchSecretFilePath(abs, [".env"]));
  });

  it("does not match different file", () => {
    assert.ok(!matchSecretFilePath("package.json", [".env"]));
  });

  it("handles tilde expansion", () => {
    const home = process.env.HOME || "";
    assert.ok(matchSecretFilePath(`${home}/.aws/credentials`, ["~/.aws/credentials"]));
  });

  it("does not match partial filename", () => {
    assert.ok(!matchSecretFilePath(".env.example", [".env"]));
  });

  it("matches subdirectory path", () => {
    // .env/something should match because .env is the parent
    assert.ok(matchSecretFilePath(".env/subfile", [".env"]));
  });
});

// ── checkFileForSecrets ──

describe("checkFileForSecrets", () => {
  const tmpDir = path.resolve("test-secret-scan-tmp");

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects secret value in file", () => {
    const tmpFile = path.join(tmpDir, "has-secret.txt");
    fs.writeFileSync(tmpFile, "API_KEY=sk-abc123\nother=stuff\n");

    const secrets = new Map([["API_KEY", "sk-abc123"]]);
    const result = checkFileForSecrets(tmpFile, secrets);
    assert.ok(result.blocked);
    assert.ok(result.reason?.includes("API_KEY"));
  });

  it("allows file without secrets", () => {
    const tmpFile = path.join(tmpDir, "no-secret.txt");
    fs.writeFileSync(tmpFile, "hello world\n");

    const secrets = new Map([["API_KEY", "sk-abc123"]]);
    const result = checkFileForSecrets(tmpFile, secrets);
    assert.ok(!result.blocked);
  });

  it("allows nonexistent file", () => {
    const secrets = new Map([["API_KEY", "sk-abc123"]]);
    const result = checkFileForSecrets("/nonexistent/file.txt", secrets);
    assert.ok(!result.blocked);
  });

  it("allows with empty secrets map", () => {
    const tmpFile = path.join(tmpDir, "any.txt");
    fs.writeFileSync(tmpFile, "API_KEY=sk-abc123\n");

    const result = checkFileForSecrets(tmpFile, new Map());
    assert.ok(!result.blocked);
  });
});

// ── mergeEnvPolicies ──

describe("mergeEnvPolicies", () => {
  it("returns undefined when both are undefined", () => {
    assert.equal(mergeEnvPolicies(undefined, undefined), undefined);
  });

  it("returns project when workflow is undefined", () => {
    const result = mergeEnvPolicies({ inject: ["A"] }, undefined);
    assert.deepEqual(result?.inject, ["A"]);
  });

  it("returns workflow when project is undefined", () => {
    const result = mergeEnvPolicies(undefined, { inject: ["B"] });
    assert.deepEqual(result?.inject, ["B"]);
  });

  it("unions inject lists", () => {
    const result = mergeEnvPolicies({ inject: ["A"] }, { inject: ["B", "A"] });
    assert.deepEqual(result?.inject?.sort(), ["A", "B"]);
  });

  it("unions passthrough lists", () => {
    const result = mergeEnvPolicies(
      { passthrough: ["PATH"] },
      { passthrough: ["HOME"] },
    );
    assert.deepEqual(result?.passthrough?.sort(), ["HOME", "PATH"]);
  });

  it("activates passthrough if either defines it", () => {
    const result = mergeEnvPolicies({ inject: ["A"] }, { passthrough: ["PATH"] });
    assert.deepEqual(result?.passthrough, ["PATH"]);
  });

  it("unions secret_files", () => {
    const result = mergeEnvPolicies(
      { secret_files: [".env"] },
      { secret_files: [".env.local"] },
    );
    assert.deepEqual(result?.secret_files?.sort(), [".env", ".env.local"]);
  });

  it("returns undefined for empty merged result", () => {
    const result = mergeEnvPolicies({}, {});
    assert.equal(result, undefined);
  });
});
