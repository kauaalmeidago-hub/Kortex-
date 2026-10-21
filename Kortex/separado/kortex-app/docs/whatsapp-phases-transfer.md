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
