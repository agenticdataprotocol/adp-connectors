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

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { HypervisorClient } from "../src/client.js";
import { ADPError, ErrorCode } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SCRIPT = resolve(__dirname, "mock-hypervisor.py");

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

describe("HypervisorClient", () => {
	let client: HypervisorClient;
	let testLogger: ReturnType<typeof createTestLogger>;

	beforeEach(() => {
		testLogger = createTestLogger();
		client = new HypervisorClient(testLogger.logger);
	});

	afterEach(async () => {
		await client.close();
	});

	function spawnMock() {
		client.spawn("python3", [MOCK_SCRIPT]);
	}

	describe("subprocess lifecycle", () => {
		it("should spawn and connect", () => {
			spawnMock();
			expect(client.connected).toBe(true);
		});

		it("should throw if spawned twice", () => {
			spawnMock();
			expect(() => spawnMock()).toThrow("already spawned");
		});

		it("should close gracefully", async () => {
			spawnMock();
			expect(client.connected).toBe(true);
			await client.close();
			expect(client.connected).toBe(false);
		});

		it("should handle close when not connected", async () => {
			await client.close();
		});
	});

	describe("initialize handshake", () => {
		it("should complete the initialize handshake", async () => {
			spawnMock();
			const result = await client.initialize();
			expect(result.protocolVersion).toBe("2026-01-20");
			expect(result.serverInfo.name).toBe("mock-hypervisor");
			expect(result.serverInfo.version).toBe("0.0.1");
		});
	});

	describe("ADP protocol methods", () => {
		beforeEach(() => {
			spawnMock();
		});

		it("should ping successfully", async () => {
			await client.initialize();
			await client.ping();
		});

		it("should discover resources", async () => {
			await client.initialize();
			const result = await client.discover();
			expect(result.resources).toHaveLength(1);
			expect(result.resources[0].resourceId).toBe("release:releases");
			expect(result.resources[0].intentClasses).toContain("INGEST");
		});

		it("should discover with filter", async () => {
			await client.initialize();
			const result = await client.discover({ domainPrefix: "release" });
			expect(result.resources).toHaveLength(1);
		});

		it("should describe a resource", async () => {
			await client.initialize();
			const result = await client.describe("release:releases", "QUERY");
			expect(result.resourceId).toBe("release:releases");
			expect(result.intentClass).toBe("QUERY");
			expect(result.usageContract.fields).toHaveLength(1);
			expect(result.usageContract.fields[0].fieldId).toBe("version");
		});

		it("should validate an intent", async () => {
			await client.initialize();
			const result = await client.validate({
				intentClass: "QUERY",
				resourceId: "release:releases",
				predicates: { fieldId: "version", op: "EQ", value: "1.2.0" },
			});
			expect(result.valid).toBe(true);
		});

		it("should execute an INGEST intent", async () => {
			await client.initialize();
			const result = await client.execute({
				intentClass: "INGEST",
				resourceId: "release:releases",
				payload: [{ version: "1.2.0", status: "planning" }],
			});
			expect(result.results).toHaveLength(1);
			expect(result.results[0].status).toBe("created");
		});

		it("should execute a QUERY intent", async () => {
			await client.initialize();
			const result = await client.execute({
				intentClass: "QUERY",
				resourceId: "release:releases",
				predicates: { fieldId: "version", op: "EQ", value: "1.2.0" },
			});
			expect(result.results).toHaveLength(1);
			expect(result.results[0].version).toBe("1.2.0");
		});
	});

	describe("error handling", () => {
		beforeEach(() => {
			spawnMock();
		});

		it("should throw ADPError on JSON-RPC error response", async () => {
			await client.initialize();
			try {
				await (client as any).send("test.error");
				expect.fail("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ADPError);
				const adpErr = err as ADPError;
				expect(adpErr.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
				expect(adpErr.message).toBe("Resource not found");
			}
		});

		it("should throw when sending without connection", async () => {
			const freshClient = new HypervisorClient(testLogger.logger);
			await expect(freshClient.initialize()).rejects.toThrow("not connected");
		});
	});

	describe("concurrent requests", () => {
		it("should handle multiple concurrent requests correctly", async () => {
			spawnMock();
			await client.initialize();

			const [, r2, r3] = await Promise.all([
				client.ping(),
				client.discover(),
				client.describe("release:releases", "QUERY"),
			]);

			expect(r2.resources).toHaveLength(1);
			expect(r3.usageContract).toBeDefined();
		});
	});

	describe("subprocess crash", () => {
		it("should reject pending requests when process exits", async () => {
			spawnMock();
			await client.initialize();

			// Send a request that causes the mock to exit without responding
			const promise = (client as any).send("test.exit");
			await expect(promise).rejects.toThrow("Hypervisor process exited");
		});

		it("should handle double close safely", async () => {
			spawnMock();
			await client.initialize();
			await client.close();
			// Second close should be a no-op
			await client.close();
			expect(client.connected).toBe(false);
		});
	});
});
