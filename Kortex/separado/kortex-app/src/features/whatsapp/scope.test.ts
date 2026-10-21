import { describe, expect, it } from 'vitest';
import type { BusinessContext } from '@/integrations/supabase/businessTypes';
import { resolveWhatsAppContext } from './scope';

const context = (sector: string, workspace = 'org', board = sector) => ({
  board_id: board, workspace_id: workspace, sector_id: sector,
} as BusinessContext);

describe('WhatsApp context from authorized grants', () => {
  it('uses one authorized sector even when multiple boards refer to it', () => {
    const a = context('sales');
    expect(resolveWhatsAppContext([a, context('sales', 'org', 'pipeline')]).current).toBe(a);
  });
  it('does not silently choose the first of multiple sectors', () => {
    expect(resolveWhatsAppContext([context('sales'), context('support')]).current).toBeNull();
  });
  it('respects the globally selected workspace and never falls into another one', () => {
    expect(resolveWhatsAppContext([context('sales'), context('support', 'other')], 'other').current?.workspace_id).toBe('other');
    expect(resolveWhatsAppContext([context('sales')], 'missing').current).toBeNull();
  });
  it('reuses a global board only while its full grant remains valid', () => {
    const sales = context('sales'); const support = context('support');
    expect(resolveWhatsAppContext([sales, support], 'org', '', [support]).current).toBe(support);
    expect(resolveWhatsAppContext([sales, support], 'org', '', [context('support', 'org', 'unknown')]).current).toBeNull();
  });
  it('does not guess when global boards select different sectors', () => {
    const grants = [context('sales'), context('support')];
    expect(resolveWhatsAppContext(grants, 'org', '', grants).current).toBeNull();
  });
  it('validates a settings preference instead of accepting it as authorization', () => {
    const grants = [context('sales'), context('support')];
    expect(resolveWhatsAppContext(grants, 'org', 'org:support').current).toBe(grants[1]);
    expect(resolveWhatsAppContext(grants, 'org', 'org:forged').current).toBeNull();
    expect(resolveWhatsAppContext(grants, 'other', 'org:support').current).toBeNull();
  });
});
