# Card Issue / Carteirinha

## Source Status

Source: Telegram Koa chat.
Confidence: partial.

The Koa chat search found historical snippets indicating that card-issue collection was validated and separated into NDI and Hapvida skills. The complete card-issue workflow was not fully recoverable from visible messages in this pass.

## Evidence Observed

- `Contexto atual Skill anterior — Emissão de carteirinhas...`
- `O comando de coleta foi validado, registrado como processo canônico e vinculado às Skills NDI e Hapvida...`
- `Sim. Dentro do escopo que alinhamos — comandos para pedidos de emissão de carteirinhas nos portais...`
- `A revisão confirmou que o material de carteirinhas contém a coleta validada...`
- References to `emissao-carteirinha-provisoria-ndi.md` and `emissao-carteirinhas-hapvida.md`.

## Current Safe Contract

The frontend should send only non-secret operational data:

- `companyId`
- `beneficiaryName`
- `periodStart`
- `periodEnd`
- optional disambiguation fields when the real portal proves they are required, such as CPF or birth date

The backend should resolve:

- operator = `hapvida`
- `credentialRef`
- company metadata
- contract/access metadata

## Required Workflow Shape

1. Validate/create operation.
2. Ensure Hapvida session via dedicated Chrome profile or `SecretProvider`.
3. Select the correct company/access.
4. Open the real card issue area.
5. Search beneficiary.
6. Disambiguate beneficiary if multiple results exist.
7. Apply movement/inclusion period when required.
8. Trigger card issue/download.
9. Validate the downloaded PDF.
10. Persist artifact.
11. Mark success only after artifact validation.

## Do Not Implement Yet

- Do not infer Hapvida selectors from Telegram.
- Do not mark success from a click.
- Do not ask React for a portal password.
- Do not select the first beneficiary if the result is ambiguous.

## Open Questions

- What is the exact Hapvida card issue URL/menu?
- What fields are mandatory for beneficiary lookup?
- Does the portal require CPF, matrícula, birth date or titular code for disambiguation?
- Does the card issue file download directly as PDF or open in a viewer first?
