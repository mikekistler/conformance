import {
  ConformanceCheck,
  CheckStatus,
  LATEST_SPEC_VERSION,
  DRAFT_PROTOCOL_VERSION
} from '../types';

export function createServerInfoCheck(serverInfo: {
  name: string;
  version: string;
}): ConformanceCheck {
  return {
    id: 'server-info',
    name: 'ServerInfo',
    description: 'Test server info returned to client',
    status: 'INFO',
    timestamp: new Date().toISOString(),
    specReferences: [
      {
        id: 'MCP-Lifecycle',
        url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle'
      }
    ],
    details: {
      serverName: serverInfo.name,
      serverVersion: serverInfo.version
    }
  };
}

// Protocol versions the mock server will accept on initialize.
const VALID_PROTOCOL_VERSIONS = [
  '2025-06-18',
  LATEST_SPEC_VERSION,
  DRAFT_PROTOCOL_VERSION
];

export function createClientInitializationCheck(
  initializeRequest: any,
  expectedSpecVersion: string = LATEST_SPEC_VERSION
): ConformanceCheck {
  const protocolVersionSent = initializeRequest?.protocolVersion;

  // Accept known valid versions OR custom expected version (for backward compatibility)
  const validVersions = VALID_PROTOCOL_VERSIONS.includes(expectedSpecVersion)
    ? VALID_PROTOCOL_VERSIONS
    : [...VALID_PROTOCOL_VERSIONS, expectedSpecVersion];
  const versionMatch = validVersions.includes(protocolVersionSent);

  const errors: string[] = [];
  if (!protocolVersionSent) errors.push('Protocol version not provided');
  if (!versionMatch)
    errors.push(
      `Version mismatch: expected ${expectedSpecVersion}, got ${protocolVersionSent}`
    );
  if (!initializeRequest?.clientInfo?.name) errors.push('Client name missing');
  if (!initializeRequest?.clientInfo?.version)
    errors.push('Client version missing');

  const status: CheckStatus = errors.length === 0 ? 'SUCCESS' : 'FAILURE';

  return {
    id: 'mcp-client-initialization',
    name: 'MCPClientInitialization',
    description: 'Validates that MCP client properly initializes with server',
    status,
    timestamp: new Date().toISOString(),
    specReferences: [
      {
        id: 'MCP-Lifecycle',
        url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle'
      }
    ],
    details: {
      protocolVersionSent,
      expectedSpecVersion,
      versionMatch,
      clientName: initializeRequest?.clientInfo?.name,
      clientVersion: initializeRequest?.clientInfo?.version
    },
    errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
    logs: errors.length > 0 ? errors : undefined
  };
}
