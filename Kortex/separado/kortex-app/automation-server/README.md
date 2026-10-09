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
npm run browser:onboard -- --operator=ndi
npm run browser:check -- --operator=ndi
npm run session:bootstrap -- --operator=hapvida
```

`browser:onboard` abre o Chrome dedicado no portal de carteirinha escolhido; Hapvida e o padrao e `--operator=ndi` seleciona NDI. Depois do login manual e da confirmacao com Enter, somente a sessao validada daquela operadora e salva por DPAPI. Uma tentativa NDI sem login validado nao salva estado e nao substitui a sessao Hapvida.

`browser:check` valida a sessao da operadora escolhida ou tenta renova-la com a credencial segura cadastrada para essa operadora. `REAUTH_REQUIRED` informa falta de acesso validado e nao desabilita o worker nem a emissao Hapvida. Para cadastrar e lembrar o acesso NDI, envie a credencial pelo formulario seguro do chat em um pedido de carteirinha, com "Salvar acesso para as proximas emissoes". O worker valida o login antes de salvar o acesso no cofre do banco. O onboarding manual salva a sessao, sem ler nem cadastrar a senha.

Se houver mais de uma empresa elegivel, informe `--company-id=<uuid>`. Para verificar um codigo especifico, adicione `--company-code=<codigo>`; o check nao aceita a sessao geral de outro codigo como confirmacao desse acesso. `npm run test:portal-sessions` verifica isolamento de sessoes, login NDI e Hapvida e falhas de autenticacao em Chromium com paginas sinteticas interceptadas, sem acessar os portais reais.

`session:bootstrap` e uma acao administrativa explicita para copiar somente cookies de dominios permitidos de um Chrome autorizado via CDP local para o `SessionManager` do Koa. Ele nao navega no Gmail, nao abre Google Password Manager, nao le senha e nao executa movimentacao. Use apenas quando o Chrome de Relacionamento tiver sido iniciado manualmente com remote debugging e `KOA_EXISTING_CHROME_CDP_URL` configurado.

Para a validacao nao ser enganosa, configure um seletor que exista somente depois do login. No fluxo de carteirinha Hapvida, um bom candidato a validar em modo headed e o texto/elemento da area `Datas de adesão`:

```powershell
$env:HAPVIDA_AUTHENTICATED_SELECTOR="text=Datas de adesão"
```

Se a sessao expirar e nao existir credencial segura no `SecretProvider`, o worker retorna `REAUTH_REQUIRED`.

## Busca de carteirinha em Hapvida e NDI

Pedidos de carteirinha usam `portalSearch: "auto"`, inclusive pedidos antigos sem essa propriedade; somente `portalSearch: "selected"` limita a busca a uma operadora. O worker consulta o portal inicial e, se o acesso for rejeitado, faltar credencial ou o beneficiario nao for encontrado, consulta o outro portal na mesma operacao. Uma lista que nao carregou ou um seletor indisponivel antes de qualquer selecao tambem permite consultar o outro portal, sem registrar ausencia do beneficiario. Ao confirmar uma carteirinha e gerar um PDF valido, a busca termina; `operator` no resultado e nos metadados do arquivo identifica a operadora. Uma selecao nao confirmada, previa incorreta, nome ambiguo ou PDF invalido interrompe a busca para revisao.

Hapvida utiliza `HAPVIDA_CARD_PORTAL_URL`. NDI utiliza `NDI_CARD_PORTAL_URL`, com padrao `https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form`. As credenciais salvas sao selecionadas separadamente por empresa, operadora e codigo. Somente a senha enviada explicitamente para aquela busca automatica pode ser tentada nos dois portais em memoria; uma senha Hapvida previamente salva nao e reutilizada em NDI. Com "Salvar acesso", cada login confirmado e associado a empresa, operadora e codigo corretos, com senha criptografada no Supabase Vault e copia local DPAPI quando disponivel.

Se apenas um portal precisar de autenticacao, a retomada consulta esse portal sem repetir uma busca ja concluida para o mesmo beneficiario, codigo e periodo. "Beneficiario nao encontrado em Hapvida ou NDI" exige ausencia confirmada nos dois. Se algum portal estiver indisponivel, o pedido informa que a busca ficou incompleta. O pre-check opcional de usuarios ativos Hapvida nao e executado em NDI. Inclusao e exclusao NDI continuam aguardando mapeamento.

`npm run test:card-portals` testa em Chromium os dois formularios, periodo, selecao, geracao real de PDF, troca de operadora, referencia de credencial e falhas sem arquivo, com paginas sinteticas e todas as requisicoes interceptadas. Esse teste nao acessa os portais reais. Depois de atualizar a instalacao permanente, valide uma carteirinha NDI real no computador do worker. Para limitar um pedido ao portal escolhido na API local, informe `portalSearch: "selected"`.

A selecao examina todas as linhas visiveis correspondentes ao nome, prioriza linhas com controle habilitado e aceita checkbox, radio ou rotulo associado ao controle oculto. Homonimos exigem CPF ou data de nascimento que diferencie as linhas. O worker aguarda a lista depois da consulta e confirma a selecao antes de imprimir. `npm run test:card-selection` verifica esses layouts e o carregamento atrasado em Chromium com dados sinteticos. O heartbeat da versao corrigida informa `cardIssueWorkflowVersion: 2` e `cardPortalSearchDefault: "auto"`, permitindo verificar se a instalacao em execucao recebeu essa atualizacao.

## Reautenticacao pelo Koa

O formulario do Koa envia a senha somente para `/api/operations/:id/reauth`. Esse endpoint guarda a credencial em memoria e devolve a mesma operacao para `queued`; ele nao abre o navegador nem confirma o login.

O worker consome a credencial temporaria uma unica vez, autentica no navegador da emissao e continua nesse mesmo contexto ate gerar o PDF. `authentication.succeeded` so e emitido depois de validar a sessao no portal. A limpeza de uma execucao anterior nao remove uma credencial enviada para a retomada.

A validacao final confirma o nome do beneficiario no conteudo renderizado da carteirinha. O titulo da aba pode identificar o documento, mas nao precisa ser visivel no corpo. Formularios de login e listas com checkboxes nao sao aceitos como previa. Uma previa ausente ou de outro beneficiario encerra a operacao antes de imprimir, salvar ou anunciar um PDF.

`npm run test:card-preview` executa casos de regressao em Chrome headless com paginas locais de teste, incluindo titulo apenas no `<head>`, popup e PDF gerado pelo navegador. Requer Chrome instalado (`KOA_BROWSER_CHANNEL`, padrao `chrome`), ou `KOA_TEST_BROWSER_EXECUTABLE` apontando para um Chromium de teste. Esse teste nao acessa o portal nem confirma uma emissao real.

Com `rememberOnDevice=false`, a senha nao e gravada em arquivo ou no Supabase. Com `rememberOnDevice=true` (nome mantido na API por compatibilidade), o worker grava o codigo e a senha no Supabase Vault somente depois do login confirmado. O cadastro publico contem apenas a referencia, o codigo e os metadados; a associacao com o segredo fica em `koa_private.automation_credential_secrets`, sem acesso de `anon` ou `authenticated`. A senha nao e gravada nos eventos, resultados ou metadados publicos.

`authentication.saved_in_database` confirma a gravacao no cofre; `authentication.saved_on_device` confirma a copia DPAPI quando disponivel. Uma falha na gravacao no banco nao e anunciada como sucesso no banco. Sem nenhuma copia protegida, o retorno e `CREDENTIAL_SAVE_FAILED`. Uma falha ao consultar o cofre retorna `CREDENTIAL_STORE_UNAVAILABLE`, sem pedir outra senha nem tentar uma credencial de outra empresa ou operadora.

`KOA_AUTH_MAX_ATTEMPTS` limita as falhas de login por operacao (padrao: 3). Antes de atingir o limite, uma falha volta para `awaiting_authentication`; ao atingir o limite, a operacao passa para `manual_review`. Falhas tecnicas identificadas como `DATABASE_OPERATION_UPDATE_FAILED` nao consomem uma tentativa de login.

O formulario de carteirinha Hapvida depende do reCAPTCHA para enviar o login. O worker permite somente recursos HTTPS no caminho `/recaptcha/` dos dominios oficiais do Google/reCAPTCHA, iniciados pela pagina Hapvida ou NDI correspondente durante `CARD_ISSUE`. Essa excecao nao libera navegacao principal para esses dominios. Nao adicione dominios Google inteiros a `KOA_AUTOMATION_ALLOWED_HOSTS` para resolver esse problema.

Antes de pedir a credencial, o worker verifica se a API do reCAPTCHA carregou. Depois do clique, aguarda o POST do formulario e a resposta do portal. Uma verificacao indisponivel, um formulario que nao foi enviado ou um retorno silencioso ao login retorna `PORTAL_AUTH_UNAVAILABLE`, sem registrar falha de senha nem abrir outro desafio de autenticacao. `AUTHENTICATION_FAILED` exige uma rejeicao de credencial reconhecida no portal. A sessao autenticada continua sendo validada antes da emissao e do armazenamento opcional da credencial.

Depois de instalar a versao atualizada no computador do worker, valide uma emissao de teste pela interface: mesma `operationId`, um login no worker, status `success` e PDF do beneficiario correto. Os testes automatizados nao substituem essa validacao no portal real.

## Novos codigos e download pelo chat

Na carteirinha, a credencial e selecionada pelo cadastro da empresa e pelo codigo Hapvida informado. Um novo codigo recebe uma referencia separada; a senha e a sessao de outro codigo nao sao reutilizadas. Corrigir o codigo na reautenticacao atualiza o payload e a referencia da mesma operacao antes de devolve-la para a fila, tanto em Postgres quanto em SQLite.

O formulario permite editar o codigo e inicia com `Salvar acesso para as proximas emissoes` marcado. Depois do login validado, o banco recebe a credencial criptografada. O worker recupera esse acesso para as proximas emissoes da mesma empresa, operadora e codigo. Uma nova senha validada para a mesma referencia atualiza o segredo existente em uma transacao. Desmarcar a opcao mantem a senha somente em memoria para aquela execucao.

O cofre exige `DATABASE_URL` de backend, a extensao `supabase_vault` e as migrations `../supabase/migrations/20261009124253_koa_portal_credential_vault_storage.sql` e `20261009130006_koa_portal_credential_database_event.sql`. A role do backend deve poder acessar o cofre e o schema privado; nenhuma chave administrativa vai para o frontend. A conexao remota do cofre exige TLS com verificacao do certificado (`sslmode=verify-full`); configure `sslrootcert` no `DATABASE_URL` caso o certificado do projeto nao esteja no trust store do Node. O `SecretProvider` prioriza o cofre e permite as credenciais DPAPI antigas quando a referencia ainda nao tem segredo no banco. Credenciais inativas ou associacoes inconsistentes nao usam essa alternativa local.

O heartbeat da versao instalada informa `portalAccessStorageVersion: 1` e `portalAccessStorage: "supabase_vault"` quando o cofre esta configurado. Esse marcador confirma a versao do worker; a gravacao de cada acesso e confirmada pelo evento de autenticacao apos o login.

O botao do chat baixa o PDF para o computador do usuario. No modo local, a requisicao inclui a autenticacao atual do Kortex e o worker devolve os bytes do bucket privado com `Content-Disposition: attachment`. No modo Supabase, o aplicativo gera uma nova URL assinada ao clicar. Uma falha de download permite tentar baixar o mesmo arquivo novamente, sem emitir outra carteirinha.

Na pasta `kortex-app`, `npm run test:card-download` testa o botao real do chat em Chrome usando API, autenticacao e PDF sinteticos locais. Inclui download autenticado, falha temporaria com nova tentativa, repeticao e worker indisponivel. Nao envia credenciais nem acessa a Hapvida. Usa Chrome instalado ou `KOA_TEST_BROWSER_EXECUTABLE`.

## Scripts

`npm start` recompila o worker antes de iniciar. Na pasta `kortex-app`, `npm run automation:start` inicia esse mesmo processo em primeiro plano. Para operar diariamente sem terminal, use a instalacao permanente abaixo.

```bash
npm install
npm run dev
npm run build
npm test
npm run browser:onboard
npm run browser:check
```

## Instalacao permanente no Windows

Execute uma vez na pasta `Kortex/separado/kortex-app`, com o mesmo usuario Windows que utiliza as credenciais DPAPI. Requer Node.js 22.13 ou superior com npm e a configuracao local ja utilizada pelo Kortex. Se houver um terminal antigo executando `automation:start` ou `npm run dev`, encerre-o antes da primeira ativacao.

```powershell
git pull
npm run automation:install
```

O instalador instala as dependencias do lockfile, compila o worker e o aplicativo e cria a inicializacao automatica do usuario. O aplicativo compilado usa a API local e as chaves publicas Supabase de `.env`/`.env.local` da pasta `kortex-app`; a chave secreta do backend nao e enviada ao frontend. O processo continua depois de fechar o terminal, inicia ao entrar no Windows e recupera quedas com espera progressiva de ate 30 segundos. Abra o atalho `Kortex` na area de trabalho, ou `http://localhost:8080`.

Edge e Chrome podem acessar esse endereco. Entre em `http://localhost:8080/auth` com sua conta do Kortex antes de usar o Inbox. Esse login e separado da senha do portal Hapvida. A sessao do Kortex e mantida no navegador e renovada automaticamente; a API recusa pedidos sem sessao. O instalador verifica que `VITE_SUPABASE_URL` do aplicativo e `SUPABASE_URL` do backend usam o mesmo projeto e exige a configuracao de autenticacao do backend. Uma falha de rede ou de configuracao nao deve ser tratada como senha incorreta da Hapvida.

O Windows precisa estar ligado e o usuario conectado. O registro usa a pasta Inicializar do usuario, sem exigir administrador e preservando a identidade DPAPI. A versao compilada permanece instalada; nao e necessario repetir `git pull`, `build` ou `start` para cada emissao.

As configuracoes do worker tambem ficam protegidas por DPAPI em `%LOCALAPPDATA%\Kortex\Runtime\environment.dpapi`, inclusive quando vieram somente das variaveis do terminal. As credenciais do portal, perfil do navegador e arquivos existentes continuam nos seus caminhos configurados. O arquivo `status.json` contem somente portas, horarios, estados e PIDs. A API, o aplicativo e a protecao de instancia escutam somente no computador local.

O supervisor aguarda a confirmacao de inicializacao de cada processo e impede uma segunda instancia. O worker so consulta a fila depois de conseguir abrir sua porta. Quedas temporarias do banco recebem reconexao automatica, incluindo erros de conexoes ociosas. A recuperacao consulta a fila; uma acao com resultado incerto continua sujeita a lease e revisao manual, sem reenvio automatico ao portal.

Comandos na pasta `kortex-app`:

```powershell
npm run automation:status
npm run automation:stop
npm run automation:install
npm run automation:remove
```

`status` verifica os dois processos e a prontidao da fila. `stop` solicita encerramento dos processos gerenciados, preservando credenciais; `install` os reativa. `remove` encerra e remove a inicializacao automatica. Nenhum desses comandos encerra processos externos ou remove as credenciais. `/ready` retorna 503 enquanto a fila esta reconectando, em vez de anunciar worker pronto.

Para instalar uma futura alteracao de codigo ou configuracao, aguarde a operacao atual terminar, execute `automation:stop`, atualize com `git pull` e rode `automation:install` novamente. A instalacao ativa nao e substituida durante uma emissao.

```bash
npm run automation:check-runtime
```

Esse teste usa uma copia temporaria isolada com SQLite e pagina sintetica, sem configuracao, credenciais, banco remoto ou portal reais. Verifica aplicativo e API em segundo plano, tentativa de segunda instancia, recuperacao de quedas separadas do worker/aplicativo e encerramento sem processos orfaos. A criacao do atalho e a protecao DPAPI precisam ser validadas no Windows do operador.

## Configuracao local

Variaveis principais:

- `KOA_AUTOMATION_PORT`: porta da API. Padrao: `4777`.
- `KOA_DESKTOP_PORT`: porta do aplicativo permanente. Padrao: `8080`.
- `KOA_SUPERVISOR_PORT`: porta local usada somente para impedir duas instancias do supervisor. Padrao: `4776`.
- `KOA_AUTOMATION_HOST`: host. Padrao seguro: `127.0.0.1`.
- `KOA_AUTOMATION_TOKEN`: token opcional. Se ausente, um token local e criado em `automation/secrets/local-api-token.txt`.
- `DATABASE_URL`: quando definido, ativa o `PostgresOperationRepository` e o cofre de credenciais validadas no banco.
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
- `NDI_CARD_PORTAL_URL`: URL da emissao de carteirinha NDI. Utiliza o fluxo de carteirinha compartilhado; movimentacoes NDI continuam aguardando mapeamento.
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

