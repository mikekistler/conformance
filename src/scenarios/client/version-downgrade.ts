import http from 'http';
import {
  Scenario,
  ScenarioUrls,
  ConformanceCheck,
  SpecVersion
} from '../../types';

export class VersionDowngradeScenario implements Scenario {
  name = 'version-downgrade';
  specVersions: SpecVersion[] = ['2025-06-18', '2025-11-25'];
  description =
    'Tests that the client accepts a server responding with a lower supported protocol version';

  private server: http.Server | null = null;
  private checks: ConformanceCheck[] = [];
  private port: number = 0;

  // The server always responds with this older version, regardless of what the client requests.
  private readonly serverVersion = '2025-06-18';

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
          resolve({
            serverUrl: `http://localhost:${this.port}`
          });
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
          if (err) {
            reject(err);
          } else {
            this.server = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  getChecks(): ConformanceCheck[] {
    return this.checks;
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const request = JSON.parse(body);

        if (request.method === 'initialize') {
          this.handleInitialize(request, res);
        } else if (request.method === 'notifications/initialized') {
          // The client sent the initialized notification — this is the success signal.
          this.checks.push({
            id: 'version-downgrade-accepted',
            name: 'VersionDowngradeAccepted',
            description:
              'Client accepted the server responding with a lower protocol version and sent initialized notification',
            status: 'SUCCESS',
            timestamp: new Date().toISOString(),
            specReferences: [
              {
                id: 'MCP-Lifecycle',
                url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle'
              }
            ]
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end();
        } else if (request.method === 'tools/list') {
          this.handleToolsList(request, res);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: {}
            })
          );
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: `Parse error ${error}`
            }
          })
        );
      }
    });
  }

  private handleInitialize(request: any, res: http.ServerResponse): void {
    const initializeRequest = request.params;
    const clientVersion = initializeRequest?.protocolVersion;

    // Validate the client sent a proper initialize request
    const errors: string[] = [];
    if (!clientVersion) errors.push('Protocol version not provided');
    if (!initializeRequest?.clientInfo?.name)
      errors.push('Client name missing');
    if (!initializeRequest?.clientInfo?.version)
      errors.push('Client version missing');

    this.checks.push({
      id: 'mcp-client-initialization',
      name: 'MCPClientInitialization',
      description: 'Validates that MCP client properly initializes with server',
      status: errors.length === 0 ? 'SUCCESS' : 'FAILURE',
      timestamp: new Date().toISOString(),
      specReferences: [
        {
          id: 'MCP-Lifecycle',
          url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle'
        }
      ],
      details: {
        clientProtocolVersion: clientVersion,
        serverProtocolVersion: this.serverVersion
      },
      errorMessage: errors.length > 0 ? errors.join('; ') : undefined
    });

    // Respond with a lower version than the client requested.
    const response = {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: this.serverVersion,
        serverInfo: {
          name: 'test-server',
          version: '1.0.0'
        },
        capabilities: {}
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  private handleToolsList(request: any, res: http.ServerResponse): void {
    const response = {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: []
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }
}
