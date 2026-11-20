import { timingSafeEqual } from 'node:crypto';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { integrations, integrationSyncRecords } from '@/lib/db/schema';
import { decryptSecret, looksEncrypted } from '@/lib/secrets';
import type { Customer, Booking, Payment } from '@/lib/db/schema';

export interface TallyErp9Config {
  agentToken: string | null;
  companyName: string;
  release: string;
  salesLedger: string;
  receiptLedger: string;
  creditLedger: string;
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function xmlEnvelope(requestType: 'Import' | 'Export', reportName: string, companyName: string, body: string): string {
  const company = companyName
    ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`
    : '';
  if (requestType === 'Export') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${escapeXml(reportName)}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>${company}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC>${body}</BODY>
</ENVELOPE>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>${escapeXml(reportName)}</REPORTNAME><STATICVARIABLES>${company}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>${body}</REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`;
}

export async function getTallyErp9Config(): Promise<TallyErp9Config | null> {
  const row = await db.query.integrations.findFirst({ where: eq(integrations.provider, 'tallyerp9') });
  if (!row?.isActive) return null;
  const config = (row.config ?? {}) as Record<string, unknown>;
  let agentToken: string | null = null;
  const storedToken = config.agentToken ?? config.relaySecret;
  if (typeof storedToken === 'string' && looksEncrypted(storedToken)) {
    agentToken = decryptSecret(storedToken);
  } else if (typeof storedToken === 'string') {
    agentToken = storedToken;
  } else if (process.env.TALLYERP9_AGENT_TOKEN?.trim()) {
    agentToken = process.env.TALLYERP9_AGENT_TOKEN.trim();
  }
  return {
    agentToken,
    companyName: typeof config.companyName === 'string' ? config.companyName.trim() : '',
    release: typeof config.release === 'string' ? config.release.trim() : '',
    salesLedger: typeof config.salesLedger === 'string' ? config.salesLedger.trim() : 'Sales',
    receiptLedger: typeof config.receiptLedger === 'string' ? config.receiptLedger.trim() : '',
    creditLedger: typeof config.creditLedger === 'string' ? config.creditLedger.trim() : 'Sales Returns',
  };
}

export async function testTallyErp9Connection(): Promise<{ ok: boolean; detail: string }> {
  const config = await getTallyErp9Config();
  if (!config) return { ok: false, detail: 'Tally ERP 9 is not active or configured' };
  if (!config.companyName) return { ok: false, detail: 'Tally ERP 9 company name is required' };
  if (!config.agentToken) return { ok: false, detail: 'Windows agent token is not configured' };
  const row = await db.query.integrationSyncRecords.findFirst({
    where: and(eq(integrationSyncRecords.provider, 'tallyerp9'), eq(integrationSyncRecords.entityType, 'agent')),
  });
  if (!row || row.status !== 'SYNCED' || Date.now() - row.updatedAt.getTime() > 120_000) {
    return { ok: false, detail: 'Windows agent is offline or has not confirmed the Tally connection recently' };
  }
  const response = row.responsePayload ?? {};
  const tallyOk = response.tallyConnected === true;
  return {
    ok: tallyOk,
    detail: tallyOk
      ? `Windows agent connected to Tally ERP 9${typeof response.release === 'string' ? ` (${response.release})` : ''}`
      : 'Windows agent is online but its last read-only Tally XML check failed',
  };
}

export async function authenticateTallyAgent(request: Request): Promise<boolean> {
  const config = await getTallyErp9Config();
  if (!config?.agentToken) return false;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expectedBytes = Buffer.from(config.agentToken);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function parseTallyImportResponse(xml: string): {
  success: boolean;
  created: number;
  altered: number;
  errors: number;
  lineError: string | null;
  lastVoucherId: string | null;
} {
  const tag = (name: string): string | null => {
    const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    return match?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
  };
  const lineError = tag('LINEERROR');
  const created = Number(tag('CREATED') ?? 0);
  const altered = Number(tag('ALTERED') ?? 0);
  const errors = Number(tag('ERRORS') ?? 0);
  const lastVoucherId = tag('LASTVCHID');
  return {
    success: !lineError && errors === 0 && created + altered > 0,
    created: Number.isFinite(created) ? created : 0,
    altered: Number.isFinite(altered) ? altered : 0,
    errors: Number.isFinite(errors) ? errors : 0,
    lineError,
    lastVoucherId,
  };
}

export async function getNextTallySync(): Promise<typeof integrationSyncRecords.$inferSelect | null> {
  return db.transaction(async (tx) => {
    const leaseExpiredBefore = new Date(Date.now() - 5 * 60_000);
    const [record] = await tx
      .select()
      .from(integrationSyncRecords)
      .where(and(
        eq(integrationSyncRecords.provider, 'tallyerp9'),
        or(
          eq(integrationSyncRecords.status, 'PENDING'),
          and(
            eq(integrationSyncRecords.status, 'PROCESSING'),
            lt(integrationSyncRecords.updatedAt, leaseExpiredBefore),
          ),
        ),
      ))
      .orderBy(asc(integrationSyncRecords.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!record) return null;
    const [claimed] = await tx
      .update(integrationSyncRecords)
      .set({
        status: 'PROCESSING',
        attemptCount: sql`${integrationSyncRecords.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(integrationSyncRecords.id, record.id))
      .returning();
    return claimed ?? null;
  });
}

export function buildPartyLedgerXml(config: TallyErp9Config, customer: Customer): string {
  const ledgerName = `${customer.name.trim()} [${customer.customerNo}]`;
  const body = `<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <LEDGER NAME="${escapeXml(ledgerName)}" ACTION="Create">
    <NAME>${escapeXml(ledgerName)}</NAME>
    <PARENT>Debtors</PARENT>
    ${customer.address ? `<ADDRESS>${escapeXml(customer.address)}</ADDRESS>` : ''}
    ${customer.city ? `<LEDGERCONTACT>${escapeXml(customer.city)}</LEDGERCONTACT>` : ''}
    ${customer.state ? `<LEDGERSTATENAME>${escapeXml(customer.state)}</LEDGERSTATENAME>` : ''}
    ${customer.pincode ? `<PINCODE>${escapeXml(customer.pincode)}</PINCODE>` : ''}
  </LEDGER>
</TALLYMESSAGE>`;
  return xmlEnvelope('Import', 'All Masters', config.companyName, body);
}

export function buildReceiptVoucherXml(config: TallyErp9Config, payment: Payment, customerName: string): string {
  const partyName = `${customerName} [${payment.customerId ?? ''}]`;
  const body = `<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <VOUCHER VCHTYPE="Receipt" ACTION="Create">
    <DATE>${escapeXml(new Date(payment.paymentDate).toISOString().slice(0, 10).replace(/-/g, ''))}</DATE>
    <VOUCHERNUMBER>${escapeXml(payment.id)}</VOUCHERNUMBER>
    <NARRATION>${escapeXml(payment.reference ?? `CRM receipt ${payment.receiptNo ?? payment.id}`)}</NARRATION>
    <PARTYLEDGERNAME>${escapeXml(partyName)}</PARTYLEDGERNAME>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${escapeXml(payment.amount)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(config.receiptLedger || 'Bank')}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-${escapeXml(payment.amount)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>
</TALLYMESSAGE>`;
  return xmlEnvelope('Import', 'Vouchers', config.companyName, body);
}

export function buildSalesVoucherXml(config: TallyErp9Config, booking: Booking, customerName: string): string {
  const partyName = `${customerName} [${booking.customerId}]`;
  const body = `<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <VOUCHER VCHTYPE="Sales" ACTION="Create">
    <DATE>${escapeXml(new Date(booking.bookingDate).toISOString().slice(0, 10).replace(/-/g, ''))}</DATE>
    <VOUCHERNUMBER>${escapeXml(booking.bookingNo)}</VOUCHERNUMBER>
    <NARRATION>${escapeXml(booking.notes ?? `CRM booking ${booking.bookingNo}`)}</NARRATION>
    <PARTYLEDGERNAME>${escapeXml(partyName)}</PARTYLEDGERNAME>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${escapeXml(booking.saleValue)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXml(config.salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-${escapeXml(booking.saleValue)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>
</TALLYMESSAGE>`;
  return xmlEnvelope('Import', 'Vouchers', config.companyName, body);
}

export async function recordSyncResult(
  provider: string,
  direction: string,
  entityType: string,
  entityId: string,
  result: { status: 'SYNCED' | 'FAILED' | 'REJECTED'; externalId?: string; externalGuid?: string; voucherType?: string; error?: string; request?: Record<string, unknown>; response?: Record<string, unknown> },
): Promise<void> {
  await db.insert(integrationSyncRecords).values({
    provider,
    direction,
    entityType,
    entityId,
    externalId: result.externalId ?? null,
    externalGuid: result.externalGuid ?? null,
    voucherType: result.voucherType ?? null,
    status: result.status,
    attemptCount: 1,
    lastError: result.error ?? null,
    requestPayload: result.request ?? {},
    responsePayload: result.response ?? {},
    syncedAt: result.status === 'SYNCED' ? new Date() : null,
  }).onConflictDoUpdate({
    target: [integrationSyncRecords.provider, integrationSyncRecords.entityType, integrationSyncRecords.entityId],
    set: {
      status: result.status,
      externalId: result.externalId ?? null,
      externalGuid: result.externalGuid ?? null,
      voucherType: result.voucherType ?? null,
      attemptCount: sql`${integrationSyncRecords.attemptCount} + 1`,
      lastError: result.error ?? null,
      requestPayload: result.request ?? {},
      responsePayload: result.response ?? {},
      syncedAt: result.status === 'SYNCED' ? new Date() : null,
      updatedAt: new Date(),
    },
  });
}

