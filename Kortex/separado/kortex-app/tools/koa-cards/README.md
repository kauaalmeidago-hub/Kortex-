# Carteirinha pelo WhatsApp

O número do KOA recebe o pedido no privado depois da palavra **KOA**. O bot envia
um link HTTPS de uso único, válido por dez minutos, em `/koa/carteirinha#token`.
O token fica no fragmento e não é enviado nos logs de URL do servidor.

O beneficiário informa o próprio nome, CPF, nascimento, operadora e acesso
temporário da empresa. O navegador cifra os dados com AES-GCM e a chave pública
RSA do worker Windows. Somente esse computador pode abrir o pedido. O acesso
não é cadastrado como empresa, não entra no modelo de IA e não fica em um cofre
reutilizável. O conteúdo cifrado é removido ao encerrar ou expirar o pedido.

O worker usa a ferramenta local de carteirinhas em um navegador novo para cada
pedido. Exige uma única correspondência exata de nome, CPF e nascimento na
operadora, seleciona somente essa pessoa e valida o PDF nativo. Se o portal
não expuser esses dados, ou houver divergência/ambiguidade, encerra sem enviar
documento. Esta conferência cadastral não equivale a autenticação biométrica.
Dependentes, lotes e grupos não são atendidos por este fluxo.

O PDF é enviado como documento somente ao privado que iniciou o pedido, sem
URL pública. Cancelamento e permissões são revalidados antes da entrega; um
envio com resultado incerto não é repetido automaticamente. Há limite de três
pedidos por hora por número. Nenhum acesso antigo de outra conta é reaproveitado.

## Ativação local

1. Compilar `automation-server/tsconfig.json` com saída em
   `automation-server/tmp/whatsapp-card-runtime/dist`.
2. Aplicar `20261022140000_whatsapp_self_service_cards.sql` pelo processo de
   publicação com backup verificado. As duas tabelas têm RLS e acesso apenas
   pelo serviço.
3. Fornecer um arquivo local ignorado com `DATABASE_URL`, `SUPABASE_URL` e
   `EVOLUTION_API_KEY`; a URL Evolution no Windows é `http://127.0.0.1:8081`.
   Não colocar a senha de uma empresa nesse arquivo.
4. Executar `tools/koa-cards/install.ps1 -EnvFile <caminho absoluto>`.
   O serviço inicia oculto, reinicia após falha e volta no login do Windows.
   A chave privada fica protegida por DPAPI em `%LOCALAPPDATA%/Kortex/WhatsAppCards`.
5. Publicar o formulário e a API na produção; então habilitar
   `KOA_CARDS_ENABLED=true` e `KOA_PORTAL_ORIGIN=https://kortex-usuarios.vercel.app`
   no bot Docker, preservando o volume, a sessão e a data de ativação privada.

O computador, Docker, Chrome e a conexão devem estar disponíveis. O bot só
oferece o formulário enquanto o worker local mantém heartbeat. Para testar,
envie **“KOA, emita minha carteirinha”** de outro WhatsApp para o número pareado,
preencha o formulário e confira a entrega nesse mesmo privado. Não envie a
senha em uma mensagem de WhatsApp.

## Validação

`node --test tools/koa-cards/cards.test.mjs` valida a criptografia real entre o
WebCrypto do formulário e Node, a API, a identidade e o transporte PDF.
`npm --prefix tools/koa-whatsapp test` inclui o fluxo real do runtime com SQLite,
transporte simulado, isolamento de dados sensíveis e as regressões de tarefas.
Nenhuma dessas verificações manda mensagens para beneficiários reais.

`node --test tools/koa-cards/browser.test.mjs` exercita o login e a emissão
com páginas fictícias, usando as páginas e o renderizador reais da ferramenta
local. `node --test tools/koa-cards/form.test.mjs` carrega os arquivos publicados
e confere a criptografia e a confirmação no Chrome com a API de emissão
simulada. Os dados dessas verificações são fictícios.
