import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { createTaskAiHandler, type Client } from "../_shared/task-ai-core.ts";
const key = (name: string, legacy: string) => {
  const values = JSON.parse(Deno.env.get(name) || "{}");
  return values.default || Deno.env.get(legacy) || "";
};
const url = Deno.env.get("SUPABASE_URL")!;
const publicKey = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const serverKey = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, serverKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function adapter(client: ReturnType<typeof createClient>): Client {
  return {
    rpc: async (name, args) => await client.rpc(name, args),
    read: async (table, columns, filters, limit = 501) => {
      let query = client.from(table).select(columns);
      for (const [k, v] of Object.entries(filters)) query = Array.isArray(v) ? query.in(k, v) : query.eq(k, v);
      const result = await query.limit(limit);
      if (result.error) throw new Error("SCOPED_READ_FAILED");
      return result.data ?? [];
    },
    download: async (bucket, path) => {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) throw new Error('SCOPED_DOWNLOAD_FAILED');
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
Deno.serve(
  createTaskAiHandler({
    admin: adapter(admin),
    fetch: globalThis.fetch.bind(globalThis),
    authenticate: async (token) => {
      const client = createClient(url, publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: "Bearer " + token } },
      });
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user || !data.user.email_confirmed_at) return null;
      return { id: data.user.id, client: adapter(client) };
    },
  }),
);
