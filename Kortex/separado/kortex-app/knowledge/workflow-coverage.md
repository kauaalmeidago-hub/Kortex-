# Workflow Coverage From Telegram Koa

## Coverage Matrix

| Workflow | Telegram Evidence | Confidence | Implementation Readiness |
| --- | --- | --- | --- |
| Card issue / carteirinha | Search snippets mention validated collection and separate NDI/Hapvida skills. Current visible chat has only a failed 2026-10-06 question. | Medium for existence, low for exact portal steps | Needs full export or portal mapping |
| Inclusion holder | No complete evidence found in authorized Koa chat | Low | Keep disabled |
| Inclusion dependent | No complete evidence found in authorized Koa chat | Low | Keep disabled |
| Exclusion holder | No complete evidence found in authorized Koa chat | Low | Keep disabled |
| Exclusion dependent | No complete evidence found in authorized Koa chat | Low | Keep disabled |
| Hapvida billing reports | Full visible workflow captured from 2026-09-09/10 | High for training content | Separate from movement automation |

## Confirmed Card-Issue Signals

- The Koa chat search returned prior records for `emissao-carteirinhas-ndi` and `emissao-carteirinhas-hapvida`.
- Search snippets state that the collection command was validated by Kaua and registered as canonical.
- Search snippets state that NDI and Hapvida card issue should be treated as separate skills.
- The visible chat does not expose the complete step-by-step card workflow without exporting or resuming the old bot session.

## Confirmed Report Signals

- Hapvida report workflow starts at `Kit faturamento`.
- The relevant portal shortcut is `6 - Hapvida Relatório - Kit`.
- Authentication uses the company key in the `CPF/CNPJ` field; the key starts with the company's CNPJ.
- `BAIXAR ARQUIVOS - DOWNLOAD (Novo)` is the primary path.
- `BAIXAR ARQUIVOS - DOWNLOAD (Anterior)` is the fallback path for coparticipation when needed.
- `_PSICO.PDF` identifies coparticipation report candidates, but the competence must still be validated.
- Monthly report and coparticipation report are distinct and both are expected when a full Hapvida report kit is requested.

## Missing Evidence

- Real Hapvida URL and authenticated selector.
- DOM selectors for card issue.
- Exact card area/menu names.
- Exact beneficiary disambiguation fields.
- Inclusion and exclusion portal steps.
- Backend result shapes returned by real portal execution.
