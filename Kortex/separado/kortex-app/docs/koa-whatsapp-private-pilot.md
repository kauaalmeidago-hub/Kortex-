# KOA no privado — piloto de tarefas

Ativado em **22/10/2026** no número já conectado, final **9286**. Conforme a autorização da administração, qualquer número pode iniciar o atendimento privado chamando **KOA**, sem cadastro na plataforma ou participação em grupos. Os grupos estão desativados nesta fase.

## Como testar

Usar outro número de WhatsApp e enviar ao KOA:

> KOA, crie uma tarefa de teste para Comercial revisar o procedimento interno.

O KOA pergunta somente os dados essenciais ausentes e confirma o registro depois da gravação na plataforma. A chamada abre uma sessão individual de 30 minutos; os complementos dessa sessão não precisam repetir o nome. Depois desse período, chamar KOA novamente. Mensagens enviadas pelo próprio número do robô são ignoradas.

Os destinos atuais são **Comercial** (`comercial01@grupoejccorp.com.br`) e **Relacionamento** (`relacionamento@grupoejccorp.com.br`). Os quadros, responsáveis, autorizações e etapas iniciais foram conferidos. O servidor escolhe esses destinos pela configuração existente; o contato não fornece IDs nem escolhe outros espaços da plataforma.

## Habilidades disponíveis

Conversar e orientar; interpretar texto e arquivos suportados quando enviados no pedido; esclarecer a entrega e o setor; registrar novos pedidos; verificar equivalência com tarefas já existentes; confirmar somente resultados reais. Respostas e contexto permanecem no mesmo privado. Uma saudação, agradecimento ou dúvida de procedimento não cria tarefa.

O fluxo do WhatsApp ainda não aciona portais de operadoras, altera/conclui tarefas nem consulta dados de outras pessoas. O SDR Comercial é um serviço separado de qualificação de leads.

## Operação e evidências

O serviço `kortex-koa-whatsapp` usa a imagem `kortex/koa-whatsapp:20261022-private-call`, com a mesma sessão Evolution, webhook autenticado e volume SQLite. Configuração privada: `KOA_PRIVATE_MESSAGES=true`, `KOA_PRIVATE_POLICY=koa_call`, `KOA_GROUP_MESSAGES=false` e nova ativação em `KOA_PRIVATE_ACTIVATED_AT`. As credenciais existentes foram preservadas. A máquina, Docker e Evolution precisam ficar ligados.

Na ativação, o serviço confirmou `connection=open`, `privateReady=true`, `privatePolicy=koa_call` e `groupConversations=false`. A Evolution alcançou a nova instância do worker pelo endereço interno do webhook. Uma requisição autenticada sem chamada ao KOA foi ignorada e não gravou mensagens nem enviou resposta.

Passaram 70 testes automatizados, dez cenários sintéticos usando a IA configurada e um teste de criação/idempotência/isolamento no banco, integralmente revertido. Esses testes não enviaram mensagem a contatos reais. O recebimento e a resposta no celular ainda devem ser validados pelo operador com o exemplo acima.

O serviço anterior foi preservado parado em `kortex-koa-whatsapp-before-private-20261022`. O SQLite recebeu backup antes da troca; a atualização adiciona somente a tabela local de sessões. Não foram recriadas, desconectadas ou excluídas sessões Evolution. Os relatórios privados ficam em `outputs/koa-readiness/`, ignorados pelo Git.
