import { withApi } from '@/lib/handlers';
import { requirePermission } from '@/lib/api';
import { testTallyErp9Connection } from '@/lib/services/tallyErp9';

export const POST = withApi(async (actor) => {
  requirePermission(actor.user, 'integrations.manage');
  return testTallyErp9Connection();
});
