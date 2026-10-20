# WhatsApp local com portal HTTPS

## Homologação publicada em 20/10/2026

- Portal: [conectar WhatsApp](https://kortex-usuarios-git-codex-wh-9dffcd-kauaalmeidago-hubs-projects.vercel.app/settings/channels/whatsapp). O preview mantém a autenticação Vercel e usa exclusivamente o Supabase staging.
- Deployment `dpl_BuwdS1HHn7HSAMWuThxxq8nRrYPM`, estado `READY`, fonte `20b3a67ef7fda4c47afcd72188644fb161d385a3`.
- Webhook: `https://ukahtcymdcjphvptjamz.supabase.co/functions/v1/whatsapp-events`, função ativa versão 2. A configuração privada do preview e o hash no banco estão definidos. Respostas reais: `405` para GET, `401` sem credencial e `404 INSTANCE_UNKNOWN` para credencial válida com instância de teste inexistente. Nenhum evento de uma conversa real foi inserido por esses testes.
- A página de login do preview respondeu `200`. A API recusou preparar pareamento via GET com `405` e exigiu autenticação para consultar a conexão. O cliente Vercel classificou o `401` da consulta como exigência de autenticação e não disponibilizou seu corpo; não foi usado como comprovação de pareamento.
- Última consulta ao banco: worker `evolution-local` em estado **offline**, zero solicitações pendentes. Nenhum QR real foi emitido por esta sessão remota. A ativação local abaixo é necessária para escanear.
- O alias `kortex-usuarios.vercel.app` continua no deployment de produção anterior `dpl_Co5quHhHJLm1W8WuwPtC2RTkxCRR`. As duas migrações novas e a função foram aplicadas somente no staging.

## O que mudou

A Vercel não acessa mais o `localhost` da Evolution. O backend grava solicitações numa fila privada do Supabase do mesmo ambiente. Um worker ao lado da Evolution consulta essa fila por HTTPS, executa as operações locais e devolve os resultados. A chave da Evolution permanece no computador. Os eventos chegam por um endpoint HTTPS próprio no Supabase, autenticado por header privado.

O computador, a Evolution 2.3.7 e o worker precisam permanecer ligados. O agendamento inicia o worker quando o usuário entra no Windows; não liga o computador nem o Docker. Não foi contratada infraestrutura ou criado túnel público. Para operação independente desse computador, hospedar Evolution/worker em servidor persistente continua sendo uma opção futura.

## Ativar no computador da Evolution

Executar pelo Codex local, preservando alterações locais e as duas sessões existentes. A branch desta entrega é `codex/whatsapp-https-worker`; o aplicativo está em `Kortex/separado/kortex-app`.

1. Buscar essa branch e integrar suas alterações com o checkout atual sem descartar trabalho local. Usar Node.js 22 ou superior e executar `npm ci` na pasta do aplicativo.
2. Copiar `deploy/whatsapp-chat/.env.worker.example` para `.env.whatsapp-worker.staging.local` na pasta do aplicativo. O destino é ignorado pelo Git.
3. Configurar nesse arquivo as credenciais privadas **já disponíveis localmente** do Supabase staging `ukahtcymdcjphvptjamz`: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_PUBLISHABLE_KEY`. Não imprimir valores nem enviá-los por chat.
4. Reutilizar a chave e a origem CORS autorizada da Evolution existente em `EVOLUTION_API_KEY` e `EVOLUTION_REQUEST_ORIGIN`. O endereço no processo Windows é `http://127.0.0.1:8081`, se esse continuar sendo o mapeamento do Docker. Não usar o hostname interno de outro container nesse processo.
5. Manter `WHATSAPP_WORKER_ID=evolution-local` e `WHATSAPP_ENABLE_GROUPS=false`.
6. Com a Evolution ligada, instalar o agendamento:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\whatsapp\install-worker.ps1 -EnvFile .\.env.whatsapp-worker.staging.local
```

Consultar o estado:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\whatsapp\install-worker.ps1 -EnvFile .\.env.whatsapp-worker.staging.local -Action Status
```

O instalador verifica a versão real da Evolution e o acesso ao banco antes de registrar a tarefa. Uma confirmação de atividade inclui `ready: true`, versão `2.3.7` e horário recente. A tarefa usa o usuário atual, sem pedir ou armazenar a senha do Windows, e tenta reiniciar após falhas. O log fica em `%LOCALAPPDATA%\Kortex\whatsapp\<projeto>.log` e não inclui chaves nem conteúdo de mensagens.

Para teste em primeiro plano, sem agendamento:

```powershell
node --env-file=.env.whatsapp-worker.staging.local server/whatsapp/worker.mjs --relay
```

Não executar duas cópias permanentes do mesmo worker. O banco impede o despacho repetido de um mesmo comando, mas uma única instalação simplifica recuperação e estado de saúde.

## Configuração do preview

As variáveis privadas do backend ficam na Vercel, vinculadas ao mesmo Supabase staging. Configurar `WHATSAPP_EVOLUTION_TRANSPORT=relay`, `WHATSAPP_WORKER_ID=evolution-local`, `EVOLUTION_WEBHOOK_SECRET`, `WHATSAPP_WEBHOOK_URL` e `APP_ORIGIN`. A Vercel não precisa receber `EVOLUTION_API_KEY` nem a URL local.

A função Supabase `whatsapp-events` recebe os eventos sem alterar a proteção do preview Vercel. O gateway dessa função não exige JWT de usuário, pois a Evolution usa `x-kortex-webhook-secret`. A função valida o hash SHA-256 desse segredo contra `wa_provider_workers`, limita tamanho/frequência e aceita somente instâncias gerenciadas e eventos previstos. O segredo completo fica no backend e na configuração privada da nova instância; o banco guarda somente o hash. Credenciais da Evolution não são persistidas nos eventos. O estado conectado continua dependendo de confirmação do provedor pelo portal/worker.

As migrações anteriores de WhatsApp, `20261020173632_whatsapp_local_provider_relay.sql` e `20261020175148_whatsapp_authenticated_events.sql` precisam estar aplicadas. Esta entrega aplicou as duas migrações novas somente no staging. A função está em `supabase/functions/whatsapp-events/index.ts` e compartilha a normalização de mensagens com o backend. O worker de produção requer outro arquivo privado, banco de produção e agendamento separado; não reutilizar credenciais de staging.

## Verificação real de pareamento

1. Confirmar atividade recente do worker, acessar o preview autorizado e abrir Conectar WhatsApp na conta de teste.
2. Solicitar o QR no portal. Ele deve vir da Evolution, expirar normalmente e permitir renovação. Sem worker ativo, a API informa que o serviço está offline; não exibe QR fictício.
3. Ler pelo celular em WhatsApp → Aparelhos conectados → Conectar aparelho. O botão de prosseguir só libera depois de a Evolution confirmar estado `open`.
4. Confirmar e-mail/login, histórico disponibilizado, recebimento e envio de teste autorizado, arquivo, áudio e retomada após reiniciar worker/Evolution.
5. Confirmar isolamento entre contas/setores e que as duas sessões anteriores continuam conectadas.

A integração só cria instâncias `koa-<identificador>` previamente vinculadas a `wa_connections`. O relay recusa listar todas as instâncias ou operar nomes legados. Não chamar logout/delete nas duas sessões existentes. Mensagens de teste exigem destinatário autorizado; nenhum disparo é necessário apenas para exibir o QR.

## Evidências e limites

- 35 testes do backend passaram, incluindo controle de lease, despacho único, proteção de sessões legadas, autenticação do webhook, limites de payload, indisponibilidade do worker e resultados grandes em Storage privado.
- 352 testes de interface/regressão passaram com URL/chave públicas de fixture, sem acessar contas reais.
- A migração foi aplicada ao Supabase staging; validação SQL verificou privilégios, Storage privado, reivindicação exclusiva, rejeição de lease incorreta, despacho único, expiração e ausência de repetição de mutações incertas. Dados sintéticos foram removidos na própria transação.
- Compilação e TypeScript passaram. O bundle mantém um aviso de tamanho anterior à mudança.
- A função passou na verificação de tipos Deno usando a versão de `supabase-js` já fixada no lockfile npm do aplicativo (`2.117.2`) e foi compilada/publicada pelo Supabase.
- Os testes automatizados não conectam um celular nem comprovam entrega real de mensagens.
- O agendamento PowerShell foi preparado neste ambiente Linux e ainda precisa ser executado e validado no Windows da Evolution. A máquina remota deste trabalho não acessa o `localhost` do computador do usuário.
- Produção permanece no build anterior até completar a homologação real e a configuração privada do backend de produção.

A revisão automática rejeitou criar uma credencial persistente de bypass da proteção Vercel, por falta de autorização explícita para essa alteração de segurança. A entrega não cria esse bypass: o webhook tem autenticação própria no Supabase, com escopo limitado a eventos WhatsApp gerenciados.
