import { and, eq, inArray } from 'drizzle-orm';
import { ApiError, readJson, requirePermission } from '@/lib/api';
import { withApi } from '@/lib/handlers';
import { db } from '@/lib/db';
import { customers, integrationEntityMappings, integrationSyncRecords } from '@/lib/db/schema';
import { buildPartyLedgerXml, getTallyErp9Config } from '@/lib/services/tallyErp9';

export const POST = withApi(async (actor, req) => {
  requirePermission(actor.user, 'integrations.manage');
  const body = await readJson<{ entityType?: unknown; entityId?: unknown; confirmPosting?: unknown }>(req);
  const entityType = typeof body.entityType === 'string' ? body.entityType : '';
  const entityId = typeof body.entityId === 'string' ? body.entityId : '';
  if (entityType !== 'customer' || !entityId) {
    return { status: 422, error: { message: 'entityType and entityId are required', code: 'VALIDATION' } };
  }
  if (body.confirmPosting !== true) {
    return {
      status: 428,
      error: { message: 'Customer ledger posting requires confirmPosting: true. No Tally writes are performed by the connection test.', code: 'CONFIRMATION_REQUIRED' },
    };
  }
  const config = await getTallyErp9Config();
  if (!config) return { status: 503, error: { message: 'Tally ERP 9 is not active or configured', code: 'CONFIG' } };
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, entityId) });
  if (!customer) return { status: 404, error: { message: 'Customer not found', code: 'NOT_FOUND' } };
  const existing = await db.query.integrationSyncRecords.findFirst({
    where: and(
      eq(integrationSyncRecords.provider, 'tallyerp9'),
      eq(integrationSyncRecords.entityType, entityType),
      eq(integrationSyncRecords.entityId, entityId),
    ),
  });
  if (existing?.status === 'SYNCED') {
    return { status: 409, error: { message: 'Customer is already mapped to Tally ERP 9', code: 'ALREADY_SYNCED' } };
  }
  if (existing?.status === 'PROCESSING') {
    return { status: 409, error: { message: 'Customer sync is already being processed', code: 'SYNC_IN_PROGRESS' } };
  }
  const ledgerName = `${customer.name.trim()} [${customer.customerNo}]`;
  const xml = buildPartyLedgerXml(config, customer);
  const mapping = await db.query.integrationEntityMappings.findFirst({
    where: and(
      eq(integrationEntityMappings.provider, 'tallyerp9'),
      eq(integrationEntityMappings.entityType, 'customer'),
      eq(integrationEntityMappings.localId, customer.id),
    ),
  });
  if (mapping) return { status: 409, error: { message: 'Customer already has a Tally master mapping', code: 'ALREADY_MAPPED' } };
  let queuedId: string | undefined;
  const requestPayload = { xml, companyName: config.companyName, externalId: ledgerName };
  if (existing) {
    const [queued] = await db.update(integrationSyncRecords).set({
      status: 'PENDING',
      attemptCount: 0,
      lastError: null,
      requestPayload,
      responsePayload: {},
      updatedAt: new Date(),
    }).where(and(
      eq(integrationSyncRecords.id, existing.id),
      inArray(integrationSyncRecords.status, ['FAILED', 'REJECTED']),
    )).returning({ id: integrationSyncRecords.id });
    queuedId = queued?.id;
  } else {
    const [queued] = await db.insert(integrationSyncRecords).values({
      provider: 'tallyerp9',
      direction: 'CRM_TO_TALLY',
      entityType,
      entityId,
      status: 'PENDING',
      attemptCount: 0,
      requestPayload,
    }).onConflictDoNothing().returning({ id: integrationSyncRecords.id });
    queuedId = queued?.id;
  }
  if (!queuedId) {
    throw new ApiError(409, 'Customer sync was queued concurrently; refresh the sync status before retrying.', 'SYNC_CONFLICT');
  }
  return { ok: true, queued: true, syncId: queuedId, message: 'Customer ledger queued; the Windows agent will process it.' };
});
