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
 * HypervisorClient - JSON-RPC protocol layer for ADP Hypervisor communication.
 *
 * Handles request correlation, auth injection, timeout handling, and
 * ADP protocol methods. Delegates raw message I/O to a Transport instance.
 */

import type { Transport } from "./transport.js";
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
  type Logger,
} from "./types.js";

// Methods exempt from auth injection (server skips auth for these).
const AUTH_EXEMPT_METHODS = new Set(["adp.initialize", "adp.ping"]);

/** Default per-request timeout in milliseconds (30 seconds). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class HypervisorClient {
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private _authorization: string | undefined;
  private requestTimeoutMs: number;

  constructor(
    private readonly transport: Transport,
    private readonly logger: Logger,
    requestTimeoutMs?: number,
  ) {
    this.requestTimeoutMs = requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    this.transport.onMessage((line: string) => {
      this.handleLine(line);
    });

    this.transport.onClose((code: number | null) => {
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`Hypervisor process exited (code=${code}, signal=null)`));
      }
      this.pendingRequests.clear();
    });
  }

  /**
   * Set the Basic Auth credential injected into every JSON-RPC request.
   */
  setAuthorization(username: string, password: string = ""): void {
    this._authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  /** Check if the client is connected. */
  get connected(): boolean {
    return this.transport.connected;
  }

  /** Close the transport and reject any pending requests. */
  async close(): Promise<void> {
    await this.transport.close();

    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("HypervisorClient closed"));
    }
    this.pendingRequests.clear();
  }

  // =========================================================================
  // ADP Protocol Methods
  // =========================================================================

  /**
   * Initialize the connection with the Hypervisor.
   * Must be called after the transport is started and before any other
   * protocol method.
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
    return this.send<InitializeResult>("adp.initialize", params);
  }

  /** Ping the Hypervisor to check connectivity. */
  async ping(): Promise<void> {
    await this.send("adp.ping");
  }

  /** Discover available resources. */
  async discover(filter?: DiscoverFilter): Promise<DiscoverResult> {
    const params: DiscoverParams = {};
    if (filter) params.filter = filter;
    return this.send<DiscoverResult>("adp.discover", params);
  }

  /** Describe a resource's usage contract for a given intent class. */
  async describe(
    resourceId: string,
    intentClass: IntentClass,
    version?: number,
  ): Promise<DescribeResult> {
    const params: DescribeParams = { resourceId, intentClass };
    if (version !== undefined) params.version = version;
    return this.send<DescribeResult>("adp.describe", params);
  }

  /** Validate an intent before execution. */
  async validate(intent: Intent): Promise<ValidateResult> {
    const params: ValidateParams = { intent };
    return this.send<ValidateResult>("adp.validate", params);
  }

  /** Execute an intent. */
  async execute(intent: Intent, cursor?: string): Promise<ExecuteResult> {
    const params: ExecuteParams = { intent };
    if (cursor) params.cursor = cursor;
    return this.send<ExecuteResult>("adp.execute", params);
  }

  // =========================================================================
  // JSON-RPC Protocol (private)
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
        if (errResp.id == null) {
          this.logger.error(
            `adp-bridge: received error without request ID: ${errResp.error.message}`,
          );
          return;
        }
        const id = errResp.id as number;
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          pending.reject(new ADPError(errResp.error.code, errResp.error.message, errResp.error.data));
        }
      } else {
        const id = response.id as number;
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          pending.resolve(response.result);
        }
      }
    } catch {
      this.logger.error(`adp-bridge: failed to parse response: ${trimmed.slice(0, 200)}`);
    }
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  private async send<T>(method: string, params?: object): Promise<T> {
    if (!this.transport.connected) {
      throw new Error("HypervisorClient: not connected");
    }

    // Build a mutable params record for auth injection.
    let wireParams: Record<string, unknown> | undefined;
    if (params !== undefined) {
      wireParams = { ...params } as Record<string, unknown>;
    }

    if (this._authorization && !AUTH_EXEMPT_METHODS.has(method)) {
      wireParams = wireParams ?? {};
      const meta = { ...((wireParams._meta as Record<string, unknown>) ?? {}) };
      meta.authorization = this._authorization;
      wireParams._meta = meta;
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      ...(wireParams !== undefined ? { params: wireParams } : {}),
    };

    const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    const json = JSON.stringify(request) + "\n";
    this.logger.debug?.(`adp-bridge: -> ${method} (id=${id})`);

    try {
      await this.transport.write(json);
    } catch (err) {
      this.pendingRequests.delete(id);
      throw err;
    }

    // Race the response against a timeout to avoid indefinite hangs.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (this.pendingRequests.delete(id)) {
          reject(new Error(`adp-bridge: request ${method} (id=${id}) timed out after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);
    this.logger.debug?.(`adp-bridge: <- ${method} (id=${id})`);
    return result as T;
  }
}
