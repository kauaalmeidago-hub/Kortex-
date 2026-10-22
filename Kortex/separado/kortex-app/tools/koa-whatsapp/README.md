# Atendimento simultâneo do KOA

O webhook persiste a mensagem e aciona o atendimento imediatamente. O agendador
mantém até oito solicitações em andamento. Cada participante de cada grupo tem
sua própria fila: uma chamada lenta à IA, leitura de arquivo ou envio não ocupa
as filas das outras pessoas. As mensagens e as partes de uma mesma resposta
permanecem em ordem para preservar o histórico daquele participante.

`KOA_CONCURRENCY` configura de 1 a 32 atendimentos simultâneos (padrão: 8).
`KOA_CHANNEL_ID` continua funcionando com o grupo atual. Para atender mais grupos
previamente cadastrados e autorizados, use `KOA_CHANNEL_IDS` com os UUIDs dos
canais separados por vírgula. Cada canal conserva seu ator, workspace, destinos,
ativação e controles de pausa. Não configure o mesmo JID em dois canais deste
processo, pois o histórico local é isolado por JID e participante. Os webhooks das
instâncias configuradas devem apontar para este serviço.

O processo verifica conexão e publica heartbeat a cada 15 segundos, de forma
independente dos atendimentos. O recebimento de canais habilitados usa a última
configuração carregada e grava localmente, sem esperar consultas remotas. Canais
desconhecidos ou pausados atualizam a configuração para detectar ativações. O
processamento compartilha a configuração por até um segundo; cada envio revalida
a autorização no banco. O temporizador de 250 ms
serve para retomar filas após falhas ou limites de envio. Novas mensagens e a
conclusão de um atendimento acionam o agendador sem esperar esse temporizador.

Os limites existentes de 25 mensagens por grupo/minuto e 8 por participante/minuto
incluem envios em andamento e de resultado incerto. O sistema conserva o plano
de resposta e a idempotência da criação de tarefas. Envios incertos nunca são
repetidos automaticamente. A latência final ainda depende da IA, da rede e do
WhatsApp; a simultaneidade elimina a espera por outros participantes até a
capacidade configurada.

`GET /health` informa conexão, capacidade, atendimentos ativos, mensagens pendentes
e idade da mensagem pendente mais antiga, sem conteúdo das conversas.

## Piloto privado por chamada ao KOA

Em 22/10/2026, a administração autorizou qualquer número a iniciar o privado
chamando **KOA**, sem exigir participação em grupos. A configuração deste piloto
é `KOA_PRIVATE_MESSAGES=true`, `KOA_PRIVATE_POLICY=koa_call` e
`KOA_GROUP_MESSAGES=false`. `KOA_PRIVATE_ACTIVATED_AT` marca o início; mensagens
antigas não abrem sessões. A configuração padrão continua sendo `group_members`
e grupos habilitados, para preservar outras instalações.

A primeira chamada abre uma sessão individual por 30 minutos; os complementos
dessa sessão não precisam repetir KOA. Uma nova chamada renova o período. A
sessão é persistida no SQLite e limitada à mesma instância, canal e contato.
Mensagens enviadas pelo próprio número do robô são ignoradas. Este modo exige
um único canal de destino por instância e não escolhe um workspace arbitrário.

O KOA responde no mesmo privado, faz as perguntas essenciais e registra novas
tarefas nos destinos já autorizados. Somente o resultado real do banco gera a
confirmação. Ele não publica no grupo nem consulta participantes nesse modo.
O status expõe `privatePolicy`, `privateReady` e `groupConversations`; o heartbeat
também contabiliza o recebimento e as respostas privadas do canal.

Esta autorização de entrada não habilita execução em portais de operadoras,
consulta a tarefas alheias, alteração ou conclusão de tarefas. Para testar,
outro número deve enviar “KOA, crie uma tarefa de teste para Comercial revisar
o procedimento interno”.

Execute `npm test` nesta pasta. Os testes usam SQLite real e transportes simulados;
não enviam mensagens ao WhatsApp. Cobrem concorrência, ordem, grupos distintos,
continuação de contexto, webhook durante processamento, heartbeat lento,
revogação, limites de envio, duplicidade e parada com preservação da fila.

Para empacotar, use a raiz de `kortex-app` como contexto:

```powershell
docker build -f tools/koa-whatsapp/Dockerfile -t kortex/koa-whatsapp:concurrent .
```

Execute um único processo sobre o volume SQLite. Para atualizar, aguarde a parada
graciosa do contêiner anterior antes de iniciar o novo no mesmo volume. Preserve
o contêiner anterior parado para reversão. Não execute duas réplicas sobre o mesmo
arquivo. A configuração atual e o volume persistente continuam válidos.
