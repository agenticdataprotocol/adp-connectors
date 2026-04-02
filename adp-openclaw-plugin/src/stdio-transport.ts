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
 * Stdio-based transport implementation for ADP Hypervisor communication.
 *
 * Provides a StdioTransport that spawns a subprocess and communicates via
 * NDJSON over stdin/stdout, with stderr logging, write serialization, and
 * graceful shutdown.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import type { Transport } from "./transport.js";
import type { Logger } from "./types.js";

/**
 * Stdio-based transport that spawns a subprocess and communicates via NDJSON.
 *
 * Manages the child process lifecycle, readline on stdout, stderr logging,
 * and write serialization to prevent interleaved NDJSON frames.
 */
export class StdioTransport implements Transport {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private sendLock: Promise<void> = Promise.resolve();
  private messageHandler: ((line: string) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string> | undefined,
    private readonly cwd: string | undefined,
    private readonly logger: Logger,
  ) {}

  /** Spawn the subprocess and set up stdio plumbing. */
  start(): void {
    if (this.process) {
      throw new Error("StdioTransport: already started");
    }

    const mergedEnv = this.env ? { ...process.env, ...this.env } : undefined;

    this.process = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: mergedEnv,
      cwd: this.cwd,
    });

    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on("line", (line: string) => {
      this.messageHandler?.(line);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString("utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.logger.debug?.(`[hypervisor] ${trimmed}`);
        }
      }
    });

    this.process.on("exit", (code: number | null, signal: string | null) => {
      this.logger.info(`adp-bridge: Hypervisor exited (code=${code}, signal=${signal})`);
      this.closeHandler?.(code);
      this.process = null;
      this.readline = null;
    });

    this.process.on("error", (err: Error) => {
      this.logger.error(`adp-bridge: Hypervisor process error: ${err.message}`);
    });

    this.logger.info(`adp-bridge: spawned Hypervisor (pid=${this.process.pid})`);
  }

  /** Send a raw NDJSON line, serializing concurrent writes. */
  async write(message: string): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error("StdioTransport: not connected");
    }

    const previousLock = this.sendLock;
    this.sendLock = previousLock.catch(() => {}).then(() => {
      if (!this.process?.stdin) {
        throw new Error("StdioTransport: not connected");
      }
      return new Promise<void>((resolve, reject) => {
        this.process!.stdin!.write(message, "utf-8", (err: Error | null | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    await this.sendLock;
  }

  /** Register a handler for incoming NDJSON lines. */
  onMessage(handler: (line: string) => void): void {
    this.messageHandler = handler;
  }

  /** Register a handler for transport close events. */
  onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }

  /** Check if the transport is connected. */
  get connected(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Gracefully close the subprocess.
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

    this.logger.info("adp-bridge: Hypervisor subprocess terminated");
  }
}
