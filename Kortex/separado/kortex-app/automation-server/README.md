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

Pedidos de carteirinha usam `portalSearch: "auto"`, inclusive pedidos antigos sem essa propriedade; somente `portalSearch: "selected"` limita a busca a uma operadora. Em um novo pedido, o worker prioriza o ultimo portal com acesso ativo e validado para a mesma empresa e codigo, consultando apenas os metadados do cadastro. Sem acesso validado, usa o portal inicial. Se o acesso for rejeitado, faltar credencial ou o beneficiario nao for encontrado, consulta o outro portal na mesma operacao. A retomada de autenticacao preserva o portal do pedido. Uma lista que nao carregou ou um seletor indisponivel antes de qualquer selecao tambem permite consultar o outro portal, sem registrar ausencia do beneficiario. Ao confirmar uma carteirinha e gerar um PDF valido, a busca termina; `operator` no resultado e nos metadados do arquivo identifica a operadora. Uma selecao nao confirmada, previa incorreta, nome ambiguo ou PDF invalido interrompe a busca para revisao.

Hapvida utiliza `HAPVIDA_CARD_PORTAL_URL`. NDI utiliza `NDI_CARD_PORTAL_URL`, com padrao `https://sigo.sh.srv.br/pls/webmin/pk_carteira_provisoria.login_empresa_form`. As credenciais salvas sao selecionadas separadamente por empresa, operadora e codigo. Somente a senha enviada explicitamente para aquela busca automatica pode ser tentada nos dois portais em memoria; uma senha Hapvida previamente salva nao e reutilizada em NDI. Com "Salvar acesso", cada login confirmado e associado a empresa, operadora e codigo corretos, com senha criptografada no Supabase Vault e copia local DPAPI quando disponivel.

Se apenas um portal precisar de autenticacao, a retomada consulta esse portal sem repetir uma busca ja concluida para o mesmo beneficiario, codigo e periodo. "Beneficiario nao encontrado em Hapvida ou NDI" exige ausencia confirmada nos dois. Se algum portal estiver indisponivel, o pedido informa que a busca ficou incompleta. O pre-check opcional de usuarios ativos Hapvida nao e executado em NDI. Inclusao e exclusao NDI continuam aguardando mapeamento.

`npm run test:card-portals` testa em Chromium os dois formularios, periodo, selecao, geracao real de PDF, troca de operadora, referencia de credencial e falhas sem arquivo, com paginas sinteticas e todas as requisicoes interceptadas. Esse teste nao acessa os portais reais. Depois de atualizar a instalacao permanente, valide uma carteirinha NDI real no computador do worker. Para limitar um pedido ao portal escolhido na API local, informe `portalSearch: "selected"`.

No campo de nome, `TODOS` (inclusive em minusculas) solicita todas as carteirinhas disponiveis para o codigo da empresa e periodo informados. A API tambem aceita `beneficiaryScope: "all"`. O codigo da empresa e obrigatorio para o lote; a sessao generica de outro contrato nao e aceita. O worker identifica as linhas selecionaveis, confirma todos os controles e confere todos os nomes/identificadores na previa antes de gerar um unico PDF, com varias paginas quando necessario. O resultado informa `beneficiaryCount` e o chat apresenta "Baixar todas as carteirinhas". Uma lista paginada ou uma linha sem identidade reconhecivel retorna `CARD_BATCH_INCOMPLETE`, sem anunciar um lote parcial como completo. `FEATURE_KOA_CARD_ISSUE` controla tanto a emissao individual quanto o comando explicito `TODOS`; a antiga variavel `KOA_CARD_ISSUE_BATCH_ENABLED`, que nao controlava a execucao, foi retirada do exemplo de configuracao.

A previa pode estar na aba principal, popup ou frame visivel da mesma origem do portal. Campos somente de leitura sao incluidos na conferência e convertidos em texto na copia de impressao. Nomes abreviados exigem um identificador da linha selecionada; se a lista informa o numero da carteirinha, ele tambem deve corresponder ao documento. Homonimos exigem identificadores individuais, sem usar um CPF compartilhado para confirmar duas carteirinhas. Uma emissao individual limpa outras selecoes anteriores antes de imprimir. O titulo da aba e apenas um sinal de tipo de documento; listas, login e telas de espera nao sao carteirinhas.

O lote reconhece cabecalhos de tabelas antigas com celulas `TD` e separa controles "Selecionar todos" das linhas de beneficiarios. Usa o controle geral quando disponivel, confere todas as selecoes e prioriza "Imprimir tudo", "Imprimir todos" ou "Imprimir todas". Sem esse comando, usa "Imprimir selecionados" depois de marcar todos. A emissao individual utiliza somente o comando dos selecionados. O evento `card_print_requested`, registrado depois do clique, informa o comando utilizado (`all` ou `selected`) e a quantidade selecionada. Uma resposta na mesma aba e reconhecida assim que o documento fica pronto, sem a espera fixa de cinco segundos por um popup. Uma mensagem explicita "Identificacao invalida" encerra o login rejeitado antes da espera por uma area autenticada.

`npm run test:card-batch` verifica esses cenarios em paginas sinteticas, incluindo empresas/codigos distintos, cabecalhos `TD`, controles gerais no cabecalho/rodape, os tres comandos de impressao em lote, uma consulta individual com lista de 100 pessoas, um lote de 12 beneficiarios e lote incompleto. `KOA_TEST_PDF_OUTPUT_DIR` permite salvar os PDFs sinteticos para inspecao. O heartbeat da instalacao atualizada informa `cardIssueWorkflowVersion: 8`, `cardIssuePrintAllEnabled: true`, `cardPortalPreferenceVersion: 1` e `cardPreviewVersion: 2`.

A selecao examina todas as linhas visiveis correspondentes ao nome, prioriza linhas com controle habilitado e aceita checkbox, radio ou rotulo associado ao controle oculto. O formulario permite informar CPF ou numero da carteirinha para diferenciar os registros. Se ainda houver mais de uma linha correspondente, a emissao aguarda uma escolha explicita no chat. Copias identicas da mesma carteirinha, com identidade confirmada, sao tratadas como uma unica linha; registros de planos ou carteirinhas diferentes continuam separados. O worker aguarda a lista depois da consulta e confirma a selecao antes de imprimir. `npm run test:card-selection` verifica esses layouts e o carregamento atrasado em Chromium com dados sinteticos. O heartbeat da versao atual informa `cardIssueWorkflowVersion: 8` e `cardPortalSearchDefault: "auto"`, permitindo verificar se a instalacao em execucao recebeu essa atualizacao.

## Escolha de carteirinha para nomes repetidos

Quando o portal retorna registros diferentes com o mesmo nome, o worker pausa antes de selecionar ou imprimir, salva `cardBeneficiaryConfirmation` e apresenta as opcoes no chat. Nenhuma opcao vem previamente marcada. O usuario confere o numero da carteirinha e os dados do portal, escolhe o registro e a mesma operacao continua. O CPF e mascarado na apresentacao. A identificacao individual no formulario e opcional; nao e necessario conhecer o numero antecipadamente para escolher entre registros distinguiveis no portal.

`POST /api/operations/:id/card-beneficiary` aceita somente `{ confirmationId, optionId }` com a autenticacao do aplicativo. A decisao e gravada atomicamente apenas para uma opcao gerada pelo servidor, enquanto o pedido aguarda confirmacao. Uma segunda decisao, cancelamento, usuario diferente ou opcao antiga nao autoriza nova emissao. Na retomada, a lista e consultada novamente; empresa, portal, codigo, periodo e identidades precisam corresponder a escolha. Uma mudanca pede nova decisao. Se houver dependentes, a confirmacao habitual de dependentes aparece depois da escolha do registro. O heartbeat informa `cardIssueBeneficiaryChoiceEnabled: true` e `cardIssueWorkflowVersion: 8`.

## Confirmacao de dependentes antes da impressao

Em um pedido individual, o worker confere os vinculos apresentados na lista do portal antes de marcar ou imprimir. Quando encontra dependentes do beneficiario solicitado, registra a lista em `cardDependentConfirmation`, muda a mesma operacao para `awaiting_confirmation` e o chat mostra os nomes com os botoes "Com dependentes", "Sem dependentes" e "Cancelar". A posicao de uma pessoa abaixo de outra, sozinha, nao estabelece parentesco: sao exigidos identificador/nome do titular ou um grupo explicitamente tipado como titular e dependentes. Um pedido diretamente para um dependente nao inclui seus irmaos. `TODOS` continua solicitando o lote da empresa.

`POST /api/operations/:id/card-dependents` aceita somente `{ confirmationId, includeDependents }` com a autenticacao do aplicativo. O endpoint verifica o responsavel e registra uma unica decisao de forma atomica antes de reencaminhar a mesma operacao. Cancelamento, decisao repetida, confirmacao antiga ou nomes arbitrarios enviados pelo cliente nao reiniciam a emissao. A escolha fica vinculada a empresa, portal, codigo, periodo e identidades encontradas. Uma mudanca na familia exige nova confirmacao; nenhuma lista antiga autoriza pessoas novas.

"Com dependentes" usa "Imprimir selecionados" para o titular e os dependentes apresentados, com as molduras Alaive para preservar todas as carteirinhas. "Sem dependentes" aceita a impressao conjunta exigida pelo portal e entrega somente a carteirinha escolhida. O worker separa o cartao completo pelo nome e identificador dentro da mesma regiao, incluindo logotipo, plano, validade e rodape. Carteirinhas em frames e campos somente de leitura tambem sao suportados. Outras pessoas e numeros de carteirinha sao excluidos do documento entregue; uma regiao ausente, incompleta ou ambigua retorna `CARD_CAPTURE_FAILED` sem salvar o PDF da familia. A mesma captura se aplica a um pedido individual para um dependente. A capacidade e informada por `cardIssueSingleCaptureEnabled: true`. A impressao so gera um artefato depois de conferir todos os beneficiarios autorizados e o marcador final do PDF; arquivos interrompidos sao rejeitados. Uma credencial ja validada pode permanecer somente na memoria, limitada a essa operacao/portal por cinco minutos durante a espera; nao e gravada no resultado ou nos eventos. O armazenamento permanente continua dependendo de "Salvar acesso". O heartbeat informa `cardIssueDependentConfirmationEnabled: true` na versao 8.

`npm run test:card-dependents` valida em Chromium a pausa, o endpoint de escolha, a retomada em um novo contexto, selecao automatica de dependentes, exclusao de outra familia, mudanca da lista e impressao obrigatoria da familia e previas incompletas, em Hapvida e NDI sinteticos. `npm run test:single-card-capture` valida a separacao de carteirinhas na mesma pagina, a escolha de titular ou dependente em qualquer posicao, homonimos, frames, tabelas, nomes abreviados, campos somente de leitura e a preservacao de rodape/logotipo. Identidade dividida entre dois cartoes, duplicidade e cartao incompleto nao geram PDF. Nenhuma senha real ou requisicao externa e utilizada.

## Entrega das carteirinhas com molduras Alaive

Toda emissao passa pela composicao antes de salvar o PDF. As tres imagens originais do cliente ficam versionadas em `assets/card-delivery`: `single.png` para uma carteirinha, `first.png` na primeira pagina de uma entrega multipla e `continuation.png` nas seguintes. A pagina preserva a proporcao da arte, e o documento original da operadora permanece como conteudo legivel no centro do espaco branco, com todos os dados, imagens, validade e rodape. A imagem da moldura nao substitui os dados do documento.

O worker organiza os cartoes pelo vinculo confirmado no portal. Cada dependente fica abaixo de seu titular; se houver varios dependentes, repete a carteirinha do mesmo titular nas paginas seguintes, com um dependente completo por espaco. Titulares de familias diferentes nao sao misturados. Dois titulares independentes podem compartilhar a pagina com ambos os espacos identificados como `TITULAR`. Se o portal nao informa tipo ou vinculo, os espacos sao identificados como `BENEFICIARIO`, sem inferir parentesco pela posicao. Um dependente sem titular identificavel em um lote retorna `CARD_FAMILY_MAPPING_FAILED`. `TODOS` tambem inclui os dependentes cuja emissao esta vinculada ao seletor do titular, mesmo sem controle individual.

Em uma emissao individual ou familiar selecionada, o arquivo tem somente o nome do beneficiario em minusculas, separado por hifens, por exemplo `romualdo-ferreira-gomes.pdf`. O titulo interno do PDF tem somente o nome em minusculas. O lote da empresa continua usando `carteirinhas-empresa-codigo.pdf`. O resultado registra `cardDeliveryVersion: 1`, `pageCount` e a quantidade de pessoas unicas; a repeticao visual do titular nao aumenta essa quantidade.

Uma separacao, imagem ou composicao incompleta nao entrega o documento cru como alternativa. O heartbeat da versao 8 informa `cardDeliveryTemplateVersion: 1` e `cardDeliveryBrandingEnabled: true`. `npm run test:branded-card-delivery` valida as duas operadoras, primeira pagina e continuacoes, familias fora de ordem, homonimos, pedido direto de dependente, seletores apenas no titular, pessoa extra na impressao e o fallback de impressao Chromium. Os PDFs sao de demonstracao e podem ser exportados com `KOA_TEST_PDF_OUTPUT_DIR`.

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

