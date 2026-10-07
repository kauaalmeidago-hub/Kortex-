export class AutomationError extends Error {
  readonly code: string;
  readonly safeDetails?: string;
  readonly step?: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options: { safeDetails?: string; step?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AutomationError";
    this.code = code;
    this.safeDetails = options.safeDetails;
    this.step = options.step;
    this.retryable = options.retryable ?? false;
  }
}

export function createReauthRequiredError(safeDetails?: string) {
  return new AutomationError("REAUTH_REQUIRED", "Sessao do portal precisa de reautenticacao.", {
    safeDetails:
      safeDetails ??
      "Abra o perfil Chrome exclusivo do Koa com npm run browser:onboard e valide o login antes de executar a movimentacao.",
    retryable: true,
  });
}

export function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Operation aborted");
}

export function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Operation aborted", "AbortError");
  }
}
