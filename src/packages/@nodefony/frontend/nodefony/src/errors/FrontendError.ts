/**
 * Erreur de base pour @nodefony/frontend.
 *
 * - `code` : identifiant machine, consommé par Vision et l'audit-logger.
 * - `context` : payload structuré pour le PDU syslog.
 */
export class FrontendError extends Error {
  constructor(
    message: string,
    public override readonly code: string,
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

/** Au moins un bundle a échoué au build production (Vite). */
export class FrontendBuildError extends FrontendError {
  constructor(
    public readonly failures: ReadonlyArray<{
      entryName: string;
      message: string;
    }>,
  ) {
    super(
      `Frontend production build failed for ${failures.length} bundle(s): ${failures
        .map((f) => f.entryName)
        .join(", ")}`,
      "BUILD_FAILED",
      { failures },
    );
    this.name = "FrontendBuildError";
  }
}

/** L'export désigné par la description d'un plugin n'est pas une fabrique appelable. */
export class FrontendPluginExportError extends FrontendError {
  constructor(specifier: string, exportName: string) {
    super(
      `Vite plugin "${specifier}" has no callable export "${exportName}"`,
      "PLUGIN_EXPORT",
      { specifier, exportName },
    );
    this.name = "FrontendPluginExportError";
  }
}

/**
 * Le serveur de développement ne peut pas écrire les plugins d'un preset qui ne
 * les décrit pas en données (`IFrontPreset.vitePlugins` absent).
 */
export class FrontendPresetNotDescribedError extends FrontendError {
  constructor(types: ReadonlyArray<string>) {
    super(
      `Frontend preset(s) ${types.map((t) => `"${t}"`).join(", ")} do not describe their Vite plugins (vitePlugins) — the dev server config cannot be written`,
      "PRESET_NOT_DESCRIBED",
      { types: [...types] },
    );
    this.name = "FrontendPresetNotDescribedError";
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
