import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  state: {
    authenticated: true,
    permissions: ['integrations.manage'] as string[],
    integration: null as Record<string, unknown> | null,
  },
  db: {
    query: {
      integrations: { findFirst: vi.fn() },
    },
    select: vi.fn(),
    insert: vi.fn(),
  },
  writeAudit: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    requireUser: vi.fn(async (req: NextRequest) => {
      if (!mocks.state.authenticated) throw new actual.ApiError(401, 'Authentication required');
      return {
        user: { id: 'test-user', isSuperAdmin: false, permissions: mocks.state.permissions },
        ip: null,
        userAgent: null,
        path: req.nextUrl.pathname,
        method: req.method,
      };
    }),
  };
});

import { GET, PUT } from '@/app/api/settings/keys/route';
import { decryptSecret, encryptSecret } from '@/lib/secrets';

function request(method: 'GET' | 'PUT', body?: Record<string, unknown>): NextRequest {
  return new NextRequest('https://crm.test/api/settings/keys', {
    method,
    ...(body ? {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    } : {}),
  });
}

async function responseBody(response: NextResponse): Promise<Record<string, any>> {
  return response.json();
}

describe('Tally ERP 9 configuration API', () => {
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(64);
    mocks.state.authenticated = true;
    mocks.state.permissions = ['integrations.manage'];
    mocks.state.integration = null;
    mocks.db.query.integrations.findFirst.mockResolvedValue(null);
    mocks.db.select.mockImplementation(() => ({
      from: () => ({
        where: async () => mocks.state.integration ? [mocks.state.integration] : [],
      }),
    }));
    mocks.db.insert.mockImplementation(() => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            mocks.state.integration = { id: 'integration-1', ...values };
            return [mocks.state.integration];
          },
        }),
      }),
    }));
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('saves an encrypted agent token and never returns it in the API response', async () => {
    const token = 'secret-token-'.padEnd(40, 'x');
    const saved = await PUT(request('PUT', {
      provider: 'tallyerp9',
      companyName: 'Tech Shilpi',
      release: '6.6',
      agentToken: token,
    }), { params: Promise.resolve({}) });
    const savedBody = await responseBody(saved);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(savedBody)).not.toContain(token);

    const savedConfig = (mocks.state.integration?.config as Record<string, string>);
    expect(savedConfig.agentToken).not.toBe(token);
    expect(decryptSecret(savedConfig.agentToken)).toBe(token);

    const loaded = await GET(request('GET'), { params: Promise.resolve({}) });
    const loadedBody = await responseBody(loaded);
    expect(loaded.status).toBe(200);
    expect(JSON.stringify(loadedBody)).not.toContain(token);
    expect(JSON.stringify(loadedBody)).toContain('set (hidden)');
    expect(loadedBody.items.map((item: { provider: string }) => item.provider)).toEqual(['tallyerp9']);
  });

  it('requires authentication and rejects invalid Tally configuration', async () => {
    mocks.state.authenticated = false;
    const unauthorized = await GET(request('GET'), { params: Promise.resolve({}) });
    expect(unauthorized.status).toBe(401);

    mocks.state.authenticated = true;
    const invalid = await PUT(request('PUT', {
      provider: 'tallyerp9',
      companyName: 'Tech Shilpi',
      agentToken: 'short',
    }), { params: Promise.resolve({}) });
    expect(invalid.status).toBe(422);
    expect(await responseBody(invalid)).toMatchObject({
      error: { message: 'Windows agent token must be at least 32 characters' },
    });
  });

  it('keeps the existing token when updating settings and supports token rotation', async () => {
    const oldToken = 'old-agent-token'.padEnd(40, 'x');
    const newToken = 'new-agent-token'.padEnd(40, 'y');
    const encryptedToken = encryptSecret(oldToken);
    mocks.state.integration = {
      id: 'integration-1',
      provider: 'tallyerp9',
      isActive: true,
      config: { agentToken: encryptedToken, companyName: 'Old company' },
    };
    mocks.db.query.integrations.findFirst.mockResolvedValue(mocks.state.integration);

    const updateCompany = await PUT(request('PUT', {
      provider: 'tallyerp9',
      companyName: 'Tech Shilpi',
    }), { params: Promise.resolve({}) });
    expect(updateCompany.status).toBe(200);
    let config = mocks.state.integration?.config as Record<string, string>;
    expect(config.agentToken).toBe(encryptedToken);

    const rotateToken = await PUT(request('PUT', {
      provider: 'tallyerp9',
      companyName: 'Tech Shilpi',
      agentToken: newToken,
    }), { params: Promise.resolve({}) });
    expect(rotateToken.status).toBe(200);
    config = mocks.state.integration?.config as Record<string, string>;
    expect(decryptSecret(config.agentToken)).toBe(newToken);
  });

  it('enforces the integration permission on Tally-only configuration access', async () => {
    mocks.state.permissions = [];
    const denied = await GET(request('GET'), { params: Promise.resolve({}) });
    expect(denied.status).toBe(403);
  });
});
