/**
 * HTTP Custom Headers conformance test scenario for MCP clients (SEP-2243)
 *
 * Tests that clients correctly handle the `x-mcp-header` extension property:
 * 1. Mirror annotated tool parameter values into `Mcp-Param-{Name}` headers
 * 2. Apply correct value encoding (plain ASCII, Base64 for non-ASCII)
 * 3. Reject tool definitions with invalid `x-mcp-header` annotations
 *
 * This is a Scenario (acts as a test server that inspects incoming requests
 * from the client under test).
 */

import http from 'http';
import {
  Scenario,
  ScenarioUrls,
  ConformanceCheck,
  SpecVersion
} from '../../types.js';

const SPEC_REFERENCE_CUSTOM = {
  id: 'SEP-2243-Custom-Headers',
  url: 'https://modelcontextprotocol.io/specification/draft/basic/transports#custom-headers-from-tool-parameters'
};

const SPEC_REFERENCE_ENCODING = {
  id: 'SEP-2243-Value-Encoding',
  url: 'https://modelcontextprotocol.io/specification/draft/basic/transports#value-encoding'
};

const SPEC_REFERENCE_TOOL_DEF = {
  id: 'SEP-2243-x-mcp-header',
  url: 'https://modelcontextprotocol.io/specification/draft/server/tools#x-mcp-header'
};

/**
 * Decodes a header value that may be Base64-encoded.
 * Base64-encoded values use the format: =?base64?{Base64EncodedValue}?=
 */
function decodeHeaderValue(value: string): string {
  const base64Match = value.match(/^=\?base64\?(.+)\?=$/i);
  if (base64Match) {
    return Buffer.from(base64Match[1], 'base64').toString('utf-8');
  }
  return value;
}

/**
 * Check if a value needs Base64 encoding per the spec:
 * - Non-ASCII characters
 * - Control characters
 * - Leading/trailing whitespace
 */
function needsBase64Encoding(value: string): boolean {
  // Check for non-ASCII or control characters
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      // Allow space (0x20) and tab (0x09) only inside values, not at edges
      if (code === 0x09) return true; // tab always needs encoding
      if (code < 0x20) return true; // other control chars
      if (code > 0x7e) return true; // non-ASCII
    }
  }
  // Check for leading/trailing whitespace
  if (value !== value.trim()) return true;
  return false;
}

/**
 * Checks if a raw header value is properly encoded for a body value that
 * needs Base64 encoding. Returns null if valid, error string if invalid.
 */
function validateEncodedHeader(
  rawHeader: string,
  bodyValue: string
): string | null {
  if (needsBase64Encoding(bodyValue)) {
    // Value requires Base64 encoding
    const base64Match = rawHeader.match(/^=\?base64\?(.+)\?=$/i);
    if (!base64Match) {
      return `Value '${bodyValue}' requires Base64 encoding but header was sent as plain: '${rawHeader}'`;
    }
    const decoded = Buffer.from(base64Match[1], 'base64').toString('utf-8');
    if (decoded !== bodyValue) {
      return `Base64-decoded header value '${decoded}' does not match body value '${bodyValue}'`;
    }
    return null;
  }
  // Plain ASCII - compare directly (after decoding if Base64 was used)
  const decoded = decodeHeaderValue(rawHeader);
  if (decoded !== bodyValue) {
    return `Header value '${decoded}' (raw: '${rawHeader}') does not match body value '${bodyValue}'`;
  }
  return null;
}

// Shared server boilerplate for Scenario implementations
abstract class BaseHttpScenario implements Scenario {
  abstract name: string;
  abstract description: string;
  abstract specVersions: SpecVersion[];
  allowClientError?: boolean;

  protected server: http.Server | null = null;
  protected checks: ConformanceCheck[] = [];
  protected port: number = 0;
  protected sessionId: string = `session-${Date.now()}`;

  async start(): Promise<ScenarioUrls> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      this.server.on('error', reject);
      this.server.listen(0, () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
          resolve({ serverUrl: `http://localhost:${this.port}` });
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else {
            this.server = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  abstract getChecks(): ConformanceCheck[];

  protected handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'mcp-session-id': this.sessionId
      });
      res.write('data: \n\n');
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        this.handlePost(req, res, request);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: `Parse error: ${error}` }
          })
        );
      }
    });
  }

  protected abstract handlePost(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    request: any
  ): void;

  protected sendJson(res: http.ServerResponse, body: object): void {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'mcp-session-id': this.sessionId
    });
    res.end(JSON.stringify(body));
  }

  protected sendInitialize(res: http.ServerResponse, request: any): void {
    this.sendJson(res, {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: { name: this.name + '-server', version: '1.0.0' },
        capabilities: { tools: {} }
      }
    });
  }

  protected sendNotificationAck(res: http.ServerResponse): void {
    res.writeHead(202);
    res.end();
  }

  protected sendGenericResult(res: http.ServerResponse, request: any): void {
    this.sendJson(res, {
      jsonrpc: '2.0',
      id: request.id,
      result: {}
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HttpCustomHeadersScenario - tests that clients mirror x-mcp-header params
// ─────────────────────────────────────────────────────────────────────────────

export class HttpCustomHeadersScenario extends BaseHttpScenario {
  name = 'http-custom-headers';
  specVersions: SpecVersion[] = ['draft'];
  description =
    'Tests that client mirrors x-mcp-header tool parameters into Mcp-Param headers with correct encoding (SEP-2243)';

  private toolCallReceived: boolean = false;

  async start(): Promise<ScenarioUrls> {
    const urls = await super.start();
    // Pass test values via context for encoding edge cases.
    // The conformance client should use these values when calling test_custom_headers.
    urls.context = {
      toolCall: {
        name: 'test_custom_headers',
        arguments: {
          region: 'us-west1',
          priority: 42,
          verbose: false,
          empty_val: '',
          method_val: 'test-method',
          float_val: 3.14159,
          query: 'SELECT * FROM users'
        }
      }
    };
    return urls;
  }

  getChecks(): ConformanceCheck[] {
    if (!this.toolCallReceived) {
      this.checks.push({
        id: 'client-custom-header-tool-call',
        name: 'ClientCustomHeaderToolCall',
        description: 'Client calls the tool with x-mcp-header annotations',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage:
          'Client did not send a tools/call request for test_custom_headers.',
        specReferences: [SPEC_REFERENCE_CUSTOM]
      });
    }
    return this.checks;
  }

  protected handlePost(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    request: any
  ): void {
    if (request.method === 'initialize') {
      this.sendInitialize(res, request);
    } else if (request.method === 'tools/list') {
      this.handleToolsList(res, request);
    } else if (request.method === 'tools/call') {
      this.handleToolsCall(req, res, request);
    } else if (request.id === undefined) {
      this.sendNotificationAck(res);
    } else {
      this.sendGenericResult(res, request);
    }
  }

  private handleToolsList(res: http.ServerResponse, request: any): void {
    this.sendJson(res, {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'test_custom_headers',
            description:
              'A tool with x-mcp-header annotations to test custom header mirroring and encoding',
            inputSchema: {
              type: 'object',
              properties: {
                region: {
                  type: 'string',
                  description: 'Plain ASCII string value',
                  'x-mcp-header': 'Region'
                },
                priority: {
                  type: 'number',
                  description: 'Integer numeric value',
                  'x-mcp-header': 'Priority'
                },
                verbose: {
                  type: 'boolean',
                  description: 'Boolean value',
                  'x-mcp-header': 'Verbose'
                },
                empty_val: {
                  type: 'string',
                  description: 'Empty string value',
                  'x-mcp-header': 'EmptyVal'
                },
                method_val: {
                  type: 'string',
                  description:
                    'Value for header named "Method" — tests that x-mcp-header "Method" produces Mcp-Param-Method (not Mcp-Method)',
                  'x-mcp-header': 'Method'
                },
                float_val: {
                  type: 'number',
                  description: 'Floating point numeric value',
                  'x-mcp-header': 'FloatVal'
                },
                query: {
                  type: 'string',
                  description:
                    'No x-mcp-header annotation - should not be mirrored'
                }
              },
              required: ['region', 'priority', 'query']
            }
          }
        ]
      }
    });
  }

  private handleToolsCall(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    request: any
  ): void {
    this.toolCallReceived = true;
    const args = request.params?.arguments || {};

    // Check Mcp-Param-Region header (plain ASCII string)
    this.checkParamHeader(req, 'Region', args.region, 'string');

    // Check Mcp-Param-Priority header (integer number)
    this.checkParamHeader(req, 'Priority', args.priority, 'number');

    // Check Mcp-Param-Verbose header (boolean value)
    if (args.verbose !== undefined && args.verbose !== null) {
      this.checkParamHeader(req, 'Verbose', args.verbose, 'boolean');

      // Explicit check: optional parameter present → client MUST include header
      const verboseHeader = req.headers['mcp-param-verbose'] as
        | string
        | undefined;
      this.checks.push({
        id: 'client-custom-header-optional-present',
        name: 'ClientCustomHeaderOptionalPresent',
        description:
          'Client MUST include Mcp-Param header when optional parameter is provided',
        status: verboseHeader !== undefined ? 'SUCCESS' : 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage:
          verboseHeader === undefined
            ? `Optional parameter 'verbose' was provided with value '${args.verbose}' but Mcp-Param-Verbose header is missing. Client MUST include the header when the parameter is present.`
            : undefined,
        specReferences: [SPEC_REFERENCE_CUSTOM],
        details: {
          parameter: 'verbose',
          bodyValue: args.verbose,
          headerPresent: verboseHeader !== undefined
        }
      });
    } else {
      // When value is null or not provided, client MUST omit the header
      const headerValue = req.headers['mcp-param-verbose'] as
        | string
        | undefined;
      this.checks.push({
        id: 'client-custom-header-omit-null',
        name: 'ClientCustomHeaderOmitNull',
        description:
          'Client MUST omit Mcp-Param header when parameter value is null or not provided',
        status: headerValue === undefined ? 'SUCCESS' : 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage:
          headerValue !== undefined
            ? `Mcp-Param-Verbose should be omitted when null/undefined, but got '${headerValue}'`
            : undefined,
        specReferences: [SPEC_REFERENCE_CUSTOM]
      });
    }

    // Check Mcp-Param-EmptyVal header (empty string → empty header value)
    if (args.empty_val !== undefined && args.empty_val !== null) {
      this.checkParamHeader(req, 'EmptyVal', args.empty_val, 'string');
    }

    // Check Mcp-Param-Method header (x-mcp-header "Method" → Mcp-Param-Method, NOT Mcp-Method)
    if (args.method_val !== undefined && args.method_val !== null) {
      this.checkParamHeader(req, 'Method', args.method_val, 'string');
    }

    // Check Mcp-Param-FloatVal header (floating point number)
    if (args.float_val !== undefined && args.float_val !== null) {
      this.checkParamHeader(req, 'FloatVal', args.float_val, 'number');
    }

    // Check that 'query' (no x-mcp-header) is NOT mirrored
    const queryHeader = req.headers['mcp-param-query'] as string | undefined;
    if (queryHeader !== undefined) {
      this.checks.push({
        id: 'client-custom-header-no-mirror-unannotated',
        name: 'ClientCustomHeaderNoMirrorUnannotated',
        description:
          'Client MUST NOT add Mcp-Param headers for parameters without x-mcp-header',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Found unexpected Mcp-Param-Query header '${queryHeader}' for unannotated parameter`,
        specReferences: [SPEC_REFERENCE_CUSTOM]
      });
    }

    this.sendJson(res, {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [{ type: 'text', text: 'Custom headers test completed' }]
      }
    });
  }

  private checkParamHeader(
    req: http.IncomingMessage,
    headerName: string,
    bodyValue: any,
    valueType: string
  ): void {
    const headerKey = `mcp-param-${headerName.toLowerCase()}`;
    const rawHeaderValue = req.headers[headerKey] as string | undefined;

    if (bodyValue === undefined || bodyValue === null) return;

    const errors: string[] = [];

    if (rawHeaderValue === undefined) {
      errors.push(
        `Missing Mcp-Param-${headerName} header. Client MUST include headers for x-mcp-header parameters.`
      );
    } else {
      // Convert body value to expected string representation
      let expectedString: string;
      switch (valueType) {
        case 'number':
          expectedString = String(bodyValue);
          break;
        case 'boolean':
          expectedString = bodyValue ? 'true' : 'false';
          break;
        default:
          expectedString = String(bodyValue);
      }

      const validationError = validateEncodedHeader(
        rawHeaderValue,
        expectedString
      );
      if (validationError) {
        errors.push(validationError);
      }
    }

    this.checks.push({
      id: `client-custom-header-${headerName.toLowerCase()}`,
      name: `ClientCustomHeader_${headerName}`,
      description: `Client sends correct Mcp-Param-${headerName} header (${valueType} value)`,
      status: errors.length === 0 ? 'SUCCESS' : 'FAILURE',
      timestamp: new Date().toISOString(),
      errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
      specReferences: [SPEC_REFERENCE_ENCODING],
      details: {
        headerName: `Mcp-Param-${headerName}`,
        rawHeaderValue,
        bodyValue,
        valueType,
        needsBase64:
          typeof bodyValue === 'string' &&
          needsBase64Encoding(String(bodyValue))
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HttpInvalidToolHeadersScenario - tests that clients reject invalid tools
// ─────────────────────────────────────────────────────────────────────────────

export class HttpInvalidToolHeadersScenario extends BaseHttpScenario {
  name = 'http-invalid-tool-headers';
  specVersions: SpecVersion[] = ['draft'];
  description =
    'Tests that client rejects tools with invalid x-mcp-header annotations (SEP-2243)';
  allowClientError = true;

  private calledTools: Set<string> = new Set();
  private toolsListSent = false;

  getChecks(): ConformanceCheck[] {
    if (!this.toolsListSent) {
      this.checks.push({
        id: 'client-invalid-tool-headers-tools-list',
        name: 'ClientInvalidToolHeadersToolsList',
        description: 'Client requests tools/list',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: 'Client did not send a tools/list request.',
        specReferences: [SPEC_REFERENCE_TOOL_DEF]
      });
    }

    // Check that the client did NOT call any of the invalid tools
    const invalidTools = [
      'invalid_empty_header',
      'invalid_object_header',
      'invalid_array_header',
      'invalid_null_header',
      'invalid_nested_header',
      'invalid_duplicate_same_case',
      'invalid_duplicate_diff_case',
      'invalid_space_in_name',
      'invalid_colon_in_name',
      'invalid_non_ascii_name',
      'invalid_control_char_name'
    ];

    for (const toolName of invalidTools) {
      if (this.calledTools.has(toolName)) {
        this.checks.push({
          id: `client-rejects-invalid-tool-${toolName}`,
          name: `ClientRejectsInvalidTool_${toolName}`,
          description: `Client MUST NOT call tool '${toolName}' with invalid x-mcp-header`,
          status: 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: `Client called '${toolName}' which has an invalid x-mcp-header. Clients MUST reject (exclude) such tools.`,
          specReferences: [SPEC_REFERENCE_TOOL_DEF]
        });
      }
    }

    return this.checks;
  }

  protected handlePost(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    request: any
  ): void {
    if (request.method === 'initialize') {
      this.sendInitialize(res, request);
    } else if (request.method === 'tools/list') {
      this.handleToolsList(res, request);
    } else if (request.method === 'tools/call') {
      this.handleToolsCall(res, request);
    } else if (request.id === undefined) {
      this.sendNotificationAck(res);
    } else {
      this.sendGenericResult(res, request);
    }
  }

  private handleToolsList(res: http.ServerResponse, request: any): void {
    this.toolsListSent = true;

    this.sendJson(res, {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          // ── Valid tool (should be kept by client) ──
          {
            name: 'valid_tool',
            description: 'A valid tool with correct x-mcp-header',
            inputSchema: {
              type: 'object',
              properties: {
                region: {
                  type: 'string',
                  'x-mcp-header': 'Region'
                }
              },
              required: ['region']
            }
          },

          // ── Invalid: empty x-mcp-header value ──
          {
            name: 'invalid_empty_header',
            description:
              'x-mcp-header MUST NOT be empty (MUST be rejected by client)',
            inputSchema: {
              type: 'object',
              properties: {
                value: { type: 'string', 'x-mcp-header': '' }
              },
              required: ['value']
            }
          },

          // ── Invalid: x-mcp-header on object type ──
          {
            name: 'invalid_object_header',
            description:
              'x-mcp-header MUST only be on primitive types (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                data: { type: 'object', 'x-mcp-header': 'Data' }
              },
              required: ['data']
            }
          },

          // ── Invalid: x-mcp-header on array type ──
          {
            name: 'invalid_array_header',
            description:
              'x-mcp-header MUST only be on primitive types (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: { type: 'string' },
                  'x-mcp-header': 'Items'
                }
              },
              required: ['items']
            }
          },

          // ── Invalid: x-mcp-header on null type ──
          {
            name: 'invalid_null_header',
            description:
              'x-mcp-header MUST only be on primitive types (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                nil: { type: 'null', 'x-mcp-header': 'Nil' }
              },
              required: ['nil']
            }
          },

          // ── Invalid: x-mcp-header on nested property inside object ──
          {
            name: 'invalid_nested_header',
            description:
              'x-mcp-header on property inside nested object (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                outer: {
                  type: 'object',
                  properties: {
                    inner: {
                      type: 'string',
                      'x-mcp-header': 'Inner'
                    }
                  }
                }
              },
              required: ['outer']
            }
          },

          // ── Invalid: duplicate same-case x-mcp-header values ──
          {
            name: 'invalid_duplicate_same_case',
            description:
              'Duplicate x-mcp-header "Region" on two properties (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                field1: { type: 'string', 'x-mcp-header': 'Region' },
                field2: { type: 'string', 'x-mcp-header': 'Region' }
              },
              required: ['field1', 'field2']
            }
          },

          // ── Invalid: duplicate case-insensitive x-mcp-header values ──
          {
            name: 'invalid_duplicate_diff_case',
            description:
              'Duplicate case-insensitive x-mcp-header "MyField"/"myfield" (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                field1: { type: 'string', 'x-mcp-header': 'MyField' },
                field2: { type: 'string', 'x-mcp-header': 'myfield' }
              },
              required: ['field1', 'field2']
            }
          },

          // ── Invalid: space in x-mcp-header name ──
          {
            name: 'invalid_space_in_name',
            description:
              'x-mcp-header MUST NOT contain space (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                value: { type: 'string', 'x-mcp-header': 'My Region' }
              },
              required: ['value']
            }
          },

          // ── Invalid: colon in x-mcp-header name ──
          {
            name: 'invalid_colon_in_name',
            description:
              'x-mcp-header MUST NOT contain colon (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                value: {
                  type: 'string',
                  'x-mcp-header': 'Region:Primary'
                }
              },
              required: ['value']
            }
          },

          // ── Invalid: non-ASCII in x-mcp-header name ──
          {
            name: 'invalid_non_ascii_name',
            description:
              'x-mcp-header MUST contain only ASCII chars (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                value: { type: 'string', 'x-mcp-header': 'Région' }
              },
              required: ['value']
            }
          },

          // ── Invalid: control character in x-mcp-header name ──
          {
            name: 'invalid_control_char_name',
            description:
              'x-mcp-header MUST NOT contain control chars (MUST be rejected)',
            inputSchema: {
              type: 'object',
              properties: {
                value: { type: 'string', 'x-mcp-header': 'Region\t1' }
              },
              required: ['value']
            }
          }
        ]
      }
    });
  }

  private handleToolsCall(res: http.ServerResponse, request: any): void {
    const toolName = request.params?.name;
    if (toolName) this.calledTools.add(toolName);

    this.sendJson(res, {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [{ type: 'text', text: 'Tool call received' }]
      }
    });
  }
}
