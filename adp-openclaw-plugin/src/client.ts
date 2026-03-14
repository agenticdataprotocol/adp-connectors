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
 * HypervisorClient - manages ADP Hypervisor subprocess and JSON-RPC communication.
 *
 * Spawns `python -m adp_hypervisor --config <path>` as a child process and
 * communicates via newline-delimited JSON (NDJSON) over stdio.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import {
	JSONRPC_VERSION,
	LATEST_PROTOCOL_VERSION,
	ADPError,
	type JSONRPCRequest,
	type JSONRPCResponse,
	type JSONRPCErrorResponse,
	type InitializeParams,
	type InitializeResult,
	type DiscoverParams,
	type DiscoverResult,
	type DescribeParams,
	type DescribeResult,
	type ValidateParams,
	type ValidateResult,
	type ExecuteParams,
	type ExecuteResult,
	type Intent,
	type DiscoverFilter,
	type IntentClass,
} from "./types.js";

interface Logger {
	debug?: (message: string) => void;
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
}

// Methods exempt from auth injection (server skips auth for these).
const AUTH_EXEMPT_METHODS = new Set(["adp.initialize", "adp.ping"]);

export class HypervisorClient {
	private process: ChildProcess | null = null;
	private readline: ReadlineInterface | null = null;
	private requestId = 0;
	private logger: Logger;
	private pendingRequests = new Map<
		number | string,
		{
			resolve: (value: Record<string, unknown>) => void;
			reject: (error: Error) => void;
		}
	>();
	private sendLock: Promise<void> = Promise.resolve();
	private _authorization: string | undefined;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	/**
	 * Set the Basic Auth credential injected into every JSON-RPC request.
	 * The Hypervisor's BasicAuthenticator uses only the username for RBAC
	 * role resolution, so password is left empty.
	 */
	setAuthorization(username: string): void {
		this._authorization = `Basic ${Buffer.from(`${username}:`).toString("base64")}`;
	}

	// =========================================================================
	// Subprocess Lifecycle
	// =========================================================================

	/**
	 * Spawn the Hypervisor subprocess.
	 */
	spawn(command: string, args: string[], env?: Record<string, string>): void {
		if (this.process) {
			throw new Error("HypervisorClient: already spawned");
		}

		const mergedEnv = env ? { ...process.env, ...env } : undefined;

		this.process = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: mergedEnv,
		});

		// Set up stdout readline for NDJSON parsing
		this.readline = createInterface({
			input: this.process.stdout!,
			crlfDelay: Infinity,
		});

		this.readline.on("line", (line: string) => {
			this.handleLine(line);
		});

		// Forward stderr to logger
		this.process.stderr?.on("data", (data: Buffer) => {
			const lines = data.toString("utf-8").split("\n");
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) {
					this.logger.debug?.(`[hypervisor] ${trimmed}`);
				}
			}
		});

		this.process.on("exit", (code, signal) => {
			this.logger.info(`adp-bridge: Hypervisor exited (code=${code}, signal=${signal})`);
			for (const [, pending] of this.pendingRequests) {
				pending.reject(new Error(`Hypervisor process exited (code=${code}, signal=${signal})`));
			}
			this.pendingRequests.clear();
			this.process = null;
			this.readline = null;
		});

		this.process.on("error", (err) => {
			this.logger.error(`adp-bridge: Hypervisor process error: ${err.message}`);
		});

		this.logger.info(`adp-bridge: spawned Hypervisor (pid=${this.process.pid})`);
	}

	/** Check if the client is connected. */
	get connected(): boolean {
		return this.process !== null && this.process.exitCode === null;
	}

	/**
	 * Gracefully close the Hypervisor subprocess.
	 * Sends SIGTERM, waits up to 5 seconds, then SIGKILL.
	 */
	async close(): Promise<void> {
		if (!this.process) return;

		const proc = this.process;
		this.process = null;

		this.readline?.close();
		this.readline = null;

		try {
			proc.stdin?.end();
		} catch {
			// Ignore errors closing stdin
		}

		if (proc.exitCode === null) {
			const exitPromise = new Promise<void>((resolve) => {
				proc.once("exit", () => resolve());
			});

			proc.kill("SIGTERM");

			const timeout = new Promise<"timeout">((resolve) => {
				setTimeout(() => resolve("timeout"), 5000);
			});

			const result = await Promise.race([exitPromise.then(() => "exited" as const), timeout]);
			if (result === "timeout") {
				this.logger.warn(
					`adp-bridge: Hypervisor did not exit gracefully, sending SIGKILL (pid=${proc.pid})`,
				);
				proc.kill("SIGKILL");
				await exitPromise;
			}
		}

		for (const [, pending] of this.pendingRequests) {
			pending.reject(new Error("HypervisorClient closed"));
		}
		this.pendingRequests.clear();

		this.logger.info("adp-bridge: Hypervisor subprocess terminated");
	}

	// =========================================================================
	// ADP Protocol Methods
	// =========================================================================

	/**
	 * Initialize the connection with the Hypervisor.
	 * Must be called after spawn() and before any other protocol method.
	 */
	async initialize(): Promise<InitializeResult> {
		const params: InitializeParams = {
			protocolVersion: LATEST_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: {
				name: "adp-openclaw-plugin",
				version: "0.1.0",
			},
		};
		return this.send<InitializeResult>("adp.initialize", params as unknown as Record<string, unknown>);
	}

	/** Ping the Hypervisor to check connectivity. */
	async ping(): Promise<void> {
		await this.send("adp.ping");
	}

	/** Discover available resources. */
	async discover(filter?: DiscoverFilter): Promise<DiscoverResult> {
		const params: DiscoverParams = {};
		if (filter) params.filter = filter;
		return this.send<DiscoverResult>("adp.discover", params as unknown as Record<string, unknown>);
	}

	/** Describe a resource's usage contract for a given intent class. */
	async describe(resourceId: string, intentClass: IntentClass, version?: number): Promise<DescribeResult> {
		const params: DescribeParams = { resourceId, intentClass };
		if (version !== undefined) params.version = version;
		return this.send<DescribeResult>("adp.describe", params as unknown as Record<string, unknown>);
	}

	/** Validate an intent before execution. */
	async validate(intent: Intent): Promise<ValidateResult> {
		const params: ValidateParams = { intent };
		return this.send<ValidateResult>("adp.validate", params as unknown as Record<string, unknown>);
	}

	/** Execute an intent. */
	async execute(intent: Intent, cursor?: string): Promise<ExecuteResult> {
		const params: ExecuteParams = { intent };
		if (cursor) params.cursor = cursor;
		return this.send<ExecuteResult>("adp.execute", params as unknown as Record<string, unknown>);
	}

	// =========================================================================
	// JSON-RPC Transport (private)
	// =========================================================================

	/**
	 * Route an incoming NDJSON line to the matching pending request.
	 */
	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;

		try {
			const response = JSON.parse(trimmed) as JSONRPCResponse;

			if ("error" in response) {
				const errResp = response as JSONRPCErrorResponse;
				const pending = this.pendingRequests.get(errResp.id ?? -1);
				if (pending) {
					this.pendingRequests.delete(errResp.id ?? -1);
					pending.reject(new ADPError(errResp.error.code, errResp.error.message, errResp.error.data));
				}
			} else {
				const pending = this.pendingRequests.get(response.id);
				if (pending) {
					this.pendingRequests.delete(response.id);
					pending.resolve(response.result);
				}
			}
		} catch {
			this.logger.error(`adp-bridge: failed to parse response: ${trimmed.slice(0, 200)}`);
		}
	}

	/**
	 * Send a JSON-RPC request and wait for the response.
	 * Serializes concurrent writes using a promise-based lock.
	 */
	private async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		if (!this.process || !this.process.stdin) {
			throw new Error("HypervisorClient: not connected");
		}

		// Inject _meta.authorization into params for authenticated methods.
		if (this._authorization && !AUTH_EXEMPT_METHODS.has(method)) {
			params = params ?? {};
			const meta = (params._meta as Record<string, unknown>) ?? {};
			meta.authorization = this._authorization;
			params._meta = meta;
		}

		const id = ++this.requestId;
		const request: JSONRPCRequest = {
			jsonrpc: JSONRPC_VERSION,
			id,
			method,
			...(params !== undefined ? { params } : {}),
		};

		const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
		});

		// Serialize writes so concurrent callers don't interleave NDJSON frames.
		// Use .catch() to prevent a prior write failure from permanently poisoning the chain.
		const previousLock = this.sendLock;
		this.sendLock = previousLock.catch(() => {}).then(() => {
			if (!this.process?.stdin) {
				throw new Error("HypervisorClient: not connected");
			}
			const json = JSON.stringify(request) + "\n";
			this.logger.debug?.(`adp-bridge: -> ${method} (id=${id})`);
			return new Promise<void>((resolve, reject) => {
				this.process!.stdin!.write(json, "utf-8", (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		});

		try {
			await this.sendLock;
		} catch (err) {
			// Write failed — clean up pending request so it doesn't leak
			this.pendingRequests.delete(id);
			throw err;
		}

		const result = await resultPromise;
		this.logger.debug?.(`adp-bridge: <- ${method} (id=${id})`);
		return result as T;
	}
}
