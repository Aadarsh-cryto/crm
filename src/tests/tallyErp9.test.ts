import { beforeEach, describe, expect, it, vi } from 'vitest';

const tallyDb = vi.hoisted(() => ({
  query: {
    integrations: { findFirst: vi.fn() },
    integrationSyncRecords: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: tallyDb }));

import {
  buildPartyLedgerXml,
  buildReceiptVoucherXml,
  buildSalesVoucherXml,
  parseTallyImportResponse,
  testTallyErp9Connection,
  throwTallyStorageError,
  xmlEnvelope,
} from '@/lib/services/tallyErp9';

describe('Tally ERP 9 XML helpers', () => {
  it('builds an ERP 9 envelope and escapes XML-sensitive text', () => {
    const xml = xmlEnvelope('Import', 'All Masters', 'A & B', '<TALLYMESSAGE><LEDGER NAME="X &amp; Y"/></TALLYMESSAGE>');
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<SVCURRENTCOMPANY>A &amp; B</SVCURRENTCOMPANY>');
  });

  describe('Tally ERP 9 connection status', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('confirms only a recent successful Windows-agent heartbeat', async () => {
      tallyDb.query.integrations.findFirst.mockResolvedValue({
        isActive: true,
        config: { agentToken: 'x'.repeat(32), companyName: 'Tech Shilpi' },
      });
      tallyDb.query.integrationSyncRecords.findFirst.mockResolvedValue({
        status: 'SYNCED',
        updatedAt: new Date(),
        responsePayload: { tallyConnected: true, release: '6.6' },
      });

      await expect(testTallyErp9Connection()).resolves.toEqual({
        ok: true,
        detail: 'Windows agent connected to Tally ERP 9 (6.6)',
      });
    });

    it('does not report an offline or stale agent as connected', async () => {
      tallyDb.query.integrations.findFirst.mockResolvedValue({
        isActive: true,
        config: { agentToken: 'x'.repeat(32), companyName: 'Tech Shilpi' },
      });
      tallyDb.query.integrationSyncRecords.findFirst.mockResolvedValue({
        status: 'SYNCED',
        updatedAt: new Date(Date.now() - 121_000),
        responsePayload: { tallyConnected: true },
      });

      await expect(testTallyErp9Connection()).resolves.toMatchObject({ ok: false });
    });

    it('surfaces a missing integration migration and does not mask unrelated database errors', () => {
      expect(() => throwTallyStorageError({ code: '42P01' })).toThrow(
        'Apply migration 0011_tally_external_integration',
      );
      expect(() => throwTallyStorageError(new Error('database unavailable'))).toThrow(
        'database unavailable',
      );
    });
  });

  it('builds party ledger XML from CRM customer fields', () => {
    const config = {
      agentToken: 'test-only-token',
      companyName: 'Test Company',
      release: '6.6',
      salesLedger: 'Sales',
      receiptLedger: 'Bank',
      creditLedger: 'Sales Returns',
    };
    const xml = buildPartyLedgerXml(config, {
      id: 'customer-1',
      customerNo: 'CU-1',
      leadId: null,
      name: 'A & Sons',
      phone: null,
      whatsapp: null,
      email: null,
      pan: null,
      aadhaar: null,
      address: '1 < Main Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      ownerId: null,
      tags: [],
      notes: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(xml).toContain('A &amp; Sons [CU-1]');
    expect(xml).toContain('1 &lt; Main Road');
  });

  it('builds sales and receipt voucher XML with ERP 9 envelope tags', () => {
    const config = {
      agentToken: 'test-only-token',
      companyName: 'Test Company',
      release: '6.6',
      salesLedger: 'Sales',
      receiptLedger: 'Bank',
      creditLedger: 'Sales Returns',
    };
    const booking = {
      id: 'booking-1',
      bookingNo: 'BK-0001',
      customerId: 'customer-1',
      leadId: null,
      projectId: null,
      towerId: null,
      unitId: null,
      saleValue: '100000.00',
      bookingAmount: '10000.00',
      paymentDetails: {},
      salespersonId: null,
      teamLeaderId: null,
      brokerId: null,
      brokerName: null,
      bookingDate: new Date('2026-11-20T00:00:00Z'),
      status: 'CONFIRMED',
      cancellationId: null,
      notes: null,
      meta: {},
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const payment = {
      id: 'payment-1',
      bookingId: 'booking-1',
      customerId: 'customer-1',
      amount: '10000.00',
      paymentDate: new Date('2026-11-20T00:00:00Z'),
      method: 'BANK_TRANSFER',
      reference: 'UTR-1',
      status: 'RECEIVED',
      receiptNo: 'RCPT-1',
      receiptIssuedAt: new Date(),
      receiptVoidedAt: null,
      receiptVoidReason: null,
      notes: null,
      receivedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(buildSalesVoucherXml(config, booking, 'A & Sons')).toContain('<VOUCHER VCHTYPE="Sales"');
    expect(buildReceiptVoucherXml(config, payment, 'A & Sons')).toContain('<VOUCHER VCHTYPE="Receipt"');
  });

  it('marks an import successful only when ERP 9 reports an imported or altered master/voucher', () => {
    expect(parseTallyImportResponse('<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></RESPONSE>')).toMatchObject({
      success: true,
      created: 1,
      errors: 0,
    });
    expect(parseTallyImportResponse('<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Unknown ledger</LINEERROR></RESPONSE>')).toMatchObject({
      success: false,
      errors: 1,
      lineError: 'Unknown ledger',
    });
    expect(parseTallyImportResponse('<RESPONSE><CREATED>0</CREATED><ERRORS>0</ERRORS></RESPONSE>').success).toBe(false);
  });
});
