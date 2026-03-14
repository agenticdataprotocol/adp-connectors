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
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import type { AdpPluginConfig } from "./types.js";
import { HypervisorClient } from "./client.js";

interface ServiceResult {
  /** Get the active HypervisorClient. Throws if not connected. */
  getClient: () => HypervisorClient;
}

export function registerAdpService(api: OpenClawPluginApi, config: AdpPluginConfig): ServiceResult {
  let client: HypervisorClient | null = null;

  const getClient = (): HypervisorClient => {
    if (!client || !client.connected) {
      throw new Error("adp-bridge: Hypervisor not connected. Is the service running?");
    }
    return client;
  };

  api.registerService({
    id: "adp-bridge",
    start: async () => {
      try {
        client = new HypervisorClient(api.logger);

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

        client.spawn(command, args, Object.keys(env).length > 0 ? env : undefined);

        if (config.username) {
          client.setAuthorization(config.username);
        }

        const result = await client.initialize();
        api.logger.info(
          `adp-bridge: Hypervisor connected (server=${result.serverInfo.name} v${result.serverInfo.version}, protocol=${result.protocolVersion})`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.error(`adp-bridge: failed to start Hypervisor: ${message}`);
        // Clean up on failure
        if (client) {
          await client.close().catch(() => {});
          client = null;
        }
      }
    },

    stop: async () => {
      if (client) {
        await client.close();
        client = null;
        api.logger.info("adp-bridge: Hypervisor stopped");
      }
    },
  });

  return { getClient };
}
