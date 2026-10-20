# Chat WhatsApp e onboarding — 20/10/2026

Implementação preparada sobre a fonte atual de `Kortex/separado/kortex-app`, preservando os ajustes locais de autenticação, identidade visual, Tarefas, Pipeline e KOA. O projeto existente é `kortex-usuarios`, ID `prj_s31Vluek0LXh3vTmRtlefPk28tCC`, da equipe `kauaalmeidago-hubs-projects`.

**Estado da entrega: homologação. O pareamento real e a publicação em produção dependem do servidor Evolution persistente e acessível por HTTPS.** O sucesso do build e os testes com transportes simulados não comprovam pareamento, recebimento ou envio real de WhatsApp.

## Comportamento implementado

- Cadastro pelo backend da plataforma, respeitando a confirmação de e-mail do Supabase. Contas existentes não recebem autorização para uma instância por repetirem o cadastro.
- Prova de criação capturada exclusivamente no `INSERT` de `auth.users`. Alterar metadados de uma conta ainda não confirmada não pode fabricar essa prova. Reserva de cadastro e limites por e-mail/IP evitam concorrência e abuso.
- Token opaco de onboarding com validade de 24 horas, cookie `HttpOnly; Secure; SameSite=Lax` e somente hash no banco. Permite preparar, renovar e consultar o próprio pareamento; recusa conversas, arquivos, envios e desconexão.
- Modal responsivo baseado no anexo, largura máxima de 920 px, QR de 240 px no desktop, quatro passos e botão liberado apenas após `instance.state === 'open'` confirmado pela Evolution. O QR não recebe logotipo sobreposto. A imagem expira e é retirada da tela.
- Fechar o modal permite retomá-lo; uma conta nova com onboarding pendente é redirecionada ao tentar entrar manualmente no portal. O retorno do e-mail recupera a instância pendente e consome o token temporário.
- Chat e gerenciamento do WhatsApp ficam acessíveis aos usuários autorizados. Os demais módulos preservam suas restrições. Usuários existentes podem utilizar Tarefas/Pipeline sem parear WhatsApp.
- Interface existente de conversas conectada aos endpoints autenticados, sem as conversas demonstrativas: filtros/status, busca nas últimas 250 conversas, mensagens em páginas de 50, citação e status reais de envio.
- Anexos enviados diretamente ao Storage privado, limite operacional de 20 MB, prévia de imagem/áudio e gravação com permissão explícita de microfone. Download autorizado emite URL temporária de 60 segundos. Vídeo, documentos, imagens e áudio usam as operações do adaptador.
- Caixa de saída com chave de idempotência. Cliques repetidos e eco do webhook não geram novas mensagens. Resultado incerto fica bloqueado; quando existe ID do provedor, a nova consulta reconcilia antes de qualquer repetição.
- Perfil exibe os dados disponíveis da conversa. Transferência entre operadores, telefonia e integração da conversa com funil permanecem explicitamente indisponíveis; não há simulação dessas operações.
- Sair da Kortex não chama logout da Evolution. Desconexão explícita requer confirmação.

## Backend, isolamento e recuperação

`api/whatsapp.ts` e `api/whatsapp-webhook.ts` são funções do projeto Vercel. As sessões de dispositivo permanecem na infraestrutura da Evolution, nunca no disco temporário dessas funções.

O adaptador foi conferido contra o código oficial da Evolution **2.3.7**, versão fixada na infraestrutura Docker encontrada. Essa versão ainda precisa ser confirmada no servidor real: o adaptador recusa criar instâncias se a versão não corresponder.

Cada conexão possui proprietário, organização e setor. A API valida o usuário no Supabase e consulta os vínculos de `business_contexts`; o setor editável do perfil não concede acesso. Não existe instância global. O banco impede vincular silenciosamente o mesmo número conectado a outra conta. Compartilhamento adicional entre operadores não foi introduzido.

Tabelas com QR, tokens, eventos e caixa de saída são exclusivas do servidor. Conversas, mensagens e Storage aplicam políticas de acesso pela mesma conexão/conta/setor. Conteúdo de mensagens é persistido como dado, sem disparar comandos administrativos ou novos envios automáticos.

Webhooks usam o header configurado na própria instância, `x-kortex-webhook-secret`, suportado pela versão consultada. O payload com chave administrativa do provedor é descartado; apenas campos normalizados são persistidos. A função SQL grava a identificação do evento e aplica mensagens/recibos na mesma transação antes da resposta HTTP. Repetições são deduplicadas por conexão e ID do provedor. Recibos antecipados são guardados e o status não regride quando chegam eventos antigos.

A atualização da interface usa consultas autenticadas a cada quatro segundos; o fechamento da tela cancela consultas e gravação. Dados e resultados antigos são descartados na troca de contexto.

`server/whatsapp/worker.mjs` é o processo persistente de recuperação/importação. Importa o histórico disponibilizado pelo provedor em lotes de 100, guarda o cursor no banco e reconcilia novamente após falhas. Não promete recuperar todo o histórico anterior ao pareamento. A interface informa essa limitação. A limpeza de instâncias nunca ativadas após sete dias usa exclusão mútua com a ativação; conexões ativadas não são apagadas por esse processo. Grants/reservas expirados também são limpos.

**O worker está preparado e precisa ser instalado ao lado da Evolution existente. Um preview da Vercel não executa esse processo de forma contínua.** O Dockerfile está em `deploy/whatsapp-chat/Dockerfile`; não foi contratada infraestrutura nova.

## Configuração privada

Configurar separadamente em preview e produção:

| Nome | Uso |
| --- | --- |
| `SUPABASE_URL` | Projeto do ambiente correspondente |
| `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` | Backend/worker, nunca frontend |
| `SUPABASE_PUBLISHABLE_KEY` | Cliente público usado pelo backend para validar o usuário |
| `EVOLUTION_API_URL` ou `EVOLUTION_API_BASE_URL` | Endereço HTTPS do servidor persistente |
| `EVOLUTION_API_KEY` | Credencial privada da Evolution |
| `EVOLUTION_WEBHOOK_SECRET` | Header secreto configurado nas novas instâncias |
| `WHATSAPP_WEBHOOK_URL` | URL HTTPS de `/api/whatsapp-webhook` no ambiente correto |
| `APP_ORIGIN` | Origem do portal em produção; previews também aceitam seu `VERCEL_URL` |
| `WHATSAPP_ALLOWED_ORIGINS` | Origens adicionais explícitas, separadas por vírgula, se necessárias |
| `WHATSAPP_ENABLE_GROUPS` | Mantido `false`; grupos exigem habilitação explícita |

Os nomes públicos `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID` e `VITE_SUPABASE_PUBLISHABLE_KEY` permanecem os atuais. Nenhuma `VITE_EVOLUTION_API_KEY` foi criada. O arquivo `deploy/whatsapp-chat/.env.example` contém apenas nomes e campos vazios.

## Arquivos principais e migrações

- `src/features/whatsapp/`: modal, onboarding, cliente HTTP, consultas de conversas e composer.
- `src/pages/AuthPage.tsx`, `src/components/ProtectedRoute.tsx`: cadastro seguro e proteção do onboarding.
- `src/pages/InboxPage.tsx`, `src/pages/WhatsAppConnectionPage.tsx`: dados reais e reutilização do modal.
- `src/App.tsx`, `src/components/AppSidebar.tsx`: rotas e acesso ao Chat.
- `api/`, `server/whatsapp/`: endpoints, autorização, adaptador, envio, importação e testes do backend.
- `vercel.json`, `.vercelignore`: rotas de API e inclusão do módulo compartilhado já utilizado por Tarefas no pacote de build.
- `scripts/whatsapp/`: verificação isolada de banco e aplicação idempotente exclusivamente em staging.

Migrações novas, aplicadas somente ao projeto staging `ukahtcymdcjphvptjamz`:

1. `20261020210000_whatsapp_chat.sql`
2. `20261020211000_whatsapp_read.sql`
3. `20261020212000_whatsapp_onboarding.sql`
4. `20261020213000_whatsapp_signup_proof.sql`
5. `20261020214000_whatsapp_cleanup_guard.sql`

## Validação e dependências de publicação

- Build de produção local aprovado; bundle com aviso de tamanho já existente. Preview Vercel compilado com funções backend e configuração exclusiva do Supabase staging.
- 352 testes de interface/regressão aprovados, incluindo autenticação, Tarefas, Pipeline e chat administrativo.
- 16 testes de backend aprovados com transportes/controladores simulados.
- PostgreSQL isolado: políticas, arquivos privados, deduplicação, recibos fora de ordem, revogação, criação real de cadastro, idempotência de ativação e exclusão mútua com limpeza.
- Verificação visual automatizada em 1366×768, 1024×768 e 390×844: limites do modal, QR quadrado, ausência de overflow horizontal, rolagem e Escape/retomada. O QR desse teste é uma fixture identificada, sem capacidade de pareamento.
- Verificação HTTP do preview com uma conta não confirmada criada no Supabase staging real: acesso sem autenticação recusado; token temporário impedido de acessar conversas, arquivos, envio e desconexão; tokens alterados/expirados recusados; novo cadastro do mesmo e-mail não assume a conexão existente. A tentativa de preparar o QR retorna `503 PROVIDER_NOT_CONFIGURED`, sem QR ou sucesso fictício. As contas de teste foram removidas. Evidências em `outputs/whatsapp/preview-smoke.json`.
- TypeScript sem erros. Lint dos arquivos novos e das mudanças de autenticação sem erros; `InboxPage.tsx` mantém um aviso anterior de dependência de efeito no painel operacional KOA.

O endereço encontrado na configuração legada foi `http://localhost:8081`, com conexão recusada. O worker administrativo existente usa `http://evolution-api:8080`, um nome interno de rede Docker. O Docker estava sem daemon disponível na inspeção. Iniciar o aplicativo Docker não comprova acesso HTTPS, persistência e disponibilidade externa. Não foi encontrado um servidor Evolution público configurado para o portal, nem acesso verificado a uma VPS onde instalar o novo worker.

Para concluir a homologação, faltam: servidor Evolution operacional/persistente com HTTPS, credenciais privadas correspondentes, webhook atingível pelo provedor, worker ativo e leitura física do QR com conta/número de teste autorizado. Depois disso devem ser homologados pareamento, retorno do e-mail, histórico, recebimento, envio, anexos, áudio, queda/reconexão e troca de setor na integração real. Somente então aplicar as migrações em produção e publicar o build verificado no domínio `kortex-usuarios.vercel.app`.

## Publicação e fonte

- Branch da entrega: `codex/whatsapp-onboarding`. A sincronização inclui a fonte atual da interface e as migrações locais anteriores necessárias a ela; os arquivos de automação locais fora desse escopo foram preservados.
- Preview: [modal e onboarding](https://kortex-usuarios-rh5yytg9h-kauaalmeidago-hubs-projects.vercel.app/auth/whatsapp).
- Deployment: `dpl_HuCm3XKMyCdM2SDuUBkbVVqyrNV2`, estado final `READY`, projeto `kortex-usuarios`, ambiente preview, Supabase `ukahtcymdcjphvptjamz`.
- O preview mantém a autenticação de proteção da Vercel e requer acesso ao projeto para ser aberto. O smoke usa o acesso autenticado da CLI.
- Produção continua no deployment existente `dpl_Co5quHhHJLm1W8WuwPtC2RTkxCRR`, estado `READY`, associado ao domínio informado pelo usuário. As migrações e o novo Chat desta entrega não foram publicados nesse ambiente, pois a integração real ainda depende dos itens acima.

## Referências conferidas

- [Rotas da Evolution 2.3.7](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/routes/instance.router.ts)
- [Webhooks e headers da Evolution 2.3.7](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.controller.ts)
- [Cadastro no Supabase](https://supabase.com/docs/reference/javascript/auth-signup)
- [Publicação na Vercel](https://vercel.com/docs/deployments)
