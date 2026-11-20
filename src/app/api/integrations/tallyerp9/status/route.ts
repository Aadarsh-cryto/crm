import { withApi } from '@/lib/handlers';
import { requirePermission } from '@/lib/api';
import { getTallyErp9Config } from '@/lib/services/tallyErp9';
import { db } from '@/lib/db';
import { integrationSyncRecords } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export const GET = withApi(async (actor) => {
  requirePermission(actor.user, 'integrations.manage');
  const config = await getTallyErp9Config();
  const records = await db.select({
    id: integrationSyncRecords.id,
    entityType: integrationSyncRecords.entityType,
    entityId: integrationSyncRecords.entityId,
    status: integrationSyncRecords.status,
    attemptCount: integrationSyncRecords.attemptCount,
    lastError: integrationSyncRecords.lastError,
    syncedAt: integrationSyncRecords.syncedAt,
    updatedAt: integrationSyncRecords.updatedAt,
  }).from(integrationSyncRecords)
    .where(eq(integrationSyncRecords.provider, 'tallyerp9'))
    .orderBy(desc(integrationSyncRecords.updatedAt))
    .limit(50);
  return {
    provider: 'tallyerp9',
    active: Boolean(config),
    configured: Boolean(config?.agentToken && config?.companyName),
    companyName: config?.companyName ?? null,
    release: config?.release ?? null,
    records,
  };
});
