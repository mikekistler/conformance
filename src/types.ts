export type CheckStatus =
  | 'SUCCESS'
  | 'FAILURE'
  | 'WARNING'
  | 'SKIPPED'
  | 'INFO';

export interface SpecReference {
  id: string;
  url?: string;
}

export interface ConformanceCheck {
  id: string;
  name: string;
  description: string;
  status: CheckStatus;
  timestamp: string;
  specReferences?: SpecReference[];
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
  logs?: string[];
}

export const DATED_SPEC_VERSIONS = [
  '2025-03-26',
  '2025-06-18',
  '2025-11-25'
] as const;

export type DatedSpecVersion = (typeof DATED_SPEC_VERSIONS)[number];

export const LATEST_SPEC_VERSION: DatedSpecVersion = '2025-11-25';

// Mirrors LATEST_PROTOCOL_VERSION in the spec repo's schema/draft/schema.ts.
// Bump when that constant changes.
export const DRAFT_PROTOCOL_VERSION = 'DRAFT-2026-v1';

export type SpecVersion = DatedSpecVersion | 'draft' | 'extension';

export function specVersionToProtocolVersion(
  version: SpecVersion
): string | undefined {
  if (version === 'draft') return DRAFT_PROTOCOL_VERSION;
  // TODO(#253 follow-up): 'extension' isn't a spec version — it's a scenario
  // category that got lumped into SpecVersion so `--spec-version extension`
  // could reuse the filter plumbing. It has no corresponding wire
  // protocolVersion. Split it out of this type when moving to
  // introducedIn/removedIn tagging.
  if (version === 'extension') return undefined;
  return version;
}

export interface ScenarioUrls {
  serverUrl: string;
  authUrl?: string;
  /**
   * Optional context to pass to the client via MCP_CONFORMANCE_CONTEXT env var.
   * This is a JSON-serializable object containing scenario-specific data like credentials.
   */
  context?: Record<string, unknown>;
}

export interface Scenario {
  name: string;
  description: string;
  specVersions: SpecVersion[];
  /**
   * If true, a non-zero client exit code is expected and will not cause the test to fail.
   * Use this for scenarios where the client is expected to error (e.g., rejecting invalid auth).
   */
  allowClientError?: boolean;
  start(): Promise<ScenarioUrls>;
  stop(): Promise<void>;
  getChecks(): ConformanceCheck[];
}

export interface ClientScenario {
  name: string;
  description: string;
  specVersions: SpecVersion[];
  run(serverUrl: string): Promise<ConformanceCheck[]>;
}

export interface ClientScenarioForAuthorizationServer {
  name: string;
  description: string;
  specVersions: SpecVersion[];
  run(serverUrl: string): Promise<ConformanceCheck[]>;
}
