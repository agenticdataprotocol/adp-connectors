// Copyright 2026 Datastrato, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * E2E integration tests for adp-openclaw-plugin against a real ADP Hypervisor subprocess.
 *
 * These tests require `python -m adp_hypervisor` to be installed.
 * If the module is not available, the entire suite is skipped.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, mkdirSync, existsSync, readdirSync, renameSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HypervisorClient } from "../src/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = resolve(__dirname, "..", "config");

// Check if adp-hypervisor is available
let hypervisorAvailable = false;
try {
  execSync("python -m adp_hypervisor --help", { stdio: "pipe", timeout: 10_000 });
  hypervisorAvailable = true;
} catch {
  // Not installed — tests will be skipped
}

function createTestLogger() {
  const messages: { level: string; message: string }[] = [];
  return {
    logger: {
      debug: (msg: string) => messages.push({ level: "debug", message: msg }),
      info: (msg: string) => messages.push({ level: "info", message: msg }),
      warn: (msg: string) => messages.push({ level: "warn", message: msg }),
      error: (msg: string) => messages.push({ level: "error", message: msg }),
    },
    messages,
  };
}

/**
 * Prepare a temporary working directory for the Hypervisor.
 *
 * Layout:
 *   <tempBase>/manifests/   ← copied from source config
 *   <tempBase>/data/        ← matches physical.yaml.template `uri: "./data"`
 *   <tempBase>/logs/        ← matches logging_conf.yaml.template `filename: ./logs/hypervisor.log`
 *
 * The Hypervisor is spawned with `cwd: tempBase`, so all relative paths in
 * the manifests resolve correctly — no patching required.
 */
function prepareTempWorkDir(): { workDir: string; manifestsPath: string; cleanup: () => void } {
  const workDir = mkdtempSync(join(tmpdir(), "adp-e2e-"));
  const manifestsPath = join(workDir, "manifests");

  mkdirSync(manifestsPath, { recursive: true });
  mkdirSync(join(workDir, "data"), { recursive: true });
  mkdirSync(join(workDir, "logs"), { recursive: true });

  cpSync(MANIFESTS_DIR, manifestsPath, { recursive: true });

  // Rename .yaml.template → .yaml so the Hypervisor can load them
  for (const f of readdirSync(manifestsPath)) {
    if (f.endsWith(".yaml.template")) {
      renameSync(join(manifestsPath, f), join(manifestsPath, f.replace(/\.yaml\.template$/, ".yaml")));
    }
  }

  // Seed sample data if present alongside config
  const dataDir = join(dirname(MANIFESTS_DIR), "data");
  if (existsSync(dataDir)) {
    cpSync(dataDir, join(workDir, "data"), { recursive: true });
  }

  return {
    workDir,
    manifestsPath,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

describe.skipIf(!hypervisorAvailable)("HypervisorClient E2E (real hypervisor)", () => {
  let client: HypervisorClient;
  let testLogger: ReturnType<typeof createTestLogger>;
  let tempCleanup: () => void;
  let manifestsPath: string;
  let workDir: string;

  beforeAll(async () => {
    const temp = prepareTempWorkDir();
    manifestsPath = temp.manifestsPath;
    workDir = temp.workDir;
    tempCleanup = temp.cleanup;

    testLogger = createTestLogger();
    client = new HypervisorClient(testLogger.logger);
    client.spawn("python", ["-m", "adp_hypervisor", "--config", manifestsPath], undefined, workDir);
    await client.initialize();
    client.setAuthorization("admin");
  }, 15_000);

  afterAll(async () => {
    await client.close();
    tempCleanup();
  }, 10_000);

  describe("discover", () => {
    it("lists demo domain resources", { timeout: 15_000 }, async () => {
      const result = await client.discover();
      expect(result.resources).toHaveLength(3);

      const ids = result.resources.map((r) => r.resourceId).sort();
      expect(ids).toEqual(["demo:invoices", "demo:notes", "demo:reports"]);
    });

    it("filters by domain prefix", { timeout: 15_000 }, async () => {
      const result = await client.discover({ domainPrefix: "demo" });
      expect(result.resources.length).toBeGreaterThanOrEqual(1);
      for (const resource of result.resources) {
        expect(resource.resourceId).toMatch(/^demo:/);
      }
    });
  });

  describe("describe", () => {
    it("returns usage contract", { timeout: 15_000 }, async () => {
      const result = await client.describe("demo:notes", "QUERY");
      expect(result.resourceId).toBe("demo:notes");
      expect(result.intentClass).toBe("QUERY");
      expect(result.usageContract).toBeDefined();
      expect(result.usageContract.fields.length).toBeGreaterThan(0);

      const fieldIds = result.usageContract.fields.map((f) => f.fieldId);
      expect(fieldIds).toContain("path");
    });
  });

  describe("validate", () => {
    it("accepts valid intent", { timeout: 15_000 }, async () => {
      const result = await client.validate({
        intentClass: "QUERY",
        resourceId: "demo:notes",
        predicates: { fieldId: "path", op: "EQ", value: "test.txt" },
      });
      expect(result.valid).toBe(true);
      expect(result.issues ?? []).toHaveLength(0);
    });

    it("rejects invalid intent", { timeout: 15_000 }, async () => {
      const result = await client.validate({
        intentClass: "QUERY",
        resourceId: "demo:notes",
        predicates: { op: "AND", predicates: [] },
      });
      expect(result.valid === false || (result.issues && result.issues.length > 0)).toBe(true);
    });
  });

  describe("execute", () => {
    const testFileName = `e2e-test-${Date.now()}.txt`;

    it("INGEST + QUERY round-trip", { timeout: 15_000 }, async () => {
      const ingestResult = await client.execute({
        intentClass: "INGEST",
        resourceId: "demo:notes",
        payload: [
          {
            path: testFileName,
            content: "Hello from E2E test",
          },
        ],
      });
      expect(ingestResult.results).toBeDefined();

      const queryResult = await client.execute({
        intentClass: "QUERY",
        resourceId: "demo:notes",
        predicates: { fieldId: "path", op: "EQ", value: testFileName },
      });
      expect(queryResult.results.length).toBeGreaterThanOrEqual(1);

      const record = queryResult.results[0];
      expect(record.path).toBe(testFileName);
    });

    it("REVISE: updates existing record", { timeout: 15_000 }, async () => {
      const reviseResult = await client.execute({
        intentClass: "REVISE",
        resourceId: "demo:notes",
        predicates: { fieldId: "path", op: "EQ", value: testFileName },
        payload: { content: "Updated E2E content" },
      });
      expect(reviseResult.results).toBeDefined();

      const queryResult = await client.execute({
        intentClass: "QUERY",
        resourceId: "demo:notes",
        predicates: { fieldId: "path", op: "EQ", value: testFileName },
      });
      expect(queryResult.results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("default role", () => {
    it("default role can read demo resources", { timeout: 15_000 }, async () => {
      const defaultLogger = createTestLogger();
      const defaultClient = new HypervisorClient(defaultLogger.logger);
      try {
        defaultClient.spawn(
          "python",
          ["-m", "adp_hypervisor", "--config", manifestsPath],
          undefined,
          workDir,
        );
        await defaultClient.initialize();
        defaultClient.setAuthorization("unknown-user");

        const result = await defaultClient.discover();
        expect(result.resources.length).toBeGreaterThanOrEqual(1);
        const ids = result.resources.map((r) => r.resourceId);
        expect(ids).toContain("demo:notes");
      } finally {
        await defaultClient.close();
      }
    });
  });

  describe("RBAC", () => {
    it("viewer cannot INGEST", { timeout: 15_000 }, async () => {
      const viewerLogger = createTestLogger();
      const viewerClient = new HypervisorClient(viewerLogger.logger);

      try {
        viewerClient.spawn(
          "python",
          ["-m", "adp_hypervisor", "--config", manifestsPath],
          undefined,
          workDir,
        );
        await viewerClient.initialize();
        viewerClient.setAuthorization("bob");

        await expect(
          viewerClient.execute({
            intentClass: "INGEST",
            resourceId: "demo:notes",
            payload: [{ path: "should-fail.txt", content: "denied" }],
          }),
        ).rejects.toThrow();
      } finally {
        await viewerClient.close();
      }
    });
  });
});
