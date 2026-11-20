import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { decryptSecret, looksEncrypted } from '@/lib/secrets';
import { registerJobHandler } from '@/lib/queue';

export interface ExternalErpConfig {
  baseUrl: string;
  authHeader: 'Bearer' | 'API-Key';
  apiSecret: string | null;
}

export async function getExternalErpConfig(): Promise<ExternalErpConfig | null> {
  const row = await db.query.integrations.findFirst({ where: eq(integrations.provider, 'externalerp') });
  if (!row?.isActive) return null;
  const config = (row.config ?? {}) as Record<string, unknown>;
  let apiSecret: string | null = null;
  if (typeof config.apiSecret === 'string' && looksEncrypted(config.apiSecret)) {
    apiSecret = decryptSecret(config.apiSecret);
  } else if (typeof config.apiSecret === 'string') {
    apiSecret = config.apiSecret;
  }
  return {
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.trim().replace(/\/$/, '') : '',
    authHeader: config.authHeader === 'API-Key' ? 'API-Key' : 'Bearer',
    apiSecret,
  };
}

export async function callExternalErp(
  config: ExternalErpConfig,
  path: string,
  method: 'GET' | 'POST',
  payload?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!config.baseUrl) throw new Error('External ERP base URL is not configured');
  if (!/^https:\/\//i.test(config.baseUrl)) {
    throw new Error('External ERP API must use HTTPS');
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (payload) headers['content-type'] = 'application/json';
  if (config.apiSecret) {
    headers[config.authHeader === 'API-Key' ? 'x-api-key' : 'authorization'] =
      config.authHeader === 'API-Key' ? config.apiSecret : `Bearer ${config.apiSecret}`;
  }
  const response = await fetch(`${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Text responses are retained instead of hiding an integration error.
  }
  return { ok: response.ok, status: response.status, body };
}

export async function testExternalErpConnection(): Promise<{ ok: boolean; detail: string }> {
  const config = await getExternalErpConfig();
  if (!config) return { ok: false, detail: 'External ERP is not active or configured' };
  if (!config.baseUrl) return { ok: false, detail: 'External ERP API base URL is required' };
  try {
    const result = await callExternalErp(config, '/health', 'GET');
    return result.ok
      ? { ok: true, detail: `External ERP health endpoint responded HTTP ${result.status}` }
      : { ok: false, detail: `External ERP health endpoint responded HTTP ${result.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function registerExternalErpJobHandler(): void {
  registerJobHandler('ERP_SYNC', async (payload) => {
    const path = String(payload.path ?? '');
    const payloadBody = payload.payload && typeof payload.payload === 'object'
      ? payload.payload as Record<string, unknown>
      : {};
    if (!path.startsWith('/')) throw new Error('External ERP sync payload has an invalid path');
    const config = await getExternalErpConfig();
    if (!config) throw new Error('External ERP is not active or configured');
    const result = await callExternalErp(config, path, 'POST', payloadBody);
    if (!result.ok) throw new Error(`External ERP returned HTTP ${result.status}`);
  });
}
