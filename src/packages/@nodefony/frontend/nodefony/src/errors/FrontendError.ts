/**
 * Erreur de base pour @nodefony/frontend.
 *
 * - `code` : identifiant machine, consommé par Vision et l'audit-logger.
 * - `context` : payload structuré pour le PDU syslog.
 */
export class FrontendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FrontendError";
  }
}

/** Preset inconnu — module a déclaré `type: "foo"` non enregistré. */
export class FrontendPresetUnknownError extends FrontendError {
  constructor(type: string) {
    super(`Unknown frontend preset: "${type}"`, "PRESET_UNKNOWN", { type });
    this.name = "FrontendPresetUnknownError";
  }
}

/** Echec de démarrage de Vite (spawn raté, port occupé, config invalide). */
export class FrontendSupervisorStartError extends FrontendError {
  constructor(reason: string, cause?: unknown) {
    super(`Vite supervisor failed to start: ${reason}`, "SUPERVISOR_START", {
      reason,
    });
    this.name = "FrontendSupervisorStartError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/** Aucune entrée front trouvée alors qu'on tente de démarrer le dev server. */
export class FrontendNoEntriesError extends FrontendError {
  constructor() {
    super(
      `No frontend entries declared. Add { frontend: { type, entry } } in your module config.`,
      "NO_ENTRIES",
    );
    this.name = "FrontendNoEntriesError";
  }
}
