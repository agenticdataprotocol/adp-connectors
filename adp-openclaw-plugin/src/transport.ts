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
 * Transport interface for ADP Hypervisor communication.
 */

/**
 * Transport interface — abstraction for communication with ADP Hypervisor.
 */
export interface Transport {
  /** Start the transport connection. */
  start(): void;
  /** Send a raw message string (NDJSON line). */
  write(message: string): Promise<void>;
  /** Register a handler for incoming messages. */
  onMessage(handler: (line: string) => void): void;
  /** Register a handler for transport close events. */
  onClose(handler: (code: number | null) => void): void;
  /** Check if the transport is connected. */
  readonly connected: boolean;
  /** Close the transport. */
  close(): Promise<void>;
}
