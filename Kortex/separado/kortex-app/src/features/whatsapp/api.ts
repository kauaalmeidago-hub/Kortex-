import { supabase } from '@/integrations/supabase/client';

export type WaScope = { workspaceId: string; sectorId: string };
export type WaConnection = { id: string | null; state: 'preparing' | 'qr' | 'connecting' | 'connected' | 'expired' | 'disconnected' | 'error'; qr?: string; qrExpiresAt?: string; emailPending?: boolean; syncState?: string; phone?: string };
export type WaConversation = { id: string; connection_id: string; remote_jid: string; name: string; preview: string; last_message_at: string; unread_count: number; status: 'active' | 'pending' | 'resolved' };
export type WaMessage = { id: string; provider_id: string; body: string; kind: string; sent_at: string; from_me: boolean; status_rank: number; media_name?: string; media_mime?: string; quoted_id?: string };
export class WaError extends Error { constructor(public code: string, message: string) { super(message); } }
export async function waRequest<T>(action: string, options: { scope?: WaScope; body?: Record<string, unknown>; query?: Record<string, string>; signal?: AbortSignal; temporary?: boolean } = {}): Promise<T> {
  const { data } = options.temporary || action === 'signup' ? { data: { session: null } } : await supabase.auth.getSession();
  const params = new URLSearchParams({ action, ...options.scope, ...options.query });
  const response = await fetch(`/api/whatsapp?${params}`, { method: options.body ? 'POST' : 'GET', credentials: 'same-origin', signal: options.signal,
    headers: { ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify({ ...options.body, ...options.scope }) } : {}) });
  const result = await response.json().catch(() => ({ code: 'BACKEND_UNAVAILABLE', error: 'Não foi possível acessar o serviço de conexão.' }));
  if (!response.ok) throw new WaError(result.code, result.error);
  return result as T;
}
