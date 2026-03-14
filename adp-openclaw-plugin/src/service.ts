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
 * Plugin service lifecycle — manages the ADP Hypervisor subprocess.
 *
 * On gateway start, spawns the Hypervisor and runs the initialize handshake.
 * On gateway stop, gracefully shuts down the subprocess.
 * Exposes a `getClient()` getter for tool implementations.
 *
 * The HypervisorClient is stored as a globalThis singleton so that
 * multiple plugin loads (e.g., from different agent workspaces) share
 * the same connected client instance.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import type { AdpPluginConfig } from "./types.js";
import { HypervisorClient } from "./client.js";

const GLOBAL_CLIENT_KEY = Symbol.for("adp-hypervisor-client");

function getSharedClient(): HypervisorClient | null {
  return (globalThis as Record<symbol, HypervisorClient | null>)[GLOBAL_CLIENT_KEY] ?? null;
}

function setSharedClient(value: HypervisorClient | null): void {
  (globalThis as Record<symbol, HypervisorClient | null>)[GLOBAL_CLIENT_KEY] = value;
}

interface ServiceResult {
  /** Get the active HypervisorClient. Throws if not connected. */
  getClient: () => HypervisorClient;
}

export function registerAdpService(api: OpenClawPluginApi, config: AdpPluginConfig): ServiceResult {
  const getClient = (): HypervisorClient => {
    const client = getSharedClient();
    if (!client || !client.connected) {
      throw new Error("adp-bridge: Hypervisor not connected. Is the service running?");
    }
    return client;
  };

  api.registerService({
    id: "adp-bridge",
    start: async () => {
      // Reuse existing connection if another workspace already started the service.
      const existing = getSharedClient();
      if (existing?.connected) {
        api.logger.info("adp-bridge: reusing existing Hypervisor connection");
        return;
      }

      try {
        const client = new HypervisorClient(api.logger);

        const command = config.command ?? "python";
        const baseArgs = config.args ?? ["-m", "adp_hypervisor"];
        const args = [...baseArgs, "--config", config.configPath];

        if (config.logLevel) {
          args.push("--log-level", config.logLevel);
        }

        const env: Record<string, string> = { ...config.env };
        if (config.username) {
          env.ADP_USERNAME = config.username;
        }

        const cwd = dirname(config.configPath);
        mkdirSync(resolve(cwd, "data"), { recursive: true });

        client.spawn(command, args, Object.keys(env).length > 0 ? env : undefined, cwd);

        if (config.username) {
          client.setAuthorization(config.username);
        }

        const result = await client.initialize();
        setSharedClient(client);
        api.logger.info(
          `adp-bridge: Hypervisor connected (server=${result.serverInfo.name} v${result.serverInfo.version}, protocol=${result.protocolVersion})`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.error(`adp-bridge: failed to start Hypervisor: ${message}`);
        const client = getSharedClient();
        if (client) {
          await client.close().catch(() => {});
          setSharedClient(null);
        }
      }
    },

    stop: async () => {
      const client = getSharedClient();
      if (client) {
        await client.close();
        setSharedClient(null);
        api.logger.info("adp-bridge: Hypervisor stopped");
      }
    },
  });

  return { getClient };
}
