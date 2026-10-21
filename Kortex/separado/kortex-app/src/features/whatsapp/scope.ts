import type { BusinessContext } from '@/integrations/supabase/businessTypes';

export const whatsappContextId = (context: Pick<BusinessContext, 'workspace_id' | 'sector_id'>) =>
  `${context.workspace_id}:${context.sector_id}`;

/** Preferences only choose among grants returned by business_contexts. */
export function resolveWhatsAppContext(
  contexts: BusinessContext[],
  workspaceId?: string,
  preferred?: string,
  globalContexts: (BusinessContext | null)[] = [],
) {
  const options = contexts.filter((context, index, all) =>
    (!workspaceId || context.workspace_id === workspaceId) &&
    all.findIndex(other => whatsappContextId(other) === whatsappContextId(context)) === index,
  );
  const preference = options.find(context => whatsappContextId(context) === preferred);
  const globals = globalContexts.filter((context): context is BusinessContext => Boolean(context))
    .filter(context => contexts.some(grant => grant.board_id === context.board_id &&
      grant.workspace_id === context.workspace_id && grant.sector_id === context.sector_id))
    .filter(context => options.some(option => whatsappContextId(option) === whatsappContextId(context)));
  const globalIds = new Set(globals.map(whatsappContextId));
  const current = preference ?? (options.length === 1 ? options[0] :
    globalIds.size === 1 ? options.find(context => globalIds.has(whatsappContextId(context))) : null) ?? null;
  return { options, current };
}
