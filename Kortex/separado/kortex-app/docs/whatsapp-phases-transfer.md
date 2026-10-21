# Etapas e transferência do atendimento

## Escopo de homologação em 21/10/2026

A branch `codex/whatsapp-phases-transfer` mantém o desenho atual do chat e acrescenta as abas **Todos, Triagem, Em atendimento, Pendentes e Resolvidos**. O atendimento tem fase, responsável, versão e histórico próprios; o histórico WhatsApp continua pertencendo ao canal que recebeu ou enviou cada mensagem.

Esta entrega prepara a operação humana. A triagem automática com OpenAI, a fila seletiva por classificação e as ferramentas do KOA descritas no documento de referência ainda não estão habilitadas. Devolver à Triagem não inicia respostas automáticas.

## Operação

- Clicar na fase abaixo do nome abre o menu. Em atendimento exige assumir o caso; a reserva é exclusiva e validada no banco.
- Pendentes exige motivo. Resolver exige uma conclusão e confirmação na interface. Um caso resolvido pode ser retomado ou dar origem a um novo pedido explícito na mesma conversa.
- O botão de duas setas abre **Transferir conversa**. O operador informa tipo de pedido, resumo, motivo e escolhe um destino retornado pelo servidor.
- O destino recebe o caso na Triagem e precisa assumir antes de responder. A troca de fase atualiza listas e contagens por polling, inclusive em outras sessões autorizadas. O chat aberto permanece visível quando sai do filtro atual.
- Quando há mudança de canal, a origem e suas mensagens são preservadas. A conversa de continuidade só é criada em canal conectado e autorizado. A continuidade permanece pendente até um envio humano confirmado; a interface orienta informar ao cliente a mudança de número.
- Se já existe uma conversa no canal de destino, a transferência exige revisão e não une solicitações pelo telefone automaticamente. Nesta versão, esse vínculo precisa de revisão antes de prosseguir.
- Um envio reservado ou sem confirmação bloqueia movimentações conflitantes. Erros e versões desatualizadas são mostrados sem anunciar sucesso.

## Contas e canais

Em Configurações/Atendimento, o proprietário do canal pode autorizar outra conta confirmada e integrante da mesma organização a atender ou supervisionar. A atribuição de um caso não concede acesso geral ao canal de origem.

Na conferência do staging desta entrega:

- `relacionamento@grupoejcorp.com.br` ainda não tinha cadastro.
- `comercial04@grupoejccorp.com.br` existia, confirmado, em uma organização diferente da conexão de teste existente.
- A única conexão gerenciada encontrada estava desconectada. Nenhuma sessão antiga foi atribuída a essas pessoas, reiniciada ou excluída.

Para operar entre Luísa e Fernando, é necessário cadastrar/vincular as contas à organização correta, confirmar os dois canais reais e conceder os acessos apropriados. Os endereços acima foram preservados exatamente como informados. O cadastro da conta KOA/SDR permanece a cargo do usuário e não habilita automação sozinho.

## Persistência e publicação

Migrações aplicadas apenas no Supabase de homologação `ukahtcymdcjphvptjamz`:

1. `20261021201659_whatsapp_case_phases_transfer.sql`
2. `20261021201821_whatsapp_case_security_review.sql`

As 226 conversas existentes receberam um caso atual: 225 em triagem manual e uma resolvida. Não foi inventado responsável para históricos antigos nem disparado reprocessamento por IA.

O preview usa o alias de homologação já existente:

[Abrir chat de homologação](https://kortex-usuarios-git-codex-wh-9dffcd-kauaalmeidago-hubs-projects.vercel.app/inbox)

A proteção de acesso da Vercel foi mantida, sem criar credencial de bypass. A publicação é feita em diretório isolado com o ambiente de staging, sem incluir alterações locais independentes de roteamento/autenticação ou do automation-server. A produção e seu banco não receberam esta entrega.

## Verificações

- Backend WhatsApp: 45 testes, incluindo autorização das novas rotas e reserva de envio.
- Interface: testes de fases/transferência, isolamento de cache, preservação de conversa ao filtrar e resposta a mensagem; TypeScript e lint dos arquivos alterados.
- `node scripts/isolation/whatsapp-cases-verify.mjs`: 12 verificações em PostgreSQL isolado, com contas e mensagens sintéticas. Incluem RLS, destinos proibidos/desconectados, atribuição exclusiva, versão, continuidade entre canais, reabertura e contagens acima de 250 casos.
- Inspeção visual com dados sintéticos: mudança de fase manteve o chat aberto e atualizou a contagem; modal de transferência inspecionado em 1366, 1440, 1024 e 390 pixels sem transbordamento horizontal. Evidências locais em `outputs/whatsapp-cases/`.
- A interação final no navegador foi interrompida porque o controle do navegador foi desativado nas configurações do Work. Não foi realizada transferência entre contas reais nem envio de mensagem a cliente como teste.

O servidor visual isolado pode ser iniciado com `node scripts/inbox-case-preview.mjs`; ele usa apenas os fixtures de teste e não acessa Supabase/Evolution.

## Lançamento em produção solicitado em 21/10/2026

As contas confirmadas são `relacionamento@grupoejccorp.com.br` (Luísa, identidade confirmada pelo usuário) e `comercial04@grupoejccorp.com.br` (Fernando). O endereço anterior de Relacionamento, com apenas um “c”, não era o cadastro real.

O provisionamento administrativo vincula Fernando como membro ao espaço da equipe já utilizado por Relacionamento, no setor Comercial, preservando seu espaço pessoal. Esse vínculo não recebe criação, despacho ou administração de quadros de tarefas. Fernando pode operar seu canal e o de Luísa; Luísa mantém apenas o próprio canal. As conexões são novas e precisam do pareamento humano dos números corretos. Nenhuma sessão antiga é atribuída automaticamente a essas pessoas.

O Chat passa a consultar os vínculos de setor autorizados por RLS, sem depender de quadros de Tarefas/Pipeline. Em **Atendimento**, o usuário pode selecionar a organização da Equipe e seu setor, depois solicitar o QR Code. A escolha de organização permanece explícita quando existem vários espaços autorizados.

As nove migrações WhatsApp desta branch foram aplicadas no Supabase de produção após backup verificado, preservando os IDs e as contagens dos registros anteriores. O ingress autenticado `whatsapp-events` foi publicado nesse projeto e o relay separado `evolution-production` atende a fila de produção. A homologação mantém seu próprio banco, credenciais e worker.

O portal de destino é [Kortex dos usuários](https://kortex-usuarios.vercel.app/inbox). O build da Vercel executa TypeScript antes de publicar. O acesso ao pareamento fica no menu **Atendimento**, sem incluir credenciais no frontend ou criar bypass da Vercel. A triagem automática com OpenAI continua desabilitada nesta entrega; o lançamento cobre atendimento humano, etapas e transferência.

O computador local, o Docker e a Evolution precisam permanecer ligados para disponibilizar QR e atendimento. O worker de produção usa reinício `unless-stopped`. Os relatórios locais de migração e provisionamento estão em `outputs/whatsapp-production/`; os backups e segredos permanecem ignorados pelo Git.

Publicação concluída: deployment `dpl_8iEvvRQsjft5GVgQsFnsWb8Aex2L`, fonte `3da27a9`, estado `READY`, alias `https://kortex-usuarios.vercel.app`. O build executou TypeScript e Vite com sucesso. Login, Chat e Atendimento responderam HTTP 200; a API de contextos recusou acesso sem sessão com HTTP 401. Isso valida a publicação e o bloqueio de acesso, sem substituir a conferência da interface numa sessão autenticada.

O backend gerou QR Codes reais para os dois canais de produção em 21/10/2026. Os testes não parearam telefones nem enviaram mensagens. Cada pessoa deve entrar em sua conta, abrir **Atendimento**, selecionar a organização marcada **Equipe** e o setor correto, solicitar um QR atualizado e escanear com seu WhatsApp. A transferência que exige mudança de número permanece condicionada ao canal de destino conectado. O webhook confirmou 405 para GET, 401 sem credencial e 404 para credencial válida com instância inexistente.
