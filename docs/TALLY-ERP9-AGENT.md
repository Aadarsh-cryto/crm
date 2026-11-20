# Tally.ERP 9 Windows agent

The CRM is cloud-hosted and cannot reach an office computer's `localhost`.
This agent makes outbound HTTPS requests to the CRM and connects to Tally only
at `127.0.0.1:9000`. Do not expose Tally's HTTP/XML port to the public internet.

## Requirements

- Node.js 22 on the Windows computer where Tally.ERP 9 is running.
- Tally.ERP 9's HTTP/XML listener enabled locally (default port 9000).
- A CRM deployment that includes the Tally agent API routes and database migration.
- The target company open/available in Tally and its exact name entered in CRM.

## Configure the CRM

1. Apply the additive migration `0011_tally_external_integration` using the
   deployment's normal database migration process.
2. Set `SETTINGS_ENCRYPTION_KEY` in the cloud deployment.
3. Generate a random secret locally (for example
   `node -p "require('node:crypto').randomBytes(32).toString('hex')"`), then
   save it under Settings -> Integration keys -> Tally ERP 9. The application
   encrypts it.
4. Enter the exact Tally company name. Keep the release field blank until it is
   confirmed from Tally's Help/About screen.
5. Redeploy the cloud app after the migration and code are available.

The agent token is shared only between the server-side CRM and the local
Windows agent. Never put it in a `NEXT_PUBLIC_*` variable or browser code.

## Configure the Windows agent

Set these Windows environment variables for the account that will run the
agent:

- `TALLY_CRM_URL=https://crm-indol-gamma-34.vercel.app`
- `TALLYERP9_AGENT_TOKEN` to the same secret saved in CRM settings
- `TALLY_HTTP_URL=http://127.0.0.1:9000`
- `TALLY_COMPANY` to the exact company name saved in CRM settings
- `TALLY_RELEASE` only after checking the actual Tally release

The CRM URL supplied for this setup is
`https://crm-indol-gamma-34.vercel.app`.

From the project checkout, start it with:

```powershell
npm run tally:agent
```

The process performs a read-only `List of Companies` XML probe once per minute,
sends a heartbeat, and polls the CRM for queued tasks. Tally company name must
match on both sides. The agent reports HTTP/XML summaries only; it does not log
the shared token or full voucher response.

## Current safeguards and scope

- Tally traffic from the agent is restricted to localhost.
- Agent API requests require the encrypted shared bearer token and use constant
  time comparison.
- The connection test is read-only.
- Customer ledger posting requires an explicit API confirmation and is queued
  for the agent.
- Sales/receipt vouchers, refunds, cancellations, GST, stock, and service item
  posting remain disabled until the ERP 9 release and accounting mappings are
  verified against the actual company.
- The CRM must be deployed and its migration applied before this agent can
  authenticate or process work.
