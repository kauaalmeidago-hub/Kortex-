# KOA Comercial — proposta dentro do atendimento

O botão **Elaborar proposta** na conversa abre um painel com duas abas. **Assistente** analisa o contexto do cliente e prepara orientações e mensagens para o vendedor. **Proposta** organiza os dados confirmados, as opções cotadas e a apresentação comercial revisável.

## Comportamento implementado

- O painel segue a conversa selecionada. Rascunhos são separados por usuário, workspace e conversa, mantidos em memória enquanto a página estiver aberta. Fechar o painel preserva o rascunho; recarregar/sair da página o descarta. Não há gravação de dados do cliente em localStorage.
- A troca de usuário ou workspace limpa os rascunhos. A troca de cliente cancela a chamada pendente e impede que uma resposta anterior apareça no atendimento seguinte. Se a conversa ou o formulário mudar durante a análise, o resultado é descartado.
- A IA recebe somente o cliente aberto, até 30 mensagens recentes (1.500 caracteres por mensagem), os dados da proposta e, quando selecionada, uma oportunidade autorizada no servidor. Telefone, CPF/CNPJ, credenciais de portais e outros cadastros não são adicionados automaticamente ao contexto.
- A lista de oportunidades consulta negócios criados pelo vendedor ou atribuídos a ele no workspace ativo. O vínculo é escolhido explicitamente; não há associação por semelhança de nomes. O backend confirma equipe e acesso ao negócio antes de consultar o modelo.
- O formulário aceita saúde, odontológico e vida. Não presume que o número de funcionários é o total de vidas; esse dado precisa ser confirmado pelo vendedor.
- Cada opção precisa de operadora, produto, valor mensal total, origem, validade vigente e condições verificadas. Valores seguem o formato brasileiro: `1.234,56`. A validade é conferida no fuso de São Paulo. O limite é cinco opções por rascunho.
- A apresentação comercial é gerada a partir dos campos revisados, com origem e validade de cada cotação. O texto gerado pela IA não preenche automaticamente preços nem condições.
- **Inserir no campo de mensagem** adiciona o texto ao que o vendedor já escreveu, sem enviar. A inserção não reaparece ao voltar a outra conversa. A apresentação comercial não é a proposta oficial emitida pela operadora.

## Backend de IA

Função: `supabase/functions/koa-sales-assistant/index.ts`.

Autenticação: JWT de usuário validado pelo Supabase e novamente por `auth.getUser`. O cliente do banco usa a sessão do solicitante e a chave pública, respeitando RLS. Não há uso de chave administrativa. O endpoint exige associação ao workspace. Quando há `leadId`, o negócio deve estar no mesmo workspace e pertencer ao vendedor; administradores do workspace também podem acessá-lo.

A função utiliza a API Responses da OpenAI com saída JSON estruturada e `store: false`. O prompt trata as mensagens e observações como dados não confiáveis, restringe a análise ao cliente selecionado e proíbe inventar condições comerciais. A resposta é validada antes de retornar. Não há logs de conversas, prompts, cotações ou segredos no código da função. O processamento tem limite de 65.000 bytes por requisição e 25 segundos para a chamada ao modelo.

Variáveis necessárias **somente no backend**:

| Variável | Uso |
| --- | --- |
| `OPENAI_API_KEY` | Credencial da conta que fará as chamadas de IA |
| `OPENAI_SALES_MODEL` | ID de modelo disponível nessa conta, com Responses e Structured Outputs |
| `SUPABASE_URL` | URL fornecida pelo ambiente de Edge Functions |
| `SUPABASE_ANON_KEY` | Chave pública fornecida pelo ambiente, utilizada junto ao JWT do vendedor |

Configure os segredos pelo painel do Supabase ou pelo procedimento de deploy da equipe, e publique a função no mesmo projeto configurado no frontend. Não coloque a chave OpenAI em variável `VITE_*`, no navegador ou em arquivo versionado. `verify_jwt` permanece habilitado em `supabase/config.toml`. A interface apresenta erro de configuração ou autenticação sem simular uma resposta de IA.

Documentação consultada:

- https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/secrets

## Limites da integração atual

Nesta base do repositório, `InboxPage` e `PipelinePage` usam conversas e cards demonstrativos em estado local; `/auth/*` redireciona para a página inicial. Este recurso não substitui a origem desses dados nem modifica o comportamento de autenticação existente. A análise real exige uma sessão autenticada disponível no `AuthContext` e a função publicada/configurada. A seleção de oportunidades, quando autenticado, consulta o banco real, não a lista demonstrativa de cards.

Não há nesta entrega persistência de propostas, PDF, disparo externo pelo WhatsApp, alteração automática de etapas, criação de tarefas ou contratação. Essas operações dependem da conexão real do chat/funil e de eventos confirmados de envio/contratação. O rascunho atual tem escopo de sessão, explicitado no painel. O módulo evita marcar uma venda como concluída por gerar um texto ou inserir uma sugestão no compositor.

Não foi realizada publicação da função, configuração de segredos ou alteração no banco de produção. Para ativação, ainda é necessário configurar modelo e credencial no backend, publicar a função e disponibilizar uma sessão autenticada. A chamada real ao provedor não foi executada neste ambiente, que não possui chave OpenAI configurada.

## Verificação

Foram verificados: compilação de produção; tipos do aplicativo; tipos da função no Deno com as dependências locais; testes de contexto por cliente, cancelamento, revisão de mensagens, valores/validade e contrato do endpoint; e o percurso no navegador, com cotação explicitamente fictícia, até a inserção do texto no campo de mensagem.

Os testes do endpoint usam dependências controladas e não substituem a validação de um JWT, RLS e chamada ao modelo no ambiente publicado. Não houve envio externo de mensagens durante a verificação.
