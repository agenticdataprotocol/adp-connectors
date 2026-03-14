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
import { mkdtempSync, cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HypervisorClient } from "../src/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = resolve(__dirname, "..", "manifests");

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
 *   <tempBase>/manifests/   ← copied from source manifests
 *   <tempBase>/data/        ← matches physical.yaml `uri: "./data"`
 *   <tempBase>/logs/        ← matches logging_conf.yaml `filename: ./logs/hypervisor.log`
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

	// Seed the people CSV so system:people has data
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
		client.setAuthorization("minghuang");
	}, 15_000);

	afterAll(async () => {
		await client.close();
		tempCleanup();
	}, 10_000);

	describe("discover", () => {
		it("lists release domain resources", { timeout: 15_000 }, async () => {
			const result = await client.discover();
			expect(result.resources).toHaveLength(5);

			const ids = result.resources.map((r) => r.resourceId).sort();
			expect(ids).toEqual([
				"release:candidates",
				"release:checklist",
				"release:releases",
				"release:votes",
				"system:people",
			]);
		});

		it("filters by domain prefix", { timeout: 15_000 }, async () => {
			const result = await client.discover({ domainPrefix: "release" });
			expect(result.resources.length).toBeGreaterThanOrEqual(1);
			for (const resource of result.resources) {
				expect(resource.resourceId).toMatch(/^release:/);
			}
		});
	});

	describe("describe", () => {
		it("returns usage contract", { timeout: 15_000 }, async () => {
			const result = await client.describe("release:releases", "QUERY");
			expect(result.resourceId).toBe("release:releases");
			expect(result.intentClass).toBe("QUERY");
			expect(result.usageContract).toBeDefined();
			expect(result.usageContract.fields.length).toBeGreaterThan(0);

			const fieldIds = result.usageContract.fields.map((f) => f.fieldId);
			expect(fieldIds).toContain("version");
			expect(fieldIds).toContain("status");
		});
	});

	describe("validate", () => {
		it("accepts valid intent", { timeout: 15_000 }, async () => {
			const result = await client.validate({
				intentClass: "QUERY",
				resourceId: "release:releases",
				predicates: { fieldId: "version", op: "EQ", value: "1.0.0" },
			});
			expect(result.valid).toBe(true);
			expect(result.issues ?? []).toHaveLength(0);
		});

		it("rejects invalid intent", { timeout: 15_000 }, async () => {
			const result = await client.validate({
				intentClass: "QUERY",
				resourceId: "release:releases",
				// Missing predicates — send an empty predicate group
				predicates: { op: "AND", predicates: [] },
			});
			// The hypervisor should either report invalid or return issues
			expect(result.valid === false || (result.issues && result.issues.length > 0)).toBe(true);
		});
	});

	describe("execute", () => {
		const testVersion = `e2e-test-${Date.now()}`;

		it("INGEST + QUERY round-trip", { timeout: 15_000 }, async () => {
			// INGEST a release record
			const ingestResult = await client.execute({
				intentClass: "INGEST",
				resourceId: "release:releases",
				payload: [
					{
						version: testVersion,
						status: "planning",
						current_phase: 1,
						rm_name: "Test User",
						rm_asfid: "testuser",
					},
				],
			});
			expect(ingestResult.results).toBeDefined();

			// QUERY the record back
			const queryResult = await client.execute({
				intentClass: "QUERY",
				resourceId: "release:releases",
				predicates: { fieldId: "version", op: "EQ", value: testVersion },
			});
			expect(queryResult.results.length).toBeGreaterThanOrEqual(1);

			const record = queryResult.results[0];
			expect(record.version).toBe(testVersion);
			expect(record.status).toBe("planning");
			expect(record.rm_name).toBe("Test User");
		});

		it("REVISE: updates existing record", { timeout: 15_000 }, async () => {
			// REVISE the status field
			const reviseResult = await client.execute({
				intentClass: "REVISE",
				resourceId: "release:releases",
				predicates: { fieldId: "version", op: "EQ", value: testVersion },
				payload: { status: "preparation" },
			});
			expect(reviseResult.results).toBeDefined();

			// QUERY to verify the update
			const queryResult = await client.execute({
				intentClass: "QUERY",
				resourceId: "release:releases",
				predicates: { fieldId: "version", op: "EQ", value: testVersion },
			});
			expect(queryResult.results.length).toBeGreaterThanOrEqual(1);
			expect(queryResult.results[0].status).toBe("preparation");
		});
	});

	describe("system:people", () => {
		it("system:people is visible to default role", { timeout: 15_000 }, async () => {
			const defaultLogger = createTestLogger();
			const defaultClient = new HypervisorClient(defaultLogger.logger);
			try {
				defaultClient.spawn("python", ["-m", "adp_hypervisor", "--config", manifestsPath], undefined, workDir);
				await defaultClient.initialize();
				defaultClient.setAuthorization("unknown-user");

				const result = await defaultClient.discover();
				expect(result.resources.length).toBeGreaterThanOrEqual(1);
				const ids = result.resources.map((r) => r.resourceId);
				expect(ids).toContain("system:people");
			} finally {
				await defaultClient.close();
			}
		});
	});

	describe("RBAC", () => {
		it("viewer cannot INGEST", { timeout: 15_000 }, async () => {
			// Create a second client with viewer role
			const viewerLogger = createTestLogger();
			const viewerClient = new HypervisorClient(viewerLogger.logger);

			try {
				viewerClient.spawn("python", ["-m", "adp_hypervisor", "--config", manifestsPath], undefined, workDir);
				await viewerClient.initialize();
				viewerClient.setAuthorization("bob");

				await expect(
					viewerClient.execute({
						intentClass: "INGEST",
						resourceId: "release:releases",
						payload: [{ version: "should-fail", status: "planning" }],
					}),
				).rejects.toThrow();
			} finally {
				await viewerClient.close();
			}
		});
	});
});
