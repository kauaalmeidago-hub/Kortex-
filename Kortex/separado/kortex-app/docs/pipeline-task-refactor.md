# Refatoração de Gestão de Tarefas e Pipeline

## Ajustes pontuais da barra e das colunas de tarefas — 20/10/2026

Publicado no portal de usuários em https://kortex-usuarios.vercel.app, às 10h47 (Brasília), implantação `dpl_2vYG5aTP6Sfjryhr83uUPV8GNAPS`. Esta entrega altera somente dois arquivos da interface, com base na versão publicada `dpl_sP5uz8mQbKLvr4UUz9NEmkmwMeC5`. Os outros 207 arquivos publicados foram preservados por hash. Não há migração nem alteração de dados, permissões ou serviços.

Em `src/pages/PipelinePage.tsx`, os três pontos da barra superior foram substituídos por `Settings`, da biblioteca Lucide existente. Nome acessível e tooltip: “Configurações da pipeline”. O botão conserva posição, classes, dimensões, menu e verificações de permissão. A engrenagem usa `shrink-0`: a conferência encontrou que o ícone era comprimido pelo padding do botão de 32 px; agora mede 18 px sem aumentar o controle. O contador global de registros e seu contêiner exclusivo saíram de Kanban e Lista. O total financeiro do contexto Comercial permanece, sem o separador associado ao contador. Contagens das colunas, badges da sidebar e paginação da lista foram preservados.

Em `src/pages/TasksPage.css`, o seletor restrito a `.tasks-workspace .task-kanban-shell .task-column:not(.task-column-placeholder)` aplica `hsl(var(--secondary))` e sombra `0 1px 3px hsl(var(--foreground) / 0.04)`. O fundo envolve cabeçalho, lista, espaços e Nova tarefa, independentemente do título ou número de cards. A linha azul superior, bordas, raio, medidas, cards e placeholder temporário de adicionar coluna mantêm as regras anteriores. Nenhuma camada foi colocada sobre o conteúdo.

Verificações executadas:

- Oito cenários existentes em `PipelinePage.test.tsx` e `TaskKanbanInteractions.test.tsx` aprovados. Um cenário de filtros excedeu o limite inicial de cinco segundos; passou isoladamente com limite de vinte segundos, sem mudança no teste nem no comportamento da aplicação.
- TypeScript, ESLint do componente alterado e build do pacote isolado aprovados, inclusive após a correção do tamanho do ícone. Permanece o aviso conhecido sobre tamanho do bundle.
- Navegador em homologação: engrenagem aberta por clique e Enter; opções autorizadas; Escape; busca e lista; filtros; abertura/cancelamento de Novo; menus dos cards e das etapas. Barra sem contador nem contêiner residual, com o degradê de Novo preservado.
- Colunas vazias e preenchida conferidas visualmente: fundo uniforme `rgb(243, 244, 246)`, sombra externa com opacidade 0,04, raio de 11 px e borda azul superior de 3 px. O card permanece branco, com opacidade 1. Uma tarefa identificada de homologação foi criada pela interface, arrastada para Em andamento e conferida novamente depois de recarregar.
- Viewports 1440 × 900 e 390 × 844. O documento mede respectivamente 1440 e 390 px; a barra da pipeline não transborda. A rolagem horizontal das tarefas permanece dentro do quadro. Não foi realizada matriz de navegadores/dispositivos físicos nem teste autenticado com dados de clientes em produção.
- Após publicação, `/pipeline` e `/tasks` responderam HTTP 200. O domínio aponta para a implantação revisada e serve o novo rótulo e os estilos das colunas. O bundle usa o backend de produção e não contém configuração privada ou referência ao staging.

Evidências: `outputs/isolation/toolbar-columns-release.json`, `toolbar-columns-package-checks.json`, `toolbar-columns-browser.json` e capturas com prefixo `toolbar-columns-`. A conferência autenticada e a tarefa identificada pertencem somente à homologação.

## Ficha completa do lead e quadro de Relacionamento — 20/10/2026

Publicado no **portal de usuários**, em https://kortex-usuarios.vercel.app/pipeline, em 20/10/2026 às 09h45 (Brasília). Implantação final `dpl_sP5uz8mQbKLvr4UUz9NEmkmwMeC5`, versão imutável https://kortex-usuarios-6vi25rlif-kauaalmeidago-hubs-projects.vercel.app. Esta seção descreve o estado atual; as seções seguintes preservam o histórico das entregas anteriores.

A causa da ficha reduzida era a condição de `LeadDetailPage`: somente registros com empresa autorizada renderizavam `CompanyProfileContent`; os demais recebiam um resumo. Agora a rota carrega e edita o lead pelo seu próprio ID e sempre apresenta a composição completa. Uma empresa ausente ou inacessível não substitui o formulário por um aviso nem amplia o acesso ao cadastro compartilhado.

As rotas `/pipeline` e `/pipeline/:pipelineId` usam `PipelinePage`, `PipelineBoard` e seus estilos. `/leads/:leadId` e o alias existente `/lead/:leadId` usam o novo `features/pipeline/LeadProfile.tsx`, por meio de `pages/LeadDetailPage.tsx`. `profile.ts` concentra leitura, mapeamento e atualização parcial; `LeadContactDialog.tsx` trata os contatos; `LeadRecordActivity.tsx` mantém notas, arquivos e histórico. `service.ts`, os tipos Supabase e `PipelineRecordPage.css` completam a integração. `/pipeline/new` e `/settings/pipelines` continuam usando o configurador e as operações existentes.

O quadro apresenta busca, filtros, Kanban/Lista, quantidade real e Novo em uma barra compacta. Um seletor de pipeline aparece quando há mais de uma opção autorizada, conservando o setor e a organização necessários para distingui-las. As colunas vêm de `stages`, com os mesmos IDs, nomes e ordem. Adição rápida, adicionar coluna, renomear, remover com destino e desfazer permanecem nos serviços existentes. O seletor permanente no card foi substituído por ações de movimentação em seu menu; o arraste nativo continua movendo a mesma linha. A camada do menu foi corrigida para que o link que cobre o card não capture seus cliques. Falhas de movimentação reconciliam a posição confirmada pelo servidor.

A ficha usa sidebar de 280 px, avatar de 110 px e formulário em três, duas ou uma coluna conforme a largura disponível. Nome, telefone, e-mail, empresa, projeto, responsável e cidade permanecem presentes quando vazios. Informações complementares e Produtos e operadoras sempre têm cabeçalhos expansíveis. Conversa, Notas e Arquivos permanecem montados ao alternar abas, preservando o trabalho em andamento. Contatos ausentes recebem estado vazio e uma ação real de cadastro/vínculo, sem pessoas fictícias.

Os campos próprios do lead são salvos em `public.leads`. A migração aditiva `20261020140000_pipeline_record_profile.sql` acrescenta `phone`, `email`, `city`, `project` e `offerings`. Um valor nulo pode herdar a informação da relação autorizada; uma string vazia ou lista vazia representa a limpeza explícita. O formulário envia somente os campos alterados, com ID, contexto e versão `updated_at` do registro, preservando valores não editados. Telefone, e-mail, tamanhos e produtos/operadoras têm validação no servidor. O salvamento não edita silenciosamente a empresa compartilhada nem cria uma empresa para viabilizar o lead.

Os contatos independentes usam `public.lead_contacts` e a RPC `business_lead_contact`. O servidor deriva o escopo do lead, verifica leitura/escrita e a associação real, protege conflitos de versão e deduplica uma criação repetida pelo mesmo ID. Editar um contato compartilhado informa esse efeito; desvincular remove a associação sem apagar o cadastro. Contatos de uma empresa resolvida pelo contato principal também mantêm a autorização correta. Notas usam `notes.lead_id`; os metadados de anexos usam `lead_files.lead_id`, bucket privado `lead-files` e URLs assinadas.

As consultas incluem a identidade e o ID do lead, e o formulário é remontado ao trocar de registro. Respostas antigas não preenchem outra ficha. Depois de salvar, as consultas da ficha, dos detalhes, dos catálogos e do quadro/lista são invalidadas, e o contexto de acesso é revalidado. Conflitos e falhas de gravação preservam os campos digitados. A proteção de alterações não salvas e o retorno com busca, filtros, modo e posição continuam usando os mecanismos existentes.

Validações desta entrega:

- **35 testes em sete arquivos** aprovados: quadro, página, ficha, navegação e configurador inicial. Após os ajustes finais de origem de dados, os dez testes de perfil/ficha foram executados novamente e passaram.
- **Oito grupos hospedados em staging**, com sessões comuns: lead sem empresa, atualização parcial, conflito, validação, isolamento entre organizações/setores, contatos independentes/idempotência, edição e desvínculo, empresa compartilhada preservada, notas/arquivos privados, movimentação e contatos da empresa indireta.
- Navegador: criação rápida sem dados opcionais, ficha completa sem empresa, salvar telefone/projeto e recarregar, criar contato, selecionar destinatário, envio corretamente bloqueado sem canal, criar nota, menu do card sem navegação acidental, mover pelo menu e por arraste e abrir ficha vinculada. Uma nova sessão de leitura confirmou os valores, o contato, a nota e o mesmo lead movido, sem duplicação.
- Inspeção em **1366 × 768, 1440 × 900 e 390 × 844**, com sidebar aberta/recolhida. O documento manteve a largura da viewport. No quadro móvel com sete etapas, a rolagem ficou contida no Kanban, e o foco por teclado alcançou a ação final de adicionar coluna. A tentativa adicional de arrastar a barra de rolagem móvel excedeu o tempo da automação; o acesso por teclado foi verificado.
- TypeScript, ESLint dos arquivos envolvidos e build do pacote isolado aprovados. O aviso preexistente sobre tamanho do bundle permanece. A publicação preservou por hash **197 arquivos publicados de outros módulos**; não enviou o checkout inteiro nem configuração privada.
- Backup de produção verificado antes da migração; inventário posterior confirmou os IDs e as quantidades anteriores preservados. Somente a migração desta ficha foi aplicada nessa liberação. Rotas `/tasks`, `/pipeline`, `/pipeline/new` e `/settings/pipelines` responderam HTTP 200. A verificação posterior confirmou a implantação final no domínio, os componentes novos, o configurador inicial, a correção de clique do menu no CSS servido e o backend de produção, sem referência ao staging.

Limitações reais: o responsável é exibido a partir do vínculo autorizado e permanece somente leitura, conforme a regra preexistente de imutabilidade de `assigned_to`; esta entrega não amplia permissões de atribuição. O canal de conversa ainda não está conectado: o compositor fica visível, identifica o contato e bloqueia envio/anexo até existir uma integração válida. Não houve alteração de bot SDR, WhatsApp/Evolution, autenticação ou IA. Os testes autenticados usam exclusivamente homologação; não houve criação de dados fictícios no banco dos usuários. Foi utilizado um navegador disponível nesta sessão; upload e assinatura de arquivo foram homologados via sessões comuns do backend, sem seleção de arquivo no navegador.

Evidências em `outputs/isolation/`: `pipeline-full-release.json`, `pipeline-full-public-checks.json`, `pipeline-full-package-checks.json`, `pipeline-record-checks.json`, `pipeline-full-browser.json` e `pipeline-full-browser-persistence.json`. Capturas: `pipeline-record-empty-desktop.png`, `pipeline-record-linked-desktop.png`, `pipeline-record-mobile.png`, `pipeline-full-kanban-desktop.png` e `pipeline-full-kanban-mobile.png`.

## Atualização do quadro e da ficha contextual — 19/10/2026

A segunda composição solicitada foi implementada em `/pipeline`, `/pipeline/:pipelineId` e `/leads/:leadId` (incluindo o alias `/lead/:leadId`). A liberação da sidebar continua restrita aos módulos já publicados. A ficha de empresa é reutilizada dentro da rota do registro; não foi necessário liberar o módulo completo de Empresas aos usuários.

`PipelinePage.tsx` e seu CSS organizam busca, filtros com aplicação explícita, Kanban/Lista, contagem real e “Novo”. `PipelineBoard.tsx` mantém os IDs e as operações existentes de etapas, inclui adição rápida por coluna, metadados autorizados e estados vazios distintos para filtros. As colunas têm aproximadamente 316 px e rolagem interna. Os nomes, a ordem e as personalizações persistidas não são substituídos por defaults. Valores aparecem apenas no contexto Comercial.

`features/pipeline/service.ts` consulta os vínculos reais de empresa, contato, responsável e tarefas sob RLS, paginados e restritos aos IDs relacionados ao quadro. `pipelineRecord` lê o lead pelo ID da URL e resolve `lead.company_id`, ou `contact.company_id` quando não houver empresa direta. A organização, o setor e a pipeline retornados precisam corresponder a um contexto autorizado. A empresa é consultada pelo seu ID e pela organização correspondente; uma relação ausente ou inacessível recebe um estado explícito. A chave da consulta e do formulário inclui a identidade do registro, impedindo que respostas antigas substituam a ficha atual.

`CompanyProfileContent`, em `CompanyProfilePage.tsx`, recebe o contexto da pipeline e reaproveita foto/logo, campos, produtos e operadoras, contatos, notas e arquivos. O componente mantém a fonte Inter já carregada e os tokens existentes, com regras visuais adicionais limitadas à pipeline e à sua ficha. Os dados próprios do lead, sua edição, notas, arquivos e histórico continuam em uma seção identificada. Não há cópia de empresas para esta tela.

`features/pipeline/navigation.ts` preserva busca, filtros, paginação e modo na URL de retorno, além da posição horizontal do quadro e da rolagem das colunas em memória. Os controles internos do card continuam separados do link que abre a ficha. O retorno contextual usa “Voltar para pipeline”; o acesso original por Empresas mantém seu retorno anterior.

O salvamento da empresa usa a versão `updated_at` e preserva o formulário em falhas. Após sucesso, invalida as consultas da ficha, do quadro, da lista e dos catálogos. A criação do lead usa um ID estável por formulário, com trava de envio e recuperação de repetição pelo mesmo ID. Novo e Adição rápida usam o mesmo serviço; a adição rápida reduz os campos apresentados e começa na coluna escolhida. Notas não salvas permanecem montadas ao trocar de aba. Arquivos usam o bucket privado e URLs assinadas; a remoção respeita a autorização do servidor. Navegação por links e recarregamento têm proteção para rascunhos não salvos.

A homologação encontrou um erro anterior nas políticas `company_media_*`: o nome sem qualificação dentro da subconsulta era interpretado como `companies.name`. A migração aditiva `20261019234500_company_media_object_scope.sql` passa a verificar `storage.objects.name` explicitamente, mantendo organização, empresa e permissão de leitura/escrita. O teste com sessões reais confirmou upload/download autorizado e recusou assinatura do arquivo por outras organizações, setores e não participantes. A publicação também requer a migração já homologada `20261019210000_pipeline_stage_controls.sql` para as operações de etapas. Nenhuma das duas migrações recria cadastros ou etapas.

Verificações desta atualização:

- 38 testes focados em sete arquivos: quadro, navegação, criação por etapa, filtros, ficha correta por ID, resposta atrasada, cadastros e serviços. O teste mais extenso da página foi repetido isoladamente com limite de 20 segundos devido à lentidão do ambiente; os dois cenários passaram.
- Sete cenários de ficha no Supabase de staging, com sessões normais: relações diferentes por card, ausência de empresa, persistência em sessão nova, conflito de versão, notas/arquivos privados, isolamento e repetição da criação. Evidência: `outputs/isolation/pipeline-profile-checks.json`.
- Oito cenários de etapas no staging: renomeio, validação/conflito, criação idempotente, permissões, remoção/desfazer, migração com cards ocultos, movimentação e leitura em sessão nova. Evidência: `outputs/isolation/pipeline-refactor-checks.json`.
- TypeScript e build do checkout e do pacote isolado. ESLint dos arquivos alterados. O aviso conhecido de tamanho do bundle continua presente.
- A suíte geral local apresentou falhas em Gestão de Tarefas/navegação administrativa e interpretação de datas da IA, superfícies em alteração por outros trabalhos. O pacote desta entrega parte da versão efetivamente publicada e preserva esses módulos por hash, evitando publicar alterações locais paralelas. O erro do mock de consulta de empresa encontrado nessa execução foi corrigido e seus testes passaram na suíte focada.
- A prévia local respondeu HTTP 200. A conferência visual no navegador, nos tamanhos desktop/mobile solicitados e com sidebar aberta/recolhida, **não foi concluída**: o navegador do aplicativo não conseguiu conectar a aba, mesmo após tentativas de recuperação. Não há evidência visual desta atualização.

O canal de atendimento de clientes ainda não está conectado neste módulo. A aba Conversa identifica essa dependência e bloqueia envio/anexo, sem simular mensagens ou misturar o chat administrativo. Não houve alteração no bot SDR, Evolution, autenticação ou serviço de inteligência.

Publicação concluída em **19/10/2026, às 14h45 (Brasília)** em https://kortex-usuarios.vercel.app, versão `dpl_7Tx6sXcNwDVxGtf6gfzFHvHEbras`. O pacote foi isolado a partir da versão Vercel em produção e preservou 180 arquivos publicados fora deste escopo. O domínio e o bundle responderam HTTP 200, com os marcadores da interface nova e a configuração do backend de produção. O backup foi verificado e as duas migrações foram aplicadas com preservação dos IDs e das quantidades existentes.

A conferência das fontes e a ausência de configuração privada no bundle ficam em `outputs/isolation/pipeline-layout-package-checks.json`. O recibo fica em `outputs/isolation/pipeline-layout-release.json`; o inventário/backup e as migrações usam o fluxo existente de produção. Os registros identificados de teste são exclusivos do staging. A limitação da conferência visual no navegador permanece registrada acima.

---

## Histórico da primeira refatoração

Entrega de 19/10/2026 no checkout `Kortex/separado/kortex-app`, branch `main`, base `340cb8c`. O checkout já continha alterações em andamento; elas foram preservadas. Esta entrega modifica o código local e foi homologada no Supabase de staging `ukahtcymdcjphvptjamz`. Não foi publicada em produção.

## Gestão de Tarefas

Rota `/admin/tasks`, em `src/pages/TaskAdministrationPage.tsx` e seu CSS. A composição acompanha a imagem enviada: marca existente, chamada central, fundo claro, botão Setores e campo de mensagem inferior. A seleção do quadro passou para a barra da própria tela, corrigindo o uso da altura restante do shell. Histórico, preenchimento manual, anexos, revisão de rascunhos e confirmação explícita permanecem funcionais. O cabeçalho apresenta o estado real da configuração OpenAI do usuário e da organização, com acesso ao formulário existente.

## Pipeline e configuração

Rotas `/pipeline`, `/pipeline/:pipelineId` e `/settings/pipelines`. Os IDs de pipeline usados pelo aplicativo continuam sendo os IDs persistidos, próprios de cada quadro autorizado.

`src/pages/PipelinePage.tsx` usa o novo `src/features/pipeline/PipelineBoard.tsx` e estilos específicos em `PipelinePage.css`. São colunas de 270 px, intervalo de 10 px, cabeçalhos compactos, contagens filtradas, menus acessíveis, cards com título/contexto e metadados disponíveis. Valores financeiros aparecem no Comercial. Busca e filtros de responsável/previsão consultam os registros carregados sob RLS. A navegação e o shell existentes foram preservados.

`pipelineData`, em `src/features/pipeline/service.ts`, continua consultando `stages`, `leads` e permissões do mesmo quadro. A ordem vem de `stages.position` com desempate por ID. Os cards usam o ID do lead; a etapa usa seu ID, nunca o título. Não há substituição de configurações por nomes padrão ou armazenamento local definitivo.

`PipelineStagesSettingsPage.tsx` usa a mesma consulta, cache e editor de configuração. A página é alcançada pelo menu da pipeline e pela configuração existente. Alterações invalidam a consulta da pipeline e atualizam a versão do contexto autorizado. `BusinessAccess.retry` agora permite aguardar essa revalidação.

## Operações das etapas

- Duplo clique ou menu “Editar título” abre o editor com foco e seleção do texto. Enter salva; Escape cancela. Clicar fora mantém a edição aberta, sem gravar. O nome aceita 1–80 caracteres após remover espaços nas extremidades. Nomes repetidos continuam sujeitos às regras existentes do servidor. Falhas preservam o texto digitado.
- “Adicionar etapa” abre um formulário sem gravar. A confirmação usa um ID estável e o servidor deduplica uma repetição da mesma criação. O quadro rola até a etapa criada. Cancelar preserva a lista anterior.
- “Remover etapa” consulta a contagem no servidor, incluindo registros ocultos por filtros. Uma etapa com cards exige a escolha explícita de destino. A mesma transação valida todos os registros, migra os cards e remove a etapa. Um registro pessoal inacessível bloqueia a operação sem revelar sua contagem.
- Uma etapa vazia pode ser restaurada com “Desfazer”, mantendo seu ID. O recibo fica no servidor. A última etapa não pode ser removida. Cards não são apagados para remover uma etapa.
- Arrastar para outra coluna grava etapa e posição no mesmo registro. A seleção de destino oferece uma alternativa ao arraste. O card permanece na posição confirmada enquanto salva; uma falha reconsulta o estado do servidor. Os detalhes continuam em `/leads/:id`.

A migração aditiva `20261019210000_pipeline_stage_controls.sql` foi aplicada **somente em staging**. Ela envolve a transação existente `business_save_columns` com operações autorizadas e idempotentes, contagem protegida e recibos privados para recuperação. Produção precisa receber essa migração antes de publicar o novo frontend. A migração não recria etapas ou registros de usuários.

## Verificação OpenAI em produção

Em 19/10/2026, a consulta de leitura encontrou uma conexão configurada com `gpt-4.1-mini` e segredo presente no Vault. A chamada autenticada ao endpoint do modelo respondeu **HTTP 200**. Portanto, a credencial configurada é aceita pela OpenAI. Essa conferência não gera conteúdo, não cria tarefas e não atesta saldo ou disponibilidade futura de geração.

A chave foi usada somente em memória no processo de verificação e não consta nos relatórios. A integração existente usa uma Edge Function e o Vault. Esse uso no servidor segue a orientação da [documentação oficial de autenticação OpenAI](https://developers.openai.com/api/reference/overview#authentication). A conexão de staging é independente; sua tela pode apresentar “Conectar OpenAI” sem contradizer o resultado de produção.

Evidência: `outputs/isolation/task-ai-current-status.json`. Verificador: `scripts/isolation/task-ai-status-readonly.mjs --verify-provider`.

## Validação e evidências

- Suíte completa: **268 testes em 36 arquivos aprovados**.
- Após os últimos ajustes funcionais: **17 testes** de PipelineBoard e Gestão de Tarefas aprovados.
- TypeScript aprovado; build de produção aprovado, com o aviso existente sobre tamanho do bundle. ESLint dos arquivos alterados aprovado.
- **11 grupos de aceitação hospedados** com sessões reais: renomeio/ordem/vínculos; nomes inválidos e conflitos; criação idempotente; isolamento entre organizações, setores e participantes; remoção vazia com restauração; migração dos cards; movimentação; nova sessão autenticada; registros pessoais inacessíveis; última etapa protegida; configuração Comercial preservada.
- Verificação adicional de recibos com identificadores nulos: operação recusada. Estado final do quadro de homologação: **sete etapas e cinco registros identificados de teste**.
- Navegador: edição por duplo clique e menu, recarregamento, mesma configuração em “Pipelines & Etapas”, arraste persistido, movimentação por seleção, criação/cancelamento, remoção vazia/desfazer com o mesmo ID e remoção com filtro ativo considerando o card oculto.
- Conferência visual em desktop e telas móveis, com rolagem horizontal dentro do quadro, última etapa acessível e compositor de mensagens dentro da viewport.

Relatórios em `outputs/isolation/`: `pipeline-refactor-checks.json`, `pipeline-refactor-integrity.json`, `pipeline-refactor-final-state.json` e `pipeline-refactor-browser.json`. Os registros usados nos testes foram criados somente no ambiente de homologação e têm títulos que os identificam como tais.

Os scripts de aceitação criam novos quadros identificados em staging a cada execução. Não devem ser usados contra produção. Não houve cópia de contatos, leads ou credenciais do ambiente de referência para o banco dos usuários.

## Configuração inicial da pipeline — 20/10/2026

Publicado em https://kortex-usuarios.vercel.app, implantação `dpl_GqoUAhqJKiYEA8k3gJFzNatSEFLn`. A entrega usa como base a versão publicada `dpl_4FHXQodte9YRjBZdzwWX7FikXg6g` e preserva por hash 199 arquivos de outros módulos. Os textos acima registram entregas anteriores; esta seção descreve a nova configuração inicial.

`/pipeline/new` é uma página completa em `src/pages/PipelineSetupPage.tsx`, com estilos em `PipelineSetupPage.css`. A entrada automática em `/pipeline` ocorre somente após a consulta de acesso concluir com sucesso, sem pipeline acessível na organização e no setor atuais. Carregamento, erro, acesso negado e filtros sem resultados não são tratados como ausência. Quem já tem pipeline continua no quadro. A ação “Nova pipeline”, no quadro ou em `/settings/pipelines`, abre o mesmo formulário explicitamente.

O formulário começa com nome vazio e três colunas vazias. Os editores e a prévia usam o mesmo array, com IDs temporários estáveis. Adicionar insere uma única coluna vazia, leva o foco ao campo e revela o editor. Remover e reordenar alteram apenas o rascunho, mantendo os outros valores. Há arraste pelo puxador, setas do teclado e ações no menu. A prévia contém somente a estrutura, com adição de registros desabilitada. O rascunho usa cache de memória segregado por ambiente, conta, organização e contexto de entrada; não é um cadastro paralelo ou uma fonte definitiva em localStorage.

`src/features/pipeline/setup.ts` valida os campos e reconcilia tentativas pelo identificador estável da operação antes de criar. Os tipos das três RPCs estão em `src/integrations/supabase/businessTypes.ts`. A migração `20261020120000_pipeline_initial_setup.sql` cria recibos privados e as funções `business_pipeline_setup_scopes`, `business_pipeline_setup_status` e `business_create_pipeline_setup`. Organização e permissões são derivadas no servidor. Quadro, pipeline, etapas e recibo são gravados na mesma transação. Reenvios retornam os mesmos IDs; payload alterado para um recibo já utilizado é recusado. Não são criados cards, contatos, empresas ou tarefas. O limite existente de 30 etapas e a permissão de nomes de etapa repetidos foram mantidos.

Após confirmar, o acesso é revalidado e o aplicativo abre `/pipeline/:pipelineId` com os IDs reais. O quadro e “Pipelines & Etapas” consultam os mesmos registros de `stages`, ordenados por `position`. O cancelamento não grava dados, usa a proteção de alterações não salvas existente e retorna à origem ou ao estado vazio sem redirecionar novamente ao formulário. Resultado incerto preserva o rascunho e seu recibo para recuperação.

O onboarding conserva a organização privada e o quadro de tarefas existentes; remove apenas a criação automática de “Minha pipeline” em contas novas. Nenhuma pipeline existente foi renomeada, removida ou reestruturada. A migração foi aplicada em staging e produção após backup verificado. A comparação de inventário confirmou todos os IDs e contagens anteriores em produção, com RLS ativa e sem registros fictícios.

Validações desta entrega:

- 23 testes em cinco arquivos: rascunho e prévia, adição/foco, remoção até zero colunas, ordenação, validação, cancelamento, isolamento por conta, recuperação após remount, permissões, filtros existentes e redução de movimento.
- Oito grupos com sessões reais em staging: criação exata e vazia; concorrência e reenvios; entradas inválidas; rollback após falha durante a inserção de uma etapa; isolamento entre organizações/setores e recibos privados; regras de uma coluna e nomes repetidos; onboarding de conta nova; preservação das etapas existentes.
- Navegador com conta real de homologação: primeiro acesso, edição sem gravação, adicionar/remover, arraste e teclado, cancelamento sem loop, criação, recarregamento, mesma configuração em Configurações e abertura explícita de outra pipeline. Uma consulta independente confirmou uma única pipeline vazia, com exatamente as três etapas e a ordem configuradas pela interface.
- Revisão visual em 1366 × 768, 1440 × 900 e 390 × 844, com sidebar aberta/recolhida, nomes longos e oito editores. Em mobile, documento e viewport medem 390 px; a rolagem horizontal fica nos editores e na prévia. O posicionamento das labels acessíveis foi contido nos editores para impedir transbordamento.
- TypeScript e ESLint aprovados. Build do pacote isolado aprovado, com o aviso existente sobre tamanho do bundle. A checagem de tipos do pacote fornece os tipos de matchers de teste pela CLI, sem alterar arquivos publicados de outros módulos.
- Rotas públicas `/pipeline`, `/pipeline/new` e `/settings/pipelines` retornaram HTTP 200 após a promoção. O bundle publicado contém a nova configuração e aponta para o backend de produção, sem configuração privada ou referência ao staging.

Evidências em `outputs/isolation/`: `pipeline-setup-release.json`, `pipeline-setup-package-checks.json`, `pipeline-setup-checks.json`, `pipeline-setup-browser-persistence.json`, `pipeline-setup-browser.json`, `pipeline-setup-desktop.png` e `pipeline-setup-mobile.png`. Os testes de navegador usam somente staging. Não foram realizados testes autenticados com dados de clientes em produção nem uma matriz de navegadores além do navegador disponível nesta sessão.
