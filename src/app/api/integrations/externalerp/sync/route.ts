import { readJson, requirePermission } from '@/lib/api';
import { withApi } from '@/lib/handlers';
import { callExternalErp, getExternalErpConfig } from '@/lib/services/externalErp';
import { db } from '@/lib/db';
import { integrationSyncRecords } from '@/lib/db/schema';
import { enqueueJobOnceDetailed } from '@/lib/queue';
import { sql } from 'drizzle-orm';

export const POST = withApi(async (actor, req) => {
  requirePermission(actor.user, 'integrations.manage');
  const body = await readJson<{ path?: unknown; entityType?: unknown; entityId?: unknown; payload?: unknown; queue?: unknown }>(req);
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  const entityType = typeof body.entityType === 'string' ? body.entityType : '';
  const entityId = typeof body.entityId === 'string' ? body.entityId : '';
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown>
    : {};
  if (!path.startsWith('/') || !entityType || !entityId) {
    return { status: 422, error: { message: 'path, entityType, and entityId are required', code: 'VALIDATION' } };
  }
  if (body.queue) {
    const outcome = await enqueueJobOnceDetailed('ERP_SYNC', {
      provider: 'externalerp',
      path,
      entityType,
      entityId,
      payload,
    }, { digestKey: `externalerp:${entityType}:${entityId}:${path}`, maxAttempts: 5 });
    return { ok: outcome.status === 'queued', outcome };
  }
  const config = await getExternalErpConfig();
  if (!config) return { status: 503, error: { message: 'External ERP is not active or configured', code: 'CONFIG' } };
  try {
    const result = await callExternalErp(config, path, 'POST', payload);
    await db.insert(integrationSyncRecords).values({
      provider: 'externalerp',
      direction: 'CRM_TO_ERP',
      entityType,
      entityId,
      status: result.ok ? 'SYNCED' : 'REJECTED',
      attemptCount: 1,
      lastError: result.ok ? null : `HTTP ${result.status}`,
      requestPayload: payload,
      responsePayload: typeof result.body === 'object' && result.body !== null
        ? result.body as Record<string, unknown>
        : { body: result.body },
      syncedAt: result.ok ? new Date() : null,
    }).onConflictDoUpdate({
      target: [integrationSyncRecords.provider, integrationSyncRecords.entityType, integrationSyncRecords.entityId],
      set: {
        status: result.ok ? 'SYNCED' : 'REJECTED',
        attemptCount: sql`${integrationSyncRecords.attemptCount} + 1`,
        lastError: result.ok ? null : `HTTP ${result.status}`,
        requestPayload: payload,
        responsePayload: typeof result.body === 'object' && result.body !== null
          ? result.body as Record<string, unknown>
          : { body: result.body },
        syncedAt: result.ok ? new Date() : null,
        updatedAt: new Date(),
      },
    });
    return { ok: result.ok, status: result.status, response: result.body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.insert(integrationSyncRecords).values({
      provider: 'externalerp',
      direction: 'CRM_TO_ERP',
      entityType,
      entityId,
      status: 'FAILED',
      attemptCount: 1,
      lastError: message,
      requestPayload: payload,
      responsePayload: {},
    }).onConflictDoUpdate({
      target: [integrationSyncRecords.provider, integrationSyncRecords.entityType, integrationSyncRecords.entityId],
      set: {
        status: 'FAILED',
        attemptCount: sql`${integrationSyncRecords.attemptCount} + 1`,
        lastError: message,
        requestPayload: payload,
        updatedAt: new Date(),
      },
    });
    return { status: 502, error: { message, code: 'EXTERNAL_ERP_ERROR' } };
  }
});
