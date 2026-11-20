import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { integrationEntityMappings, integrationSyncRecords } from '@/lib/db/schema';
import { authenticateTallyAgent, parseTallyImportResponse } from '@/lib/services/tallyErp9';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await authenticateTallyAgent(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const input = await req.json().catch(() => null) as {
    jobId?: unknown;
    httpStatus?: unknown;
    responseXml?: unknown;
    transportError?: unknown;
  } | null;
  if (!input || typeof input.jobId !== 'string' || typeof input.httpStatus !== 'number') {
    return NextResponse.json({ error: 'jobId and httpStatus are required' }, { status: 422 });
  }
  const [record] = await db.select().from(integrationSyncRecords).where(and(
    eq(integrationSyncRecords.id, input.jobId),
    eq(integrationSyncRecords.provider, 'tallyerp9'),
    eq(integrationSyncRecords.status, 'PROCESSING'),
  )).limit(1);
  if (!record) return NextResponse.json({ error: 'Active Tally sync task not found' }, { status: 404 });

  const responseXml = typeof input.responseXml === 'string' ? input.responseXml.slice(0, 100_000) : '';
  const parsed = parseTallyImportResponse(responseXml);
  const transportError = typeof input.transportError === 'string' ? input.transportError.slice(0, 500) : null;
  const transient = input.httpStatus === 0 || input.httpStatus >= 500;
  const succeeded = input.httpStatus >= 200 && input.httpStatus < 300 && parsed.success;
  const status = succeeded
    ? 'SYNCED'
    : transient && record.attemptCount < 5
      ? 'PENDING'
      : transient
        ? 'FAILED'
        : 'REJECTED';
  const error = transportError ?? parsed.lineError ?? (succeeded ? null : `Tally import response: HTTP ${input.httpStatus}, errors ${parsed.errors}`);
  const now = new Date();

  await db.update(integrationSyncRecords).set({
    status,
    lastError: error,
    responsePayload: {
      httpStatus: input.httpStatus,
      created: parsed.created,
      altered: parsed.altered,
      errors: parsed.errors,
      lineError: parsed.lineError,
      lastVoucherId: parsed.lastVoucherId,
    },
    externalGuid: parsed.lastVoucherId,
    syncedAt: succeeded ? now : null,
    updatedAt: now,
  }).where(eq(integrationSyncRecords.id, record.id));

  if (succeeded && record.entityType === 'customer') {
    const externalId = typeof record.requestPayload?.externalId === 'string' ? record.requestPayload.externalId : null;
    if (externalId) {
      await db.insert(integrationEntityMappings).values({
        provider: 'tallyerp9',
        entityType: 'customer',
        localId: record.entityId,
        externalId,
        externalGuid: parsed.lastVoucherId,
      }).onConflictDoUpdate({
        target: [integrationEntityMappings.provider, integrationEntityMappings.entityType, integrationEntityMappings.localId],
        set: { externalId, externalGuid: parsed.lastVoucherId, updatedAt: now, isActive: true },
      });
    }
  }

  return NextResponse.json({
    ok: succeeded,
    status,
    imported: parsed.created + parsed.altered,
    error: succeeded ? null : error,
  });
}
