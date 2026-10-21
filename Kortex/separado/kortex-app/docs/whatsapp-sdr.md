# KOA · SDR Comercial e conexões dos usuários

O canal principal do Comercial pertence a `suportealaive@gmail.com`, confirmado como conta do SDR. O nome do canal é **KOA · SDR Comercial**, com prioridade zero. O perfil administrativo da conta permanece preservado. O canal fica primeiro nos destinos de transferência e o Comercial é o contexto inicial do suporte, salvo uma preferência explícita do usuário.

Foram provisionados canais próprios para as cinco contas humanas confirmadas com setor autorizado: Suporte/KOA, Comercial 01, Fernando, Luísa e Kauã. A conta técnica interna, sem setor, não recebeu telefone nem permissões inventadas. O pareamento continua disponível às demais contas autenticadas que possuam vínculo real com um setor. Um QR válido precisa ser lido no celular correspondente; provisionar um canal não comprova que um telefone está conectado.

## Qualificação inicial

Somente o canal marcado SDR e habilitado processa novas mensagens recebidas depois da ativação. O KOA reutiliza, no backend, o provedor OpenAI configurado pelo proprietário no mesmo espaço da equipe. O modelo continua configurável nessa conexão; os testes usaram o `gpt-4.1-mini` já existente. A chave permanece no Vault e nunca entra no navegador ou no contexto do modelo.

A qualificação reúne nome da pessoa, município/região, modalidade e quantidade de vidas. O assistente usa o contexto recente do mesmo atendimento, reúne fragmentos por cinco segundos e faz uma pergunta curta de cada vez. Ao completar os dados, receber pedido de humano ou atingir o limite de oito respostas, prepara o resumo para Fernando na Triagem. Fernando precisa assumir para iniciar atendimento humano. Assuntos fora do Comercial também chegam para revisão humana; não são enviados automaticamente para todas as filas.

Este fluxo não oferece cotação, cobertura, rede, preços, elegibilidade, orientação médica ou execução de movimentações. Áudios e anexos exigem revisão humana e não são tratados como conteúdo já interpretado. O prompt é versionado em `server/whatsapp/sdr.mjs`, separado das instruções de gestão de tarefas. A implementação utiliza [Responses e Structured Outputs da OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), com validação adicional no servidor.

## Controle e falhas

O proprietário pode pausar/ativar o KOA em **Atendimento · Canais e responsáveis**. O serviço exige canal conectado, concessões atuais e atendimento em Triagem sem atribuição/posse humana. Assumir durante a inferência invalida a resposta antes de reservar o envio. Depois da reserva, um envio pendente ou incerto bloqueia movimentos conflitantes; ele não é repetido automaticamente.

Não há reprocessamento do histórico antigo nem resposta automática nos outros números. A chegada de mensagem a um caso resolvido continua sujeita a revisão humana. Atendimentos já assumidos ou encaminhados não retornam sozinhos ao robô. Falha de inferência, chave ou envio resulta em pendência para revisão, preservando o atendimento.

## Transferência e operação

Os operadores do Comercial receberam acessos explícitos aos canais comerciais da mesma equipe. O suporte supervisiona os canais dessa equipe. Luísa continua sem acesso geral aos canais comerciais e atende Relacionamento pelo próprio número. O espaço pessoal de Kauã permanece separado.

Depois de uma transferência entre números, a interface seleciona a conversa de continuidade retornada pelo servidor e mantém o chat aberto mesmo fora do filtro atual. As mensagens antigas continuam pertencendo ao canal original; elas não são copiadas para o novo número. A nova conversa também cria um contexto separado de composição e citação.

Os testes isolados cobrem transferência entre canais, origem e histórico, exclusividade, destinos proibidos/desconectados, RLS, fila de SDR, fragmentos, tomada humana durante inferência e confirmação de envio. A verificação com as contas reais de produção ocorreu numa transação revertida: o estado conectado do destino foi simulado apenas dentro dela, sem enviar mensagem, parear telefone ou deixar contato de teste. Ela valida as permissões e a persistência, sem comprovar entrega entre números reais ainda não pareados.

O teste do provedor usou mensagens sintéticas, incluindo solicitação incompleta, dados completos e pedido de pessoa. Relatórios locais: `outputs/whatsapp-production/all-accounts.json`, `transfer-checks.json` e `sdr-provider-checks.json`. Os segredos, dumps e configurações locais não são versionados.

O worker SDR é separado do relay e usa somente a configuração privada necessária para Supabase e o ID da fila. O computador, Docker e Evolution precisam estar ligados. O container usa reinício `unless-stopped`; isso não liga o computador nem inicia o Docker desligado.
