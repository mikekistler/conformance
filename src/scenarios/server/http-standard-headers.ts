/**
 * HTTP Standard Headers server validation test scenarios (SEP-2243)
 *
 * Tests that servers properly validate the standard MCP request headers:
 * - Reject requests where Mcp-Method header doesn't match the body
 * - Reject requests where Mcp-Name header doesn't match the body
 * - Accept case variations of header names (case-insensitive)
 * - Reject case variations of header values (case-sensitive)
 * - Handle whitespace trimming per HTTP spec
 * - Validate Base64-encoded custom header values
 * - Return 400 Bad Request with error code -32001 (HeaderMismatch)
 *
 * This is a ClientScenario (connects to a server under test and validates
 * its behavior).
 */

import { ClientScenario, ConformanceCheck, SpecVersion } from '../../types';
import { connectToServer } from './client-helper';

const SPEC_REFERENCE = {
  id: 'SEP-2243-Server-Validation',
  url: 'https://modelcontextprotocol.io/specification/draft/basic/transports#server-validation'
};

const SPEC_REFERENCE_CASE = {
  id: 'SEP-2243-Case-Sensitivity',
  url: 'https://modelcontextprotocol.io/specification/draft/basic/transports#case-sensitivity'
};

const SPEC_REFERENCE_BASE64 = {
  id: 'SEP-2243-Value-Encoding',
  url: 'https://modelcontextprotocol.io/specification/draft/basic/transports#value-encoding'
};

const SPEC_REFERENCE_CUSTOM = {
  id: 'SEP-2243-Custom-Headers',
  url: 'https://modelcontextprotocol.io/specification/draft/basic/transports#server-behavior-for-custom-headers'
};

const HEADER_MISMATCH_ERROR_CODE = -32001;

/**
 * Helper to send a raw HTTP POST request with custom headers.
 * This bypasses the SDK's automatic header handling so we can test
 * server validation of mismatched/missing headers.
 */
async function sendRawRequest(
  serverUrl: string,
  body: object,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers
    },
    body: JSON.stringify(body)
  });

  let responseBody: any;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    responseBody = await response.json();
  } else {
    responseBody = await response.text();
  }

  return {
    status: response.status,
    body: responseBody,
    headers: response.headers
  };
}

function createRejectionCheck(
  id: string,
  name: string,
  description: string,
  response: { status: number; body: any },
  specRef: { id: string; url: string },
  details: Record<string, unknown>
): ConformanceCheck {
  const errors: string[] = [];
  if (response.status !== 400) {
    errors.push(
      `Expected HTTP 400, got ${response.status}. Server MUST reject with 400 Bad Request.`
    );
  }
  if (response.body?.error?.code !== HEADER_MISMATCH_ERROR_CODE) {
    errors.push(
      `Expected JSON-RPC error code ${HEADER_MISMATCH_ERROR_CODE} (HeaderMismatch), got ${response.body?.error?.code ?? '(missing)'}. Server MUST use code -32001.`
    );
  }
  return {
    id,
    name,
    description,
    status: errors.length > 0 ? 'FAILURE' : 'SUCCESS',
    timestamp: new Date().toISOString(),
    errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
    specReferences: [specRef],
    details: {
      ...details,
      responseStatus: response.status,
      responseBody: response.body
    }
  };
}

function createAcceptanceCheck(
  id: string,
  name: string,
  description: string,
  response: { status: number; body: any },
  specRef: { id: string; url: string },
  details: Record<string, unknown>
): ConformanceCheck {
  const errors: string[] = [];
  if (response.status >= 400) {
    errors.push(
      `Expected successful response, got HTTP ${response.status}. Server MUST accept this request.`
    );
  }
  return {
    id,
    name,
    description,
    status: errors.length === 0 ? 'SUCCESS' : 'FAILURE',
    timestamp: new Date().toISOString(),
    errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
    specReferences: [specRef],
    details: {
      ...details,
      responseStatus: response.status,
      responseBody: response.body
    }
  };
}

export class HttpHeaderValidationScenario implements ClientScenario {
  name = 'http-header-validation';
  specVersions: SpecVersion[] = ['draft'];
  description = `Test server validation of standard MCP request headers (SEP-2243).

**Server Implementation Requirements:**

**Endpoint**: Streamable HTTP

**Requirements**:
- Server MUST reject requests where Mcp-Method header doesn't match the body method
- Server MUST reject requests where Mcp-Name header doesn't match the body params.name/uri
- Server MUST accept header names case-insensitively
- Server MUST reject case-mismatched header values (method values are case-sensitive)
- Server MUST accept extra whitespace around header values (per HTTP spec)
- Server MUST return HTTP 400 Bad Request for validation failures
- Server MUST return JSON-RPC error with code -32001 (HeaderMismatch)`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];
    let sessionId: string | null = null;

    try {
      // Establish a session via normal SDK initialization
      const connection = await connectToServer(serverUrl);
      const toolsResult = await connection.client.listTools();
      await connection.close();

      // Get a fresh session for raw requests
      const initResponse = await sendRawRequest(
        serverUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 'draft',
            capabilities: {},
            clientInfo: {
              name: 'conformance-test-raw-client',
              version: '1.0.0'
            }
          }
        },
        { 'Mcp-Method': 'initialize' }
      );

      if (initResponse.status === 200) {
        sessionId = initResponse.headers.get('mcp-session-id') || null;
        const notifHeaders: Record<string, string> = {
          'Mcp-Method': 'notifications/initialized'
        };
        if (sessionId) notifHeaders['mcp-session-id'] = sessionId;
        await sendRawRequest(
          serverUrl,
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          notifHeaders
        );
      }

      const baseHeaders: Record<string, string> = {
        'MCP-Protocol-Version': 'draft'
      };
      if (sessionId) baseHeaders['mcp-session-id'] = sessionId;

      let idCounter = 100;
      const nextId = () => idCounter++;

      // --- Header/Body Mismatch Tests ---

      await this.testCase(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'reject',
        'server-rejects-mismatched-method-header',
        'ServerRejectsMismatchedMethodHeader',
        'Server rejects requests where Mcp-Method header does not match body method',
        { jsonrpc: '2.0', id: 0, method: 'tools/list' },
        { 'Mcp-Method': 'prompts/list' },
        SPEC_REFERENCE,
        { requestBodyMethod: 'tools/list', mcpMethodHeader: 'prompts/list' }
      );

      await this.testCase(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'reject',
        'server-rejects-missing-method-header',
        'ServerRejectsMissingMethodHeader',
        'Server rejects requests with missing Mcp-Method header',
        { jsonrpc: '2.0', id: 0, method: 'tools/list' },
        {},
        SPEC_REFERENCE,
        { requestBodyMethod: 'tools/list', mcpMethodHeader: '(missing)' }
      );

      if (toolsResult.tools && toolsResult.tools.length > 0) {
        const toolName = toolsResult.tools[0].name;

        await this.testCase(
          checks,
          serverUrl,
          baseHeaders,
          nextId,
          'reject',
          'server-rejects-mismatched-name-header',
          'ServerRejectsMismatchedNameHeader',
          'Server rejects tools/call where Mcp-Name does not match body params.name',
          {
            jsonrpc: '2.0',
            id: 0,
            method: 'tools/call',
            params: { name: toolName, arguments: {} }
          },
          { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'wrong_tool_name' },
          SPEC_REFERENCE,
          { requestBodyName: toolName, mcpNameHeader: 'wrong_tool_name' }
        );

        // --- Whitespace Test ---

        await this.testCase(
          checks,
          serverUrl,
          baseHeaders,
          nextId,
          'accept',
          'server-accepts-whitespace-header-value',
          'ServerAcceptsWhitespaceHeaderValue',
          'Server MUST accept extra whitespace in Mcp-Name value (trimmed per HTTP spec)',
          {
            jsonrpc: '2.0',
            id: 0,
            method: 'tools/call',
            params: { name: toolName, arguments: {} }
          },
          {
            'Mcp-Method': 'tools/call',
            'Mcp-Name': `  ${toolName}  `
          },
          SPEC_REFERENCE,
          {
            headerValue: `  ${toolName}  `,
            bodyValue: toolName,
            reason: 'HTTP spec requires trimming OWS around field values'
          }
        );

        // --- Missing Standard Header with Value in Body (Case 47) ---

        await this.testCase(
          checks,
          serverUrl,
          baseHeaders,
          nextId,
          'reject',
          'server-rejects-missing-name-header',
          'ServerRejectsMissingNameHeader',
          'Server MUST reject tools/call with missing Mcp-Name header when body has params.name',
          {
            jsonrpc: '2.0',
            id: 0,
            method: 'tools/call',
            params: { name: toolName, arguments: {} }
          },
          { 'Mcp-Method': 'tools/call' },
          SPEC_REFERENCE,
          {
            requestBodyName: toolName,
            mcpNameHeader: '(missing)',
            reason:
              'Standard header omitted but value present in body → MUST reject'
          }
        );
      }

      // --- Case Sensitivity Tests ---

      await this.testCase(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'accept',
        'server-accepts-lowercase-header-name',
        'ServerAcceptsLowercaseHeaderName',
        'Server MUST accept lowercase header name (mcp-method)',
        { jsonrpc: '2.0', id: 0, method: 'tools/list' },
        { 'mcp-method': 'tools/list' },
        SPEC_REFERENCE_CASE,
        { headerNameUsed: 'mcp-method' }
      );

      await this.testCase(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'accept',
        'server-accepts-uppercase-header-name',
        'ServerAcceptsUppercaseHeaderName',
        'Server MUST accept uppercase header name (MCP-METHOD)',
        { jsonrpc: '2.0', id: 0, method: 'tools/list' },
        { 'MCP-METHOD': 'tools/list' },
        SPEC_REFERENCE_CASE,
        { headerNameUsed: 'MCP-METHOD' }
      );

      await this.testCase(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'reject',
        'server-rejects-case-mismatch-value',
        'ServerRejectsCaseMismatchValue',
        'Server MUST reject uppercase method value (TOOLS/LIST) since values are case-sensitive',
        { jsonrpc: '2.0', id: 0, method: 'tools/list' },
        { 'Mcp-Method': 'TOOLS/LIST' },
        SPEC_REFERENCE_CASE,
        { headerValue: 'TOOLS/LIST', bodyValue: 'tools/list' }
      );
    } catch (error) {
      checks.push({
        id: 'http-header-validation-setup',
        name: 'HttpHeaderValidationSetup',
        description: 'Setup for header validation tests',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed to set up tests: ${error instanceof Error ? error.message : String(error)}`,
        specReferences: [SPEC_REFERENCE]
      });
    }

    return checks;
  }

  private async testCase(
    checks: ConformanceCheck[],
    serverUrl: string,
    baseHeaders: Record<string, string>,
    nextId: () => number,
    expectation: 'accept' | 'reject',
    checkId: string,
    checkName: string,
    description: string,
    body: any,
    extraHeaders: Record<string, string>,
    specRef: { id: string; url: string },
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      const requestBody = { ...body, id: body.id === 0 ? nextId() : body.id };
      const response = await sendRawRequest(serverUrl, requestBody, {
        ...baseHeaders,
        ...extraHeaders
      });
      checks.push(
        expectation === 'reject'
          ? createRejectionCheck(
              checkId,
              checkName,
              description,
              response,
              specRef,
              details
            )
          : createAcceptanceCheck(
              checkId,
              checkName,
              description,
              response,
              specRef,
              details
            )
      );
    } catch (error) {
      checks.push({
        id: checkId,
        name: checkName,
        description,
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        specReferences: [specRef]
      });
    }
  }
}

export class HttpCustomHeaderServerValidationScenario
  implements ClientScenario
{
  name = 'http-custom-header-server-validation';
  specVersions: SpecVersion[] = ['draft'];
  description = `Test server validation of custom Mcp-Param headers and Base64 encoding (SEP-2243).

**Server Implementation Requirements:**

**Endpoint**: Streamable HTTP with at least one tool using \`x-mcp-header\`

**Requirements**:
- Server MUST validate Base64-encoded header values
- Server MUST reject requests with invalid Base64 padding or characters
- Server MUST treat values without =?base64?...?= wrapper as literal
- Server MUST accept case-insensitive =?base64? prefix
- Server MUST reject requests where custom header is omitted but value is in body`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];
    let sessionId: string | null = null;

    try {
      const connection = await connectToServer(serverUrl);
      const toolsResult = await connection.client.listTools();
      await connection.close();

      // Find a tool with x-mcp-header annotations
      const xMcpTool = toolsResult.tools?.find((tool) => {
        const schema = tool.inputSchema as any;
        if (!schema?.properties) return false;
        return Object.values(schema.properties).some(
          (prop: any) => prop['x-mcp-header'] !== undefined
        );
      });

      if (!xMcpTool) {
        checks.push({
          id: 'http-custom-header-server-no-tool',
          name: 'HttpCustomHeaderServerNoTool',
          description:
            'Server has no tools with x-mcp-header annotations to test',
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
          specReferences: [SPEC_REFERENCE_CUSTOM],
          details: {
            reason:
              'No tools with x-mcp-header found. These tests require at least one tool with x-mcp-header annotations.'
          }
        });
        return checks;
      }

      // Get a fresh session for raw requests
      const initResponse = await sendRawRequest(
        serverUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 'draft',
            capabilities: {},
            clientInfo: {
              name: 'conformance-test-base64-client',
              version: '1.0.0'
            }
          }
        },
        { 'Mcp-Method': 'initialize' }
      );

      if (initResponse.status === 200) {
        sessionId = initResponse.headers.get('mcp-session-id') || null;
        const notifHeaders: Record<string, string> = {
          'Mcp-Method': 'notifications/initialized'
        };
        if (sessionId) notifHeaders['mcp-session-id'] = sessionId;
        await sendRawRequest(
          serverUrl,
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          notifHeaders
        );
      }

      const baseHeaders: Record<string, string> = {
        'MCP-Protocol-Version': 'draft'
      };
      if (sessionId) baseHeaders['mcp-session-id'] = sessionId;

      // Find the first x-mcp-header annotated property
      const schema = xMcpTool.inputSchema as any;
      const [paramName, paramDef] = Object.entries(schema.properties).find(
        ([, def]: [string, any]) => def['x-mcp-header'] !== undefined
      ) as [string, any];
      const headerSuffix = paramDef['x-mcp-header'];

      let idCounter = 200;
      const nextId = () => idCounter++;

      // --- Base64 Decoding Tests ---

      const validBase64Value = Buffer.from('Hello').toString('base64');

      // Valid Base64 - server decodes and validates
      await this.testBase64Case(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'accept',
        'server-accepts-valid-base64',
        'ServerAcceptsValidBase64',
        'Server decodes valid Base64 header value and validates against body',
        xMcpTool.name,
        paramName,
        'Hello',
        headerSuffix,
        `=?base64?${validBase64Value}?=`
      );

      // Invalid Base64 padding - server MUST reject
      await this.testBase64Case(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'reject',
        'server-rejects-invalid-base64-padding',
        'ServerRejectsInvalidBase64Padding',
        'Server MUST reject header with invalid Base64 padding',
        xMcpTool.name,
        paramName,
        'Hello',
        headerSuffix,
        '=?base64?SGVsbG8?='
      );

      // Invalid Base64 characters - server MUST reject
      await this.testBase64Case(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'reject',
        'server-rejects-invalid-base64-chars',
        'ServerRejectsInvalidBase64Chars',
        'Server MUST reject header with invalid Base64 characters',
        xMcpTool.name,
        paramName,
        'Hello',
        headerSuffix,
        '=?base64?SGVs!!!bG8=?='
      );

      // Missing prefix - server treats as literal value
      await this.testBase64Case(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'accept',
        'server-literal-missing-base64-prefix',
        'ServerLiteralMissingBase64Prefix',
        'Server treats value without =?base64? prefix as literal (not Base64)',
        xMcpTool.name,
        paramName,
        validBase64Value,
        headerSuffix,
        validBase64Value
      );

      // Missing suffix - server treats as literal value
      await this.testBase64Case(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'accept',
        'server-literal-missing-base64-suffix',
        'ServerLiteralMissingBase64Suffix',
        'Server treats value without ?= suffix as literal (not Base64)',
        xMcpTool.name,
        paramName,
        `=?base64?${validBase64Value}`,
        headerSuffix,
        `=?base64?${validBase64Value}`
      );

      // Case-insensitive Base64 prefix - server MUST accept
      await this.testBase64Case(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        'accept',
        'server-accepts-case-insensitive-base64',
        'ServerAcceptsCaseInsensitiveBase64',
        'Server MUST accept case-insensitive =?BASE64? prefix',
        xMcpTool.name,
        paramName,
        'Hello',
        headerSuffix,
        `=?BASE64?${validBase64Value}?=`
      );

      // --- Missing Custom Header with Value in Body ---

      await this.testMissingCustomHeader(
        checks,
        serverUrl,
        baseHeaders,
        nextId,
        xMcpTool.name,
        paramName,
        headerSuffix
      );
    } catch (error) {
      checks.push({
        id: 'http-custom-header-server-validation-setup',
        name: 'HttpCustomHeaderServerValidationSetup',
        description: 'Setup for custom header server validation tests',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        specReferences: [SPEC_REFERENCE_CUSTOM]
      });
    }

    return checks;
  }

  private async testBase64Case(
    checks: ConformanceCheck[],
    serverUrl: string,
    baseHeaders: Record<string, string>,
    nextId: () => number,
    expectation: 'accept' | 'reject',
    checkId: string,
    checkName: string,
    description: string,
    toolName: string,
    paramName: string,
    bodyValue: string,
    headerSuffix: string,
    headerValue: string
  ): Promise<void> {
    try {
      const response = await sendRawRequest(
        serverUrl,
        {
          jsonrpc: '2.0',
          id: nextId(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: { [paramName]: bodyValue }
          }
        },
        {
          ...baseHeaders,
          'Mcp-Method': 'tools/call',
          'Mcp-Name': toolName,
          [`Mcp-Param-${headerSuffix}`]: headerValue
        }
      );

      const details = {
        toolName,
        paramName,
        bodyValue,
        headerSuffix,
        headerValue
      };

      checks.push(
        expectation === 'reject'
          ? createRejectionCheck(
              checkId,
              checkName,
              description,
              response,
              SPEC_REFERENCE_BASE64,
              details
            )
          : createAcceptanceCheck(
              checkId,
              checkName,
              description,
              response,
              SPEC_REFERENCE_BASE64,
              details
            )
      );
    } catch (error) {
      checks.push({
        id: checkId,
        name: checkName,
        description,
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        specReferences: [SPEC_REFERENCE_BASE64]
      });
    }
  }

  private async testMissingCustomHeader(
    checks: ConformanceCheck[],
    serverUrl: string,
    baseHeaders: Record<string, string>,
    nextId: () => number,
    toolName: string,
    paramName: string,
    headerSuffix: string
  ): Promise<void> {
    try {
      // Send tools/call with value in body but NO Mcp-Param header
      const response = await sendRawRequest(
        serverUrl,
        {
          jsonrpc: '2.0',
          id: nextId(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: { [paramName]: 'test-value' }
          }
        },
        {
          ...baseHeaders,
          'Mcp-Method': 'tools/call',
          'Mcp-Name': toolName
          // Deliberately omit Mcp-Param-{headerSuffix} header
        }
      );

      checks.push(
        createRejectionCheck(
          'server-rejects-missing-custom-header',
          'ServerRejectsMissingCustomHeader',
          'Server MUST reject request where custom header is omitted but value is present in body',
          response,
          SPEC_REFERENCE_CUSTOM,
          {
            toolName,
            paramName,
            bodyValue: 'test-value',
            expectedHeader: `Mcp-Param-${headerSuffix}`,
            mcpParamHeader: '(missing)'
          }
        )
      );
    } catch (error) {
      checks.push({
        id: 'server-rejects-missing-custom-header',
        name: 'ServerRejectsMissingCustomHeader',
        description:
          'Server MUST reject request where custom header is omitted but value is present in body',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        specReferences: [SPEC_REFERENCE_CUSTOM]
      });
    }
  }
}
