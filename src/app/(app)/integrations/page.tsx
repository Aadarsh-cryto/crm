'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, PageHeader, Badge, Dialog, Field, Input, Spinner } from '@/components/ui';
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
        credentials before it sends or receives anything. Configure Tally below; enter other
        provider credentials at{' '}
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
                  {i.name !== 'Tally ERP 9' && <Badge tone={TONE[i.status]}>{i.status}</Badge>}
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
  connection: TallyCheck;
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
  const [configureOpen, setConfigureOpen] = useState(false);

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
    setCheck(null);
    try {
      setCheck(await fetcher<TallyCheck>('/api/integrations/tallyerp9/test', { method: 'POST', body: '{}' }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check Tally connection');
    } finally {
      setLoading(false);
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
            Windows agent: <strong>{(check ?? status?.connection)?.ok ? 'connected' : 'not confirmed'}</strong>
            {status?.release ? ` · Tally release ${status.release}` : ''}
          </p>
          {(check ?? status?.connection) && (
            <p className={(check ?? status?.connection)?.ok ? 'mt-1 text-emerald-700' : 'mt-1 text-amber-700'}>
              {(check ?? status?.connection)?.detail}
            </p>
          )}
          {error && <p className="mt-1 text-rose-700" role="alert">{error}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfigureOpen(true)}>
            Configure
          </Button>
          <Button type="button" variant="secondary" loading={loading} onClick={() => void checkConnection()}>
            Check connection
          </Button>
        </div>
      </div>
      <TallyConfigurationDialog
        open={configureOpen}
        onClose={() => setConfigureOpen(false)}
        onSaved={async () => {
          setCheck(null);
          await refresh();
        }}
      />
    </div>
  );
}

interface TallySettingsResponse {
  encryptionConfigured: boolean;
  items: Array<{
    provider: string;
    plain: Record<string, string | null>;
    secrets: Array<{ key: string; hasStoredKey: boolean }>;
  }>;
}

function TallyConfigurationDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [encryptionConfigured, setEncryptionConfigured] = useState(false);
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [crmUrl, setCrmUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [release, setRelease] = useState('');
  const [agentToken, setAgentToken] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSaved(false);
    setEncryptionConfigured(false);
    setHasStoredToken(false);
    setCompanyName('');
    setRelease('');
    setAgentToken('');
    setCrmUrl(window.location.origin);
    fetcher<TallySettingsResponse>('/api/settings/keys')
      .then((response) => {
        const tally = response.items.find((item) => item.provider === 'tallyerp9');
        if (!tally) throw new Error('Tally ERP 9 settings were not returned by the server');
        if (!active) return;
        setEncryptionConfigured(response.encryptionConfigured);
        setHasStoredToken(Boolean(tally.secrets.find((secret) => secret.key === 'agentToken')?.hasStoredKey));
        setCompanyName(tally.plain.companyName ?? '');
        setRelease(tally.plain.release ?? '');
        setAgentToken('');
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load Tally configuration');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!companyName.trim()) {
      setError('Tally company name is required');
      return;
    }
    if (!hasStoredToken && agentToken.trim().length < 32) {
      setError('Enter an agent token of at least 32 characters');
      return;
    }
    if (agentToken.trim() && agentToken.trim().length < 32) {
      setError('A replacement agent token must be at least 32 characters');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, string> = {
        provider: 'tallyerp9',
        companyName: companyName.trim(),
        release: release.trim(),
      };
      if (agentToken.trim()) body.agentToken = agentToken.trim();
      await fetcher('/api/settings/keys', { method: 'PUT', body: JSON.stringify(body) });
      setAgentToken('');
      setHasStoredToken(true);
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Tally configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Configure Tally ERP 9"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="submit" form="tally-erp9-config-form" loading={saving} disabled={loading || !encryptionConfigured}>
            Save configuration
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <form id="tally-erp9-config-form" onSubmit={(event) => void submit(event)} className="space-y-4">
          <Field label="Cloud CRM URL" hint="Set this as TALLY_CRM_URL for the Windows agent.">
            <Input value={crmUrl} readOnly aria-readonly="true" className="font-mono" />
          </Field>
          <Field label="Tally company name" hint="Must exactly match the company name shown by Tally ERP 9.">
            <Input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required autoComplete="organization" />
          </Field>
          <Field label="Tally ERP 9 release" hint="Optional; enter only after confirming it in Tally Help > About.">
            <Input value={release} onChange={(event) => setRelease(event.target.value)} maxLength={40} />
          </Field>
          <Field
            label="Windows agent token"
            hint={hasStoredToken
              ? 'Saved securely and hidden. Leave blank to keep it, or enter a new 32+ character token to rotate it.'
              : 'Use a random token of at least 32 characters. Copy it for the Windows agent before saving; the CRM will not show it again.'}
          >
            <Input
              type="password"
              value={agentToken}
              onChange={(event) => setAgentToken(event.target.value)}
              placeholder={hasStoredToken ? 'Saved — hidden' : 'Enter a new token'}
              autoComplete="new-password"
              spellCheck={false}
              className="font-mono"
              required={!hasStoredToken}
            />
          </Field>
          <div className="rounded-xl bg-surface px-3 py-2 text-xs text-ink-muted">
            <p><strong>Windows agent settings</strong></p>
            <p className="mt-1">TALLY_CRM_URL: <code>{crmUrl}</code></p>
            <p className="mt-1">TALLY_HTTP_URL: <code>http://127.0.0.1:9000</code> (localhost only)</p>
            <p>TALLY_COMPANY: the exact company name above</p>
            <p>TALLY_AGENT_POLL_MS: 5000 by default</p>
            <p className="mt-1">Never expose Tally&apos;s HTTP/XML port to the public internet.</p>
          </div>
          {!encryptionConfigured && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
              Secret storage is unavailable. The administrator must configure SETTINGS_ENCRYPTION_KEY before saving.
            </p>
          )}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
          {saved && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">Configuration saved. The token is hidden; set TALLYERP9_AGENT_TOKEN on the Windows agent to the same value.</p>}
        </form>
      )}
    </Dialog>
  );
}
