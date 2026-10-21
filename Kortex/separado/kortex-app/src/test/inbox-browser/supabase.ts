// The production client must never be initialized in this isolated UI test.
export const supabase = new Proxy({}, {
  get(_target, property) {
    throw new Error(`Acesso externo proibido no teste isolado: Supabase.${String(property)}`);
  },
});
