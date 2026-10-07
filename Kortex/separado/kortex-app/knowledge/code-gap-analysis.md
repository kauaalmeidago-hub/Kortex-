# Code Gap Analysis

## Current Code State

The existing Kortex code already has the local automation architecture prepared:

- `automation-server`
- Fastify API
- queue and persistent worker
- SSE events
- cancellation endpoint
- dedicated Chrome profile support
- Hapvida page object placeholders
- card issue workflow shell

## Gaps Before Real Automation

- `HAPVIDA_PORTAL_URL` is not configured.
- `HAPVIDA_AUTHENTICATED_SELECTOR` is not configured.
- The visible Telegram evidence does not provide real DOM locators.
- `emitCard.ts` must remain blocked until the portal is mapped in a headed session.
- Inclusion and exclusion must remain unsupported until the real portal screens are inspected.
- No workflow should mark `success` from Telegram history alone.

## Important Security Gaps

- React must not collect or send portal password.
- Passwords must remain behind `SecretProvider` or reusable dedicated-browser session.
- Any Telegram-derived text must be treated as historical knowledge, not credential source.
- Do not use Google Password Manager scraping.

## Recommended Next Step

Run the Hapvida onboarding/mapping phase in the dedicated Chrome profile and record:

1. real portal URL;
2. stable authenticated selector;
3. menu path to card issue;
4. beneficiary search fields;
5. card download event;
6. PDF validation behavior.

Only after that should `emitCard.ts` move beyond `PORTAL_MAPPING_REQUIRED`.
