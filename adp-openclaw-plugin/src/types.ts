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
 * ADP Protocol TypeScript type definitions.
 *
 * Faithfully translated from the Python ADP Hypervisor protocol types.
 * All field names use camelCase to match the JSON wire format (the Python
 * server uses alias_generator=to_camel).
 */

// =============================================================================
// Constants
// =============================================================================

export const JSONRPC_VERSION = "2.0" as const;
export const LATEST_PROTOCOL_VERSION = "2026-01-20";

// =============================================================================
// JSON-RPC Base Types
// =============================================================================

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResultResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string;
  result: Record<string, unknown>;
}

export interface JSONRPCErrorResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string | null;
  error: JSONRPCError;
}

export type JSONRPCResponse = JSONRPCResultResponse | JSONRPCErrorResponse;

// =============================================================================
// ADP Error Codes
// =============================================================================

/** JSON-RPC standard error codes */
export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** ADP-specific: requested resource not found */
  RESOURCE_NOT_FOUND: -32001,
  /** ADP-specific: intent validation failed */
  VALIDATION_FAILED: -32002,
  /** ADP-specific: not authorized */
  UNAUTHORIZED: -32003,
  /** ADP-specific: intent execution failed */
  EXECUTION_FAILED: -32004,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// =============================================================================
// ADP Error class
// =============================================================================

export class ADPError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ADPError";
  }
}

// =============================================================================
// Enums
// =============================================================================

export type IntentClass = "LOOKUP" | "QUERY" | "INGEST" | "REVISE";

export type PredicateOperator =
  | "EQ"
  | "NEQ"
  | "GT"
  | "LT"
  | "GTE"
  | "LTE"
  | "CONTAINS"
  | "IN"
  | "LIKE"
  | "ILIKE"
  | "SIMILAR";

export type PredicateUsage = "REQUIRED" | "OPTIONAL";

export type LogicOperator = "AND" | "OR" | "NOT";

export type IssueSeverity = "BLOCKING" | "WARNING";

export type ConsistencyLevel = "STRONG" | "EVENTUAL";

export type FieldType =
  | "STRING"
  | "INTEGER"
  | "FLOAT"
  | "BOOLEAN"
  | "DATE"
  | "TIMESTAMP"
  | "VECTOR"
  | "BLOB"
  | "JSON";

export type ValidationIssueCode =
  | "MISSING_REQUIRED_PREDICATE"
  | "INVALID_FORMAT"
  | "FIELD_NOT_PERMITTED"
  | "FIELD_NOT_FOUND"
  | "INVALID_OPERATOR"
  | "INVALID_VALUE"
  | "CARDINALITY_EXCEEDED";

// =============================================================================
// Predicate Types
// =============================================================================

export interface SimilarValue {
  text?: string;
  blob?: string;
  vector?: number[];
  top?: number;
  threshold?: number;
  distanceFunction?: string;
}

export type PredicateValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | SimilarValue;

export interface Predicate {
  fieldId: string;
  op: PredicateOperator;
  value: PredicateValue;
}

export interface IdentityPredicate {
  fieldId: string;
  op: "EQ";
  value: string | number | boolean;
}

export interface PredicateGroup {
  op: LogicOperator;
  predicates: Array<Predicate | PredicateGroup>;
}

export type PredicateExpression = Predicate | PredicateGroup;

// =============================================================================
// Initialization Types
// =============================================================================

export interface Implementation {
  name: string;
  version: string;
}

export interface ClientCapabilities {
  experimental?: Record<string, Record<string, unknown>>;
}

export interface ServerCapabilities {
  experimental?: Record<string, Record<string, unknown>>;
  supportedIntentClasses?: IntentClass[];
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: Implementation;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: Implementation;
  instructions?: string;
}

// =============================================================================
// Discover Types
// =============================================================================

export interface DiscoverFilter {
  domainPrefix?: string;
  intentClass?: IntentClass;
  keyword?: string;
}

export interface DiscoverParams {
  filter?: DiscoverFilter;
  cursor?: string;
}

export interface Resource {
  resourceId: string;
  version: number;
  intentClasses: IntentClass[];
  description?: string;
  semanticDescription?: string;
  tags?: string[];
}

export interface DiscoverResult {
  resources: Resource[];
  nextCursor?: string;
}

// =============================================================================
// Describe Types
// =============================================================================

export interface FieldMetadata {
  cardinality?: number | string;
  format?: string;
  whitelistOnly?: boolean;
  hint?: string;
  vector?: Record<string, unknown>;
  samples?: unknown[];
}

export interface Field {
  fieldId: string;
  type?: FieldType;
  description?: string;
  samples?: unknown[];
  isMasked?: boolean;
  isSearchable?: boolean;
  metadata?: FieldMetadata;
}

export interface PredicateCapability {
  fieldId: string;
  usage: PredicateUsage;
  operators: PredicateOperator[];
}

export interface ProjectionCapability {
  fieldId: string;
}

export interface MutableCapability {
  fieldId: string;
  constraints?: Record<string, unknown>;
}

export interface Capabilities {
  predicates?: PredicateCapability[];
  projections?: ProjectionCapability[];
  mutables?: MutableCapability[];
}

export interface UsageContract {
  fields: Field[];
  capabilities: Capabilities;
}

export interface DescribeParams {
  resourceId: string;
  intentClass: IntentClass;
  version?: number;
  cursor?: string;
}

export interface DescribeResult {
  resourceId: string;
  version: number;
  intentClass: IntentClass;
  usageContract: UsageContract;
  nextCursor?: string;
}

// =============================================================================
// Intent Types
// =============================================================================

export interface LookupIntent {
  intentClass: "LOOKUP";
  resourceId: string;
  key: IdentityPredicate;
  projections?: string[];
}

export interface SortOrder {
  direction: "ASC" | "DESC";
  fieldId: string;
}

export interface QueryIntent {
  intentClass: "QUERY";
  resourceId: string;
  predicates: PredicateExpression;
  projections?: string[];
  orderBy?: SortOrder[];
  limit?: number;
}

export interface IngestIntent {
  intentClass: "INGEST";
  resourceId: string;
  payload: Array<Record<string, unknown>>;
}

export interface ReviseIntent {
  intentClass: "REVISE";
  resourceId: string;
  predicates: PredicateExpression;
  payload: Record<string, unknown>;
}

export type Intent = LookupIntent | QueryIntent | IngestIntent | ReviseIntent;

// =============================================================================
// Validate Types
// =============================================================================

export interface ValidationIssue {
  code: ValidationIssueCode;
  field?: string;
  severity: IssueSeverity;
  message: string;
  correctionHint?: string;
}

export interface ValidateParams {
  intent: Intent;
}

export interface ValidateResult {
  valid: boolean;
  issues?: ValidationIssue[];
}

// =============================================================================
// Execute Types
// =============================================================================

export interface ExecuteParams {
  intent: Intent;
  cursor?: string;
}

export interface ExecutionMetadata {
  durationMs?: number;
  sourceSystem?: string;
  consistency?: ConsistencyLevel;
}

export interface ExecuteResult {
  results: Array<Record<string, unknown>>;
  executionMetadata?: ExecutionMetadata;
  nextCursor?: string;
}

// =============================================================================
// Plugin Config
// =============================================================================

export type AdpPluginConfig = {
  command?: string;
  args?: string[];
  configPath: string;
  env?: Record<string, string>;
  username?: string;
  logLevel?: string;
};
