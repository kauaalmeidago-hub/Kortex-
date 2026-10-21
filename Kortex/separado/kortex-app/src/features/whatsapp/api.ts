import { supabase } from '@/integrations/supabase/client';

export type WaScope = { workspaceId: string; sectorId: string };
export type WaConnection = { id: string | null; state: 'preparing' | 'qr' | 'connecting' | 'connected' | 'expired' | 'disconnected' | 'error'; qr?: string; qrExpiresAt?: string; emailPending?: boolean; syncState?: string; phone?: string; label?: string; role?: 'human' | 'sdr' };
export type WaPhase = 'triage' | 'active' | 'pending' | 'resolved';
export type WaCounts = Record<'all' | WaPhase, number>;
export type WaConversation = { id: string; connection_id: string; remote_jid: string; name: string; preview: string; last_message_at: string; unread_count: number; status: WaPhase;
  case_id?: string; case_version?: number; assigned_to?: string; claimed_by?: string; assignee_name?: string;
  can_claim?: boolean; can_manage?: boolean; can_send?: boolean; channel_state?: string; channel_label?: string; sector_name?: string;
  triage_state?: string; summary?: string; request_type?: string; pending_reason?: string; continuity_pending?: boolean; needs_review?: boolean };
export type WaDestination = { userId: string; name: string; sectorId: string; sector: string; channelId: string; channelOwner: string; connected: boolean; sortOrder?: number; role?: string };
export type WaMessage = { id: string; provider_id: string; body: string; kind: string; sent_at: string; from_me: boolean; status_rank: number; media_name?: string; media_mime?: string; quoted_id?: string; participant?: string | null };
export class WaError extends Error { constructor(public code: string, message: string) { super(message); } }
export async function waRequest<T>(action: string, options: { scope?: WaScope; body?: Record<string, unknown>; query?: Record<string, string>; signal?: AbortSignal; temporary?: boolean } = {}): Promise<T> {
  const { data } = options.temporary || action === 'signup' ? { data: { session: null } } : await supabase.auth.getSession();
  const params = new URLSearchParams({ action, ...options.scope, ...options.query });
  const response = await fetch(`/api/whatsapp?${params}`, { method: options.body ? 'POST' : 'GET', credentials: 'same-origin', signal: options.signal,
    headers: { ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify({ ...options.body, ...options.scope }) } : {}) });
  const result = await response.json().catch(() => {
    throw new WaError('BACKEND_UNAVAILABLE', 'Não foi possível acessar o serviço de conexão.');
  });
  if (!response.ok) throw new WaError(result.code, result.error);
  return result as T;
}
