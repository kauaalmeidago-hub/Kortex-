// Isolated visual acceptance server; uses test-only data and transport aliases.
// No connection to Supabase, Evolution or external recipients.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'src/test/inbox-browser');
const server = await createServer({
  configFile: false, root, envFile: false, mode: 'production', plugins: [react()],
  css: { postcss: root }, optimizeDeps: { entries: [path.join(fixture, 'main.tsx')] },
  resolve: { alias: [
    ...['@/features/whatsapp/useInbox', '@/contexts/AuthContext', '@/features/whatsapp/api', '@/features/auth/localBypass', '@/features/access/environment'].map(find => ({ find, replacement: path.join(fixture, 'fixture.tsx') })),
    { find: '@/integrations/supabase/client', replacement: path.join(fixture, 'supabase.ts') }, { find: '@', replacement: path.join(root, 'src') },
  ], dedupe: ['react', 'react-dom', '@tanstack/react-query'] },
  server: { host: '127.0.0.1', port: 5189, strictPort: true, hmr: false, watch: { ignored: ['**/tmp/**', '**/outputs/**', '**/automation-server/**'] } },
});
await server.listen();
console.log('Isolated inbox acceptance page: http://127.0.0.1:5189/src/test/inbox-browser/index.html');
