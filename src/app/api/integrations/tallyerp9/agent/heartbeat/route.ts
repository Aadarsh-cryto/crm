import { NextResponse, type NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { integrationSyncRecords } from '@/lib/db/schema';
import { authenticateTallyAgent } from '@/lib/services/tallyErp9';
import { getTallyErp9Config } from '@/lib/services/tallyErp9';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await authenticateTallyAgent(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const input = await req.json().catch(() => null) as {
    tallyConnected?: unknown;
    release?: unknown;
    companyName?: unknown;
  } | null;
  if (!input || typeof input.tallyConnected !== 'boolean') {
    return NextResponse.json({ error: 'tallyConnected must be a boolean' }, { status: 422 });
  }
  const config = await getTallyErp9Config();
  const targetMatches = typeof input.companyName === 'string' &&
    input.companyName.trim() === config?.companyName;
  const tallyConnected = input.tallyConnected && targetMatches;
  const now = new Date();
  await db.insert(integrationSyncRecords).values({
    provider: 'tallyerp9',
    direction: 'TALLY_TO_CRM',
    entityType: 'agent',
    entityId: 'local-agent',
    status: tallyConnected ? 'SYNCED' : 'FAILED',
    attemptCount: 1,
    lastError: tallyConnected ? null : 'Local Tally XML or configured company check failed',
    requestPayload: {},
    responsePayload: {
      tallyConnected,
      release: typeof input.release === 'string' ? input.release.slice(0, 40) : '',
      companyName: typeof input.companyName === 'string' ? input.companyName.slice(0, 160) : '',
    },
    syncedAt: tallyConnected ? now : null,
  }).onConflictDoUpdate({
    target: [integrationSyncRecords.provider, integrationSyncRecords.entityType, integrationSyncRecords.entityId],
    set: {
      status: tallyConnected ? 'SYNCED' : 'FAILED',
      attemptCount: sql`${integrationSyncRecords.attemptCount} + 1`,
      lastError: tallyConnected ? null : 'Local Tally XML or configured company check failed',
      responsePayload: {
        tallyConnected,
        release: typeof input.release === 'string' ? input.release.slice(0, 40) : '',
        companyName: typeof input.companyName === 'string' ? input.companyName.slice(0, 160) : '',
      },
      syncedAt: tallyConnected ? now : null,
      updatedAt: now,
    },
  });
  return NextResponse.json({ ok: true, companyMatches: targetMatches });
}
