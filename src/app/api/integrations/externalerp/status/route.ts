import { withApi } from '@/lib/handlers';
import { requirePermission } from '@/lib/api';
import { getExternalErpConfig } from '@/lib/services/externalErp';
import { db } from '@/lib/db';
import { integrationSyncRecords } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export const GET = withApi(async (actor) => {
  requirePermission(actor.user, 'integrations.manage');
  const config = await getExternalErpConfig();
  const records = await db.query.integrationSyncRecords.findMany({
    where: and(eq(integrationSyncRecords.provider, 'externalerp')),
    orderBy: [desc(integrationSyncRecords.updatedAt)],
    limit: 50,
  });
  return {
    provider: 'externalerp',
    active: Boolean(config),
    configured: Boolean(config?.baseUrl),
    records,
  };
});
