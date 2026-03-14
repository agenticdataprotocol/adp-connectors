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

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { registerAdpService } from "./src/service.js";
import { registerAdpTools } from "./src/tools.js";
import type { AdpPluginConfig } from "./src/types.js";

export type { AdpPluginConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi) {
  const config = (api.pluginConfig ?? {}) as AdpPluginConfig;

  if (!config.configPath) {
    api.logger.warn("adp-bridge: configPath not set, plugin disabled");
    return;
  }

  api.logger.info(`adp-bridge: registering (configPath=${config.configPath})`);

  const { getClient } = registerAdpService(api, config);
  registerAdpTools(api, getClient);
}
