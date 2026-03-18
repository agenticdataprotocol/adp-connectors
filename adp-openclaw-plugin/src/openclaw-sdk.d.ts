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
 * Minimal type declarations for the OpenClaw plugin SDK.
 *
 * These types cover only the API surface used by the ADP plugin.
 * At runtime the real SDK is provided by the OpenClaw host process.
 */
declare module "openclaw/plugin-sdk" {
  export interface PluginLogger {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  }

  export interface PluginToolDefinition {
    name: string;
    label?: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<ToolResult>;
  }

  export interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
  }

  export interface PluginServiceDefinition {
    id: string;
    start: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
  }

  export interface OpenClawPluginApi {
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    registerTool: (tool: PluginToolDefinition) => void;
    registerService: (service: PluginServiceDefinition) => void;
  }
}
