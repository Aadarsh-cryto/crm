import { withApi } from '@/lib/handlers';
import { requirePermission } from '@/lib/api';
import { testExternalErpConnection } from '@/lib/services/externalErp';

export const POST = withApi(async (actor) => {
  requirePermission(actor.user, 'integrations.manage');
  return testExternalErpConnection();
});
