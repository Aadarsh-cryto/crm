import { NextResponse, type NextRequest } from 'next/server';
import { authenticateTallyAgent, getNextTallySync } from '@/lib/services/tallyErp9';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await authenticateTallyAgent(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const record = await getNextTallySync();
  if (!record) return NextResponse.json({ job: null });
  const payload = record.requestPayload ?? {};
  const xml = typeof payload.xml === 'string' ? payload.xml : '';
  if (!xml) {
    return NextResponse.json({ error: 'Queued Tally task has no XML payload' }, { status: 500 });
  }
  return NextResponse.json({
    job: {
      id: record.id,
      entityType: record.entityType,
      entityId: record.entityId,
      companyName: payload.companyName ?? '',
      xml,
    },
  });
}
