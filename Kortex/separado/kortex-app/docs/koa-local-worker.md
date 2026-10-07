# Koa Local Worker

Este documento descreve o MVP em que o Kortex fica online, o Supabase fica online e o Koa Worker roda localmente na maquina do setor de Relacionamento.

## Arquitetura

Fluxo operacional:

1. Usuario acessa o Kortex online.
2. Chat Koa cria uma operacao em `automation_operations`.
3. Supabase persiste a fila e emite eventos Realtime.
4. Worker local, usando service role apenas no processo Node, faz claim da operacao.
5. Playwright executa o portal em browser dedicado do Koa.
6. Worker valida o PDF, envia para Supabase Storage privado e atualiza a operacao.
7. Frontend recebe status pelo Supabase Realtime e gera URL assinada para baixar o artifact.

Usuarios remotos nunca acessam `localhost`, Playwright, Chrome ou IP da maquina do worker.

## Variaveis do worker

Crie `automation-server/.env.local` somente na maquina do Relacionamento:

```env
NODE_ENV=production
AUTOMATION_MODE=local-worker
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ARTIFACT_BUCKET=koa-artifacts

KOA_WORKER_ID=koa-relacionamento-01
WORKER_POLL_INTERVAL_MS=3000
WORKER_HEARTBEAT_INTERVAL_MS=25000
WORKER_LEASE_SECONDS=60

SECRET_PROVIDER=dpapi
BROWSER_PROVIDER=headless-local
KOA_BROWSER_MODE=background
KOA_BROWSER_DEBUG=false
HEADLESS=true

KOA_CARD_ISSUE_ENABLED=true
KOA_CARD_ISSUE_BATCH_ENABLED=false
KOA_INCLUSION_ENABLED=false
KOA_EXCLUSION_ENABLED=false

HAPVIDA_CARD_PORTAL_URL=https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form
HAPVIDA_AUTHENTICATED_SELECTOR=
```

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY`, senhas, cookies ou storageState em variaveis `VITE_*`.

## Preparar sessao Hapvida

Use o perfil dedicado do Koa. Ele nao deve apontar para o perfil normal do Chrome.

```powershell
cd automation-server
npm run browser:onboard
```

O operador pode fazer login manualmente e resolver MFA/CAPTCHA. O worker nao deve capturar senha, token, cookie ou senha do Google Password Manager.

Depois valide:

```powershell
npm run browser:check
```

Resultado esperado: sessao valida. Se retornar `SESSION_NOT_FOUND` ou `REAUTH_REQUIRED`, renovar a sessao com onboarding.

## Iniciar worker

Primeiro modo de teste:

```powershell
cd automation-server
npm run dev
```

Producao local:

```powershell
npm run build
npm run start
```

O worker registra heartbeat em `automation_workers` com `KOA_WORKER_ID`. Se a maquina estiver offline, operacoes continuam `queued` no Supabase ate o worker voltar.

## Cancelamento remoto

O frontend chama `request_koa_operation_cancel`.

O banco marca:

- `cancel_requested_at`
- `status = cancelling`

O worker observa a operacao durante a execucao, aborta o workflow com `AbortController` e so entao confirma `cancelled`.

## Artifacts

PDFs e prints devem ser enviados para o bucket privado `koa-artifacts`.

Padrao:

```text
operations/<workspaceId>/<operationId>/<arquivo>
```

O frontend usa URL assinada temporaria. Nao use `C:\...`, `file://` ou URL `localhost` como artifact remoto.

## Diagnostico rapido

Verifique:

- `automation_workers.last_heartbeat_at`
- `automation_operations.status`
- `automation_events`
- `automation_artifacts`
- logs locais do worker

Logs nunca devem conter:

- password/senha
- cookies
- tokens
- JWT
- service role
- storageState

## Escopo liberado

Neste MVP apenas `CARD_ISSUE` fica habilitado. Inclusao e exclusao devem continuar retornando `WORKFLOW_DISABLED` ate nova autorizacao.
