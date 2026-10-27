import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OperationRequestSchema } from '../types/schemas.js';
import { SchedulingApi } from './scheduling-api.js';

export class SchedulingHttpServer {
  private readonly api: SchedulingApi;
  private server: Server | null = null;

  constructor(api: SchedulingApi) {
    this.api = api;
  }

  public async start(port: number = 0): Promise<string> {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err) {
          this.sendJson(res, 500, {
            error: err instanceof Error ? err.message : 'INTERNAL_ERROR'
          });
        }
      });
      this.server.listen(port, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
      this.server = null;
    });
  }

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/api/providers') {
      this.sendJson(res, 200, { providers: this.api.listProviders() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/slots') {
      const providerId = url.searchParams.get('providerId') ?? undefined;
      const dayOfWeek = url.searchParams.get('dayOfWeek') ?? undefined;
      this.sendJson(res, 200, {
        slots: this.api.listAvailableSlots(providerId, dayOfWeek)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/verify') {
      const body = await this.readBody(req);
      const out = this.api.verifyPatient({
        conversationId: String(body.conversationId ?? ''),
        patientId: String(body.patientId ?? ''),
        dob: String(body.dob ?? ''),
        verificationPin: String(body.verificationPin ?? '')
      });
      this.sendJson(res, out.verified ? 200 : 401, out);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/mutations') {
      const body = await this.readBody(req);
      const parsed = OperationRequestSchema.parse(body);
      const out = this.api.executeMutation(parsed);
      const status =
        out.backendOutcome === 'COMMITTED' || out.backendOutcome === 'NO_OP' ? 200 : 400;
      this.sendJson(res, status, out);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/operations/reconcile') {
      const conversationId = url.searchParams.get('conversationId') ?? 'http-conv';
      const operationId = url.searchParams.get('operationId') ?? '';
      const idempotencyKey = url.searchParams.get('idempotencyKey') ?? '';
      const out = this.api.reconcileOperation(conversationId, operationId, idempotencyKey);
      this.sendJson(res, 200, out);
      return;
    }

    this.sendJson(res, 404, { error: 'NOT_FOUND' });
  }
}
