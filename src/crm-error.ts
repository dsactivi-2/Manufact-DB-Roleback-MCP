export class CrmError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function asCrmError(error: unknown): CrmError {
  if (error instanceof CrmError) return error;
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  const safeCode = /^[A-Z0-9_]{1,64}$/.test(code) ? code : "";
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Identitaetsnachweis")) return new CrmError("AUTH_REQUIRED", message, 401);
  if (message === "Das echte CRM-Schema ist noch nicht geprueft. Schreibfelder bleiben gesperrt." || message === "Feld ist nicht freigegeben." || message === "Unbekannter Datensatztyp." || message === "Testentitaeten sind in dieser Umgebung aus." || message === "Berufstext fehlt." || message === "Sprache fehlt.") {
    return new CrmError("INVALID_INPUT", message);
  }
  if (safeCode) return new CrmError(safeCode, "Datenbankabfrage fehlgeschlagen (" + safeCode + ").", 500);
  return new CrmError("QUERY_FAILED", "Datenbankabfrage fehlgeschlagen.", 500);
}
