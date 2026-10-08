# Koa Automation Server

Servidor local do Koa para executar automacoes de operadoras fora do frontend React.

## Arquitetura

Kortex UI -> Local Automation API -> Operation Queue -> Playwright Worker -> Portal da operadora -> API -> chat Koa.

O servico escuta somente `127.0.0.1` por padrao e exige token local no header `x-koa-automation-token`.

## Senhas e Gmail/Google Password Manager

O Koa nao acessa nem raspa o Google Password Manager. O caminho seguro e:

1. cadastrar uma credencial local protegida por DPAPI com `credentialRef`;
2. enviar para a API somente `credentialRef`, nunca a senha;
3. usar um perfil Chrome exclusivo do worker;
4. quando necessario, o humano faz login inicial nesse perfil em modo onboarding.

Para operacao independente de uma maquina local, substitua o `SecretProvider` por um provider de cofre central seguro, como Supabase Vault ou cloud secret manager. O contrato ja esta preparado para isso.

O Gmail/Conta Google de Relacionamento pode ficar logado somente no Chrome exclusivo do Koa para facilitar autofill/onboarding inicial. O servidor nunca automatiza `passwords.google.com`, nunca exporta senhas e nunca usa o perfil pessoal do operador.

## Perfil Chrome exclusivo do Koa

Por padrao no Windows, o perfil fica fora do projeto e fora do OneDrive:

```text
%LOCALAPPDATA%\Kortex\KoaBrowserProfile
```

Tambem pode ser definido manualmente:

```powershell
$env:KOA_BROWSER_PROFILE_DIR="C:\Kortex\KoaBrowserProfile"
```

Comandos:

```bash
npm run browser:onboard
npm run browser:check
npm run session:bootstrap -- --operator=hapvida
```

`browser:onboard` abre o Chrome dedicado em modo visivel para o humano autenticar a Conta Google de Relacionamento e/ou o portal Hapvida. `browser:check` valida se a sessao do portal esta autenticada.

`session:bootstrap` e uma acao administrativa explicita para copiar somente cookies de dominios permitidos de um Chrome autorizado via CDP local para o `SessionManager` do Koa. Ele nao navega no Gmail, nao abre Google Password Manager, nao le senha e nao executa movimentacao. Use apenas quando o Chrome de Relacionamento tiver sido iniciado manualmente com remote debugging e `KOA_EXISTING_CHROME_CDP_URL` configurado.

Para a validacao nao ser enganosa, configure um seletor que exista somente depois do login. No fluxo de carteirinha Hapvida, um bom candidato a validar em modo headed e o texto/elemento da area `Datas de adesão`:

```powershell
$env:HAPVIDA_AUTHENTICATED_SELECTOR="text=Datas de adesão"
```

Se a sessao expirar e nao existir credencial segura no `SecretProvider`, o worker retorna `REAUTH_REQUIRED`.

## Reautenticacao pelo Koa

O formulario do Koa envia a senha somente para `/api/operations/:id/reauth`. Esse endpoint guarda a credencial em memoria e devolve a mesma operacao para `queued`; ele nao abre o navegador nem confirma o login.

O worker consome a credencial temporaria uma unica vez, autentica no navegador da emissao e continua nesse mesmo contexto ate gerar o PDF. `authentication.succeeded` so e emitido depois de validar a sessao no portal. A limpeza de uma execucao anterior nao remove uma credencial enviada para a retomada.

A validacao final confirma o nome do beneficiario no conteudo renderizado da carteirinha. O titulo da aba pode identificar o documento, mas nao precisa ser visivel no corpo. Formularios de login e listas com checkboxes nao sao aceitos como previa. Uma previa ausente ou de outro beneficiario encerra a operacao antes de imprimir, salvar ou anunciar um PDF.

`npm run test:card-preview` executa casos de regressao em Chrome headless com paginas locais de teste, incluindo titulo apenas no `<head>`, popup e PDF gerado pelo navegador. Requer Chrome instalado (`KOA_BROWSER_CHANNEL`, padrao `chrome`), ou `KOA_TEST_BROWSER_EXECUTABLE` apontando para um Chromium de teste. Esse teste nao acessa o portal nem confirma uma emissao real.

Com `rememberOnDevice=false`, a senha nao e gravada em arquivo ou no Supabase. Com `rememberOnDevice=true`, o worker salva a credencial local criptografada por DPAPI somente depois do login confirmado e registra apenas metadados no banco. `authentication.saved_on_device` informa se esses metadados foram registrados; uma indisponibilidade do cadastro nao altera o arquivo local ja criptografado.

`KOA_AUTH_MAX_ATTEMPTS` limita as falhas de login por operacao (padrao: 3). Antes de atingir o limite, uma falha volta para `awaiting_authentication`; ao atingir o limite, a operacao passa para `manual_review`. Falhas tecnicas identificadas como `DATABASE_OPERATION_UPDATE_FAILED` nao consomem uma tentativa de login.

O formulario de carteirinha Hapvida depende do reCAPTCHA para enviar o login. O worker permite somente recursos HTTPS no caminho `/recaptcha/` dos dominios oficiais do Google/reCAPTCHA, iniciados pela pagina Hapvida durante `CARD_ISSUE`. Essa excecao nao libera navegacao principal para esses dominios. Nao adicione dominios Google inteiros a `KOA_AUTOMATION_ALLOWED_HOSTS` para resolver esse problema.

Antes de pedir a credencial, o worker verifica se a API do reCAPTCHA carregou. Depois do clique, aguarda o POST do formulario e a resposta do portal. Uma verificacao indisponivel, um formulario que nao foi enviado ou um retorno silencioso ao login retorna `PORTAL_AUTH_UNAVAILABLE`, sem registrar falha de senha nem abrir outro desafio de autenticacao. `AUTHENTICATION_FAILED` exige uma rejeicao de credencial reconhecida no portal. A sessao autenticada continua sendo validada antes da emissao e do armazenamento opcional da credencial.

Depois de atualizar o codigo no computador do worker, encerre a instancia antiga, execute `npm ci`, `npm run build` e inicie uma unica instancia com `npm start`. Valide uma emissao de teste pela interface: mesma `operationId`, um login no worker, status `success` e PDF do beneficiario correto. Os testes automatizados nao substituem essa validacao no portal real.

## Novos codigos e download pelo chat

Na carteirinha, a credencial e selecionada pelo cadastro da empresa e pelo codigo Hapvida informado. Um novo codigo recebe uma referencia separada; a senha e a sessao de outro codigo nao sao reutilizadas. Corrigir o codigo na reautenticacao atualiza o payload e a referencia da mesma operacao antes de devolve-la para a fila, tanto em Postgres quanto em SQLite.

O formulario permite editar o codigo e inicia com `Lembrar neste computador` marcado. Depois do login validado, a senha fica criptografada por DPAPI no dispositivo e o banco recebe o cadastro e a referencia desse acesso. Desmarcar a opcao mantem a senha somente em memoria para aquela execucao.

O botao do chat baixa o PDF para o computador do usuario. No modo local, a requisicao inclui a autenticacao atual do Kortex e o worker devolve os bytes do bucket privado com `Content-Disposition: attachment`. No modo Supabase, o aplicativo gera uma nova URL assinada ao clicar. Uma falha de download permite tentar baixar o mesmo arquivo novamente, sem emitir outra carteirinha.

Na pasta `kortex-app`, `npm run test:card-download` testa o botao real do chat em Chrome usando API, autenticacao e PDF sinteticos locais. Inclui download autenticado, falha temporaria com nova tentativa, repeticao e worker indisponivel. Nao envia credenciais nem acessa a Hapvida. Usa Chrome instalado ou `KOA_TEST_BROWSER_EXECUTABLE`.

## Scripts

`npm start` recompila o worker antes de iniciar para evitar executar um `dist` antigo depois de `git pull`. Na pasta `kortex-app`, `npm run automation:start` inicia esse mesmo processo. Mantenha o terminal aberto enquanto o worker estiver em uso.

```bash
npm install
npm run dev
npm run build
npm test
npm run browser:onboard
npm run browser:check
```

## Configuracao local

Variaveis principais:

- `KOA_AUTOMATION_PORT`: porta da API. Padrao: `4777`.
- `KOA_AUTOMATION_HOST`: host. Padrao seguro: `127.0.0.1`.
- `KOA_AUTOMATION_TOKEN`: token opcional. Se ausente, um token local e criado em `automation/secrets/local-api-token.txt`.
- `DATABASE_URL`: quando definido, ativa o `PostgresOperationRepository`.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: usados somente no backend para Auth/Storage.
- `ARTIFACT_BUCKET`: bucket privado para artefatos. Padrao: `koa-artifacts`.
- `AUTOMATION_MODE`: `api-worker`, `api` ou `worker`.
- `KOA_AUTOMATION_DEBUG=true`: habilita logs/ajustes de debug; janela visivel deve ser usada somente com `KOA_BROWSER_MODE=debug` ou `onboarding`.
- `BROWSER_PROVIDER`: `headless-local`, `headless-chromium` ou `persistent-chrome`.
- `KOA_BROWSER_MODE`: `background`, `debug`, `onboarding` ou `automation` legado. `background` usa headless e nao abre janela.
- `KOA_BROWSER_PROFILE_DIR`: caminho do perfil Chrome exclusivo do Koa para onboarding/debug.
- `KOA_EXISTING_CHROME_CDP_URL`: endpoint CDP local para bootstrap explicito de sessao. Nao e usado durante operacao normal.
- `KOA_AUTOMATION_ALLOWED_HOSTS`: hosts permitidos durante automacao em background. Padrao: `webhap.hapvida.com.br,sigo.sh.srv.br`.
- `KOA_BROWSER_CHANNEL`: canal Playwright. Padrao: `chrome`.
- `TRACE_AUTH=false`: evita screenshots em telas de autenticacao.
- `FEATURE_KOA_CARD_ISSUE=true`: habilita emissao de carteirinha.
- `KOA_CARD_ISSUE_BATCH_ENABLED=false`: mantem emissao em lote desabilitada ate haver validacao real.
- `FEATURE_KOA_INCLUSION=false`: mantem inclusao bloqueada ate validacao real.
- `FEATURE_KOA_EXCLUSION=false`: mantem exclusao bloqueada ate validacao real.
- `HAPVIDA_CARD_PORTAL_URL`: URL da emissao de carteirinha Hapvida.
- `NDI_CARD_PORTAL_URL`: URL da emissao de carteirinha NDI. O contrato ja reconhece NDI, mas o workflow ainda retorna `PORTAL_MAPPING_REQUIRED` ate o DOM real ser mapeado.
- `HAPVIDA_PORTAL_URL`: alias legado para URL inicial do portal Hapvida.
- `HAPVIDA_AUTHENTICATED_SELECTOR`: seletor real de area autenticada do portal.

URLs conhecidas para onboarding/teste:

```powershell
$env:HAPVIDA_CARD_PORTAL_URL="https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form"
$env:NDI_CARD_PORTAL_URL="https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form"
```

## Emissao de carteirinha

Nesta etapa somente `CARD_ISSUE` esta habilitado para automacao real. Inclusao e exclusao continuam bloqueadas por feature flag.

Payload seguro esperado:

```json
{
  "type": "CARD_ISSUE",
  "portal": "hapvida",
  "operator": "hapvida",
  "companyId": "<uuid-da-empresa>",
  "input": {
    "beneficiaryName": "NOME COMPLETO",
    "periodStart": "2026-09-01",
    "periodEnd": "2026-10-06"
  }
}
```

O frontend nao envia senha. O `credentialRef` e resolvido no backend por `companyId + operator` ou informado explicitamente apenas em ambiente local controlado.

O workflow Hapvida:

1. abre `HAPVIDA_CARD_PORTAL_URL`;
2. valida sessao do Chrome dedicado;
3. se necessario, tenta `SecretProvider`;
4. informa periodo;
5. localiza exatamente um beneficiario;
6. seleciona somente esse beneficiario;
7. aciona `IMPRIMIR SELECIONADOS`;
8. valida a tela `CARTEIRA PROVISORIA`;
9. gera PDF por Playwright/CDP, sem dialog nativo de impressao;
10. valida o PDF antes de marcar `success`;
11. salva artifact em `data/artifacts/<operationId>/`.

Se a sessao expirar e nao houver credencial segura, o retorno correto e `REAUTH_REQUIRED`. Se o portal mudar ou o seletor essencial sumir, o retorno correto e `PORTAL_CHANGED`.

## Cloud/Postgres

A fonte de verdade cloud e `public.automation_operations`, criada pela migration:

```text
supabase/migrations/20261006013000_koa_automation_infrastructure.sql
```

O projeto existente usa `workspaces` como organizacao. Por isso as tabelas de automacao usam `workspace_id`, reutilizando:

- `public.workspaces`
- `public.workspace_members`
- `public.companies`
- `auth.users`

O frontend deve chamar a Automation API. Ele nao deve inserir direto em `automation_operations` e nao deve enviar `credentialRef` em producao. O backend resolve a credencial por `companyId + operator`.

## Worker persistente

Com `DATABASE_URL` configurado, o worker usa:

- `claim_next_automation_operation()`
- `automation_locks`
- `lease_expires_at`
- `mark_stale_automation_operations_for_review()`

Isso evita duas operacoes simultaneas para a mesma empresa/operadora e prepara execucao remota.

## Cadastrar credencial local DPAPI

No PowerShell:

```powershell
.\scripts\set-secret.ps1 -Ref "hapvida:confins" -Username "usuario-do-portal"
```

O script solicita a senha sem exibir no terminal e grava somente o blob DPAPI em `automation/secrets/`.

Opcionalmente, use o cadastro totalmente interativo para nao informar usuario/codigo na linha de comando:

```powershell
.\scripts\set-secret-interactive.ps1
```

Esse fluxo cadastra somente uma credencial especifica do portal. O Koa nao importa, le ou espelha senhas salvas no Chrome.

## Importar uma credencial especifica de CSV exportado pelo Google

Quando o operador ja possui um CSV exportado manualmente do Google Password Manager, use apenas para selecionar uma credencial especifica de portal autorizado. O script nao imprime senhas, nao importa o cofre inteiro e confirma antes de gravar no DPAPI local:

```powershell
.\scripts\import-secret-from-google-csv.ps1 -CsvPath "$env:USERPROFILE\Downloads\Google Passwords.csv"
```

Por padrao, ele filtra somente hosts contendo `hapvida`, `webhap`, `ndi` ou `sigo`. Para adicionar outro portal autorizado:

```powershell
.\scripts\import-secret-from-google-csv.ps1 -AllowedHostTerms @("hapvida", "portal-autorizado")
```

Depois de salvar a credencial especifica, remova o CSV exportado do computador ou guarde-o em local seguro definido pela operacao. O arquivo CSV nao deve ser versionado nem enviado ao frontend.

