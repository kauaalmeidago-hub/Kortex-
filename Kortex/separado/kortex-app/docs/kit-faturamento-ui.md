# Refinamento do Kit Faturamento

A barra de ações usa os botões do Kortex com altura de 36 px. A página e os componentes herdam Inter e usam os tokens de cor do projeto: `card`, `foreground`, `muted`, `border`, `primary` e `accent`. As cores específicas de operadora ficam somente nos símbolos Hapvida e NDI; nomes, avatares, bordas e estados seguem a paleta do aplicativo.

O filtro é um popover de 380 px alinhado ao botão **Filtros**, com limite de largura e altura definido pela área disponível. Operadora, mês, ano e status só alteram a tabela ao clicar em **Aplicar filtros**. Fechar o popover descarta a edição ainda não aplicada.

O pedido manual tem largura máxima de 640 px. Cabeçalho e rodapé ficam fixos dentro do modal; somente o conteúdo central rola. Em telas estreitas, os quatro tipos de pedido se organizam em duas colunas. O KOA mantém uma apresentação compacta e um painel de 420 px com seleção de empresa dentro da conversa.

A tabela rola dentro de seu próprio painel. Busca, ordenação, seleção e paginação funcionam sobre os dez registros de exemplo já existentes. **Exportar** baixa os metadados da tabela em CSV e respeita a seleção e os filtros; não equivale ao download de boletos ou notas fiscais.

## Limite da integração atual

O componente do kit disponível neste repositório ainda usa dados de exemplo e não contém uma integração de emissão de faturamento. Esta alteração não cria endpoints, não envia pedidos, não acessa credenciais e não altera os fluxos de carteirinhas. O pedido manual, o download de documentos e a busca automática exibem avisos de indisponibilidade em vez de informar uma emissão inexistente.

Se a cópia local tiver integração de faturamento ainda não enviada ao repositório, concilie os componentes visuais com essa implementação antes de substituir a página.

## Validação

Com as dependências do frontend e de `automation-server` instaladas, execute:

```bash
npm run build
npx tsc --noEmit -p tsconfig.app.json
npm test
npm run test:billing-kit-ui
```

O teste visual usa Chrome por padrão. Para outro Chromium instalado, defina `KOA_TEST_BROWSER_EXECUTABLE` com o caminho do executável. `KIT_UI_ARTIFACT_DIR` permite definir onde salvar as capturas. Nenhuma chamada a conta ou portal real é feita; a autenticação é substituída somente no cenário de teste.

O teste cobre alinhamento do filtro, aplicação e descarte de filtros, busca sem acentos, paginação, seleção, CSV, pedido manual, retorno do foco após Esc, KOA, tema escuro e rodapés em seis resoluções: 1366×768, 1366×645, 1024×600, 768×620, 390×640 e 320×480.
