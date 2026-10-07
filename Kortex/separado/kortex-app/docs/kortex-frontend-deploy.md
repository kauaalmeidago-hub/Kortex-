# Kortex Frontend Deploy

Este guia prepara o frontend do Kortex para operar online sem depender do automation-server local do usuario.

## Variaveis publicas

No provedor de deploy, configure apenas variaveis publicas:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_APP_ENV=production
VITE_AUTOMATION_PROVIDER=supabase
```

Nao configure em producao:

```env
VITE_AUTOMATION_API_URL=
VITE_AUTOMATION_API_TOKEN=
SUPABASE_SECRET_KEY=
PASSWORD=
SECRET_PROVIDER_KEY=
```

`127.0.0.1` no navegador remoto aponta para o computador do proprio usuario, nao para a maquina do Relacionamento.

## Supabase

Antes do deploy:

1. Aplicar migrations.
2. Confirmar bucket privado `koa-artifacts`.
3. Confirmar Realtime para `automation_operations` e `automation_events`.
4. Confirmar RLS de leitura por workspace.
5. Configurar Site URL e Redirect URLs do Supabase Auth para o dominio publicado.
6. Preservar URLs localhost para desenvolvimento, quando necessario.

## Build local

```powershell
npm run lint
npm run test
npm run build
```

O build deve funcionar sem `VITE_AUTOMATION_API_URL` em producao. O frontend cria operacoes por RPC Supabase e acompanha status por Realtime.

## SPA routing

Se usar Vercel, Netlify ou Cloudflare Pages, configure fallback para `index.html`, para que rotas como `/inbox`, `/tasks` e `/settings` funcionem apos refresh.

## Fluxo remoto esperado

1. Usuario remoto abre Kortex via HTTPS.
2. Usuario solicita carteirinha pelo Koa no inbox.
3. Frontend chama `create_koa_card_issue_operation`.
4. Operacao entra como `queued`.
5. Worker local `koa-relacionamento-01` faz claim pelo Supabase.
6. Worker executa Hapvida localmente, valida PDF e envia artifact ao Storage.
7. Operacao vira `success`.
8. Koa exibe mensagem final e botao para baixar a carteirinha por URL assinada.

## Worker offline

Se o worker estiver offline, o frontend deve manter a operacao em `queued` e mostrar que esta aguardando agente operacional. Nao deve mostrar erro falso.

Quando o worker voltar, ele registra heartbeat e pega a fila.

## Cancelamento

O botao de parar no Koa chama `request_koa_operation_cancel`.

O frontend nao assume sucesso do cancelamento. Ele aguarda:

- `cancelling`
- `cancelled`
- `success`
- `error`

## Checklist antes de publicar

- Nenhum `localhost` obrigatorio no build de producao.
- Nenhum service role no frontend.
- Nenhuma senha no payload do Koa.
- `CARD_ISSUE` habilitado.
- Inclusao e exclusao bloqueadas no backend.
- Supabase Realtime testado.
- Bucket privado com URL assinada.
- Worker com heartbeat visivel.
- Teste remoto feito em outro computador.
