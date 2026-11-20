import { setTimeout as sleep } from 'node:timers/promises';

const crmUrl = process.env.TALLY_CRM_URL?.trim().replace(/\/$/, '');
const token = process.env.TALLYERP9_AGENT_TOKEN?.trim();
const tallyUrl = (process.env.TALLY_HTTP_URL?.trim() || 'http://127.0.0.1:9000').replace(/\/$/, '');
const companyName = process.env.TALLY_COMPANY?.trim();
const release = process.env.TALLY_RELEASE?.trim() || '';
const pollMs = Math.max(1000, Number(process.env.TALLY_AGENT_POLL_MS) || 5000);
const apiTimeoutMs = 15_000;

if (!crmUrl || !/^https:\/\//i.test(crmUrl)) {
  throw new Error('TALLY_CRM_URL must be the CRM public HTTPS URL');
}
if (!token || token.length < 32) {
  throw new Error('TALLYERP9_AGENT_TOKEN must be at least 32 characters');
}
if (!companyName) {
  throw new Error('TALLY_COMPANY must exactly match the target Tally ERP 9 company');
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(tallyUrl)) {
  throw new Error('TALLY_HTTP_URL must target localhost; do not expose Tally ERP 9 publicly');
}

const agentHeaders = {
  authorization: `Bearer ${token}`,
  accept: 'application/json',
};

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function postJson(path, data) {
  const response = await fetch(`${crmUrl}${path}`, {
    method: 'POST',
    headers: { ...agentHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(apiTimeoutMs),
  });
  if (!response.ok) throw new Error(`CRM ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function getJson(path) {
  const response = await fetch(`${crmUrl}${path}`, {
    method: 'GET',
    headers: agentHeaders,
    signal: AbortSignal.timeout(apiTimeoutMs),
  });
  if (!response.ok) throw new Error(`CRM ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function checkTally() {
  const probe = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>';
  const response = await fetch(tallyUrl, {
    method: 'POST',
    headers: { 'content-type': 'text/xml', accept: 'application/xml, text/xml' },
    body: probe,
    signal: AbortSignal.timeout(10_000),
  });
  const xml = await response.text();
  if (!response.ok || !/<ENVELOPE\b/i.test(xml) || /<LINEERROR\b/i.test(xml)) {
    return { connected: false, companyVerified: false };
  }
  const companies = [...xml.matchAll(/<COMPANY\b([^>]*?)(?:\/>|>([\s\S]*?)<\/COMPANY>)/gi)]
    .map((match) => {
      const nameAttribute = match[1].match(/\bNAME\s*=\s*["']([^"']*)["']/i)?.[1];
      const text = match[2]?.replace(/<[^>]+>/g, '').trim();
      return decodeXml(nameAttribute || text || '');
    });
  return {
    connected: true,
    companyVerified: companies.includes(companyName),
  };
}

async function sendHeartbeat(probe) {
  await postJson('/api/integrations/tallyerp9/agent/heartbeat', {
    tallyConnected: probe.connected && probe.companyVerified,
    release,
    companyName,
  });
}

async function processOneJob() {
  const { job } = await getJson('/api/integrations/tallyerp9/agent/next');
  if (!job) return;
  let responseXml = '';
  let httpStatus = 0;
  let transportError = '';

  if (job.companyName !== companyName) {
    httpStatus = 400;
    responseXml = '<RESPONSE><LINEERROR>Agent and CRM company configuration do not match</LINEERROR></RESPONSE>';
  } else {
    try {
      const response = await fetch(tallyUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/xml', accept: 'application/xml, text/xml' },
        body: job.xml,
        signal: AbortSignal.timeout(30_000),
      });
      httpStatus = response.status;
      responseXml = (await response.text()).slice(0, 100_000);
    } catch (error) {
      transportError = error instanceof Error ? error.message : String(error);
    }
  }

  await postJson('/api/integrations/tallyerp9/agent/complete', {
    jobId: job.id,
    httpStatus,
    responseXml,
    ...(transportError ? { transportError } : {}),
  });
}

console.log('Tally ERP 9 Windows agent starting; Tally stays bound to localhost.');
let lastProbeAt = 0;
let probe = { connected: false, companyVerified: false };

while (true) {
  try {
    if (Date.now() - lastProbeAt >= 60_000) {
      probe = await checkTally();
      lastProbeAt = Date.now();
      if (!probe.connected) console.error('Local Tally ERP 9 XML check failed.');
      else if (!probe.companyVerified) console.error('Configured TALLY_COMPANY was not found in the local Tally company export.');
    }
    await sendHeartbeat(probe);
    await processOneJob();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Agent request failed');
  }
  await sleep(pollMs);
}
