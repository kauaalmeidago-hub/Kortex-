# Testes reais do portal Hapvida

Este diretorio e reservado para validacoes manuais/assistidas contra o portal real.

Regras:

- Nunca commitar credenciais, storageState, screenshots sensiveis ou downloads reais.
- Nunca rodar estes testes sem `RUN_REAL_PORTAL_TESTS=true`.
- Rodar primeiro em modo headed/debug.
- Validar seletores reais antes de habilitar headless.
- Nao repetir submit de inclusao/exclusao apos timeout sem consultar o status da movimentacao no portal.

Fluxo recomendado:

```powershell
$env:RUN_REAL_PORTAL_TESTS="true"
$env:KOA_BROWSER_DEBUG="true"
$env:KOA_AUTOMATION_HEADLESS="false"
$env:HAPVIDA_CARD_PORTAL_URL="https://webhap.hapvida.com.br/pls/webhap/pk_carteira_provisoria.login_empresa_form"
$env:HAPVIDA_AUTHENTICATED_SELECTOR="text=Datas de adesão"
$env:KOA_CARD_ISSUE_ENABLED="true"
$env:KOA_INCLUSION_ENABLED="false"
$env:KOA_EXCLUSION_ENABLED="false"
npm run browser:onboard
npm run browser:check
```

Os workflows mutaveis permanecem protegidos por feature flags:

- `FEATURE_KOA_INCLUSION=false`
- `FEATURE_KOA_EXCLUSION=false`
