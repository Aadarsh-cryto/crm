'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, PageHeader, Badge } from '@/components/ui';
import { fetcher } from '@/lib/fetcher';

/**
 * Integration status reflects what the code actually does:
 *
 *  - Built    = a working outbound or inbound path exists in the app.
 *  - Configure= the code path is complete, but it needs operator-supplied
 *              credentials before it can send or receive anything.
 *
 * Nothing here claims a channel is live. Credentials are stored AES-256-GCM
 * encrypted under SETTINGS_ENCRYPTION_KEY and entered at /settings/keys.
 */
const INTEGRATIONS: Array<{
  name: string;
  status: 'Built' | 'Configure' | 'Not built';
  desc: string;
  detail: string;
}> = [
  {
    name: 'Meta (Facebook/Instagram) Ads',
    status: 'Configure',
    desc: 'Inbound lead ads via the Graph API, with signature verification.',
    detail:
      'POST /api/webhooks/meta/leads and /api/webhooks/leads. Verifies X-Hub-Signature-256 ' +
      'against the app secret, maps Meta form ids to lead sources so one webhook can feed ' +
      'several funnels, and resolves the buyer to a project. Credentials: page token, verify ' +
      'token, app secret, page id, Instagram account id.',
  },
  {
    name: 'WhatsApp Business (Cloud API)',
    status: 'Configure',
    desc: 'Outbound template messages through the WhatsApp Cloud API.',
    detail:
      'src/lib/whatsapp.ts pins Meta Graph v22.0 and sends approved templates over ' +
      'phone_number_id. Runs as a queued job with bounded retries, and every send is recorded ' +
      'in messageLogs. Needs an access token, phone number id, and an approved template name ' +
      'and language.',
  },
  {
    name: 'Email (Resend or SMTP)',
    status: 'Configure',
    desc: 'Outbound transactional email, two transports.',
    detail:
      'src/lib/resend.ts supports the Resend HTTP API and any SMTP mailbox via nodemailer ' +
      '(port 465 implicit TLS, port 587 STARTTLS). Picks whichever is configured. Leave unset ' +
      'and the app still works - notifications simply stay in-app.',
  },
  {
    name: 'Tally ERP 9',
    status: 'Configure',
    desc: 'Tally ERP 9 through a Windows agent that polls this cloud CRM.',
    detail:
      'The agent connects outbound over HTTPS and talks to Tally only on localhost. ' +
      'Connection checks are read-only; voucher posting requires explicit confirmation.',
  },
  {
    name: 'External ERP',
    status: 'Configure',
    desc: 'Authenticated HTTPS connector for a separately hosted ERP.',
    detail:
      'Uses the existing integration configuration and a generic approved API path. The separate ERP API contract and credentials are not assumed.',
  },
  {
    name: 'AI Lead Brief (Groq)',
    status: 'Configure',
    desc: 'Per-lead summary and intent score.',
    detail:
      'Server-side only, 30s timeout, on-demand per lead at /api/leads/[id]/ai. Optional: with ' +
      'no key the lead page shows a "not configured" state and everything else keeps working.',
  },
  {
    name: 'Slack',
    status: 'Not built',
    desc: 'Planned. No outbound team alerts are sent yet.',
    detail: '',
  },
];

const TONE: Record<string, 'green' | 'amber' | 'gray'> = {
  Built: 'green',
  Configure: 'amber',
  'Not built': 'gray',
};

export default function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Integrations"
        subtitle="External lead sources and notification channels"
      />
      <p className="mb-4 text-sm text-ink-muted">
        These channels are implemented, not hypothetical. Each one needs operator-supplied
        credentials before it sends or receives anything &mdash; enter them at{' '}
        <a href="/settings/keys" className="font-semibold text-primary-700 underline">
          Settings &rsaquo; API Keys
        </a>
        . Credentials are stored AES-256-GCM encrypted, never in plain text.
      </p>
      <div className="space-y-4">
        {INTEGRATIONS.map((i) => (
          <Card key={i.name}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-ink">{i.name}</h3>
                  <Badge tone={TONE[i.status]}>{i.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-muted">{i.desc}</p>
                {i.detail && <p className="mt-2 text-xs leading-relaxed text-ink-faint">{i.detail}</p>}
                {i.name === 'Tally ERP 9' && <TallyStatusPanel />}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

interface TallyStatus {
  active: boolean;
  configured: boolean;
  companyName: string | null;
  release: string | null;
}

interface TallyCheck {
  ok: boolean;
  detail: string;
}

function TallyStatusPanel() {
  const [status, setStatus] = useState<TallyStatus | null>(null);
  const [check, setCheck] = useState<TallyCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setStatus(await fetcher<TallyStatus>('/api/integrations/tallyerp9/status'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Tally status');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkConnection = async () => {
    setLoading(true);
    setError(null);
    try {
      setCheck(await fetcher<TallyCheck>('/api/integrations/tallyerp9/test', { method: 'POST', body: '{}' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check Tally connection');
    } finally {
      setLoading(false);
      await refresh();
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-black/10 bg-white/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-xs text-ink-muted">
          <p>
            CRM configuration: <strong>{status?.configured ? 'ready' : 'needs setup'}</strong>
            {status?.companyName ? ` · ${status.companyName}` : ''}
          </p>
          <p>
            Windows agent: <strong>{check?.ok ? 'connected' : 'not confirmed'}</strong>
            {status?.release ? ` · Tally release ${status.release}` : ''}
          </p>
          {check && <p className={check.ok ? 'mt-1 text-emerald-700' : 'mt-1 text-amber-700'}>{check.detail}</p>}
          {error && <p className="mt-1 text-rose-700" role="alert">{error}</p>}
        </div>
        <Button type="button" variant="secondary" loading={loading} onClick={() => void checkConnection()}>
          Check connection
        </Button>
      </div>
    </div>
  );
}
