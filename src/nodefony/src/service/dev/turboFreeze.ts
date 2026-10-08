/**
 * La règle du GEL de turbo (#479) — une implémentation, deux clients : le
 * superviseur de développement (`runCapturedCommand`) et le lanceur des scripts
 * du dépôt (`scripts/repo/turbo.mjs`).
 *
 * Le défaut : sous Windows, `turbo.exe` affiche son bilan — « Tasks: 21
 * successful, 21 total » — puis ne rend jamais la main, sans aucun enfant. Le
 * travail est FINI ; seul le process ne l'est pas. La règle : bilan affiché, puis
 * {@link TURBO_FREEZE_GRACE_MS} sans un octet → turbo est figé, son arbre
 * s'arrête, et le code rendu est celui qu'annonce le BILAN. Sans bilan, rien
 * n'est jamais déclaré figé : une tâche longue et muette relève d'une autre borne.
 *
 * Fichier PUR et sans import : le lanceur le charge en source, par le retrait
 * de types natif de Node, avant que le moindre `dist` existe. L'horloge est
 * injectée — la règle s'éprouve sans attendre, et sans machine Windows.
 *
 * RETRAIT : quand une montée de turbo passe un mois de CI sans qu'aucun journal
 * Windows ne porte « bilan affiché … ne rend pas la main », ce fichier et ses
 * deux clients reviennent à un `turbo run …` nu.
 */

/** Le bilan qu'affiche turbo à la fin d'un `turbo run`. */
export interface ITurboSummary {
  /** Tâches réussies. */
  readonly successful: number;
  /** Tâches lancées. */
  readonly total: number;
}

/** Le verdict « turbo est figé » : arrêter son arbre et rendre `code`. */
export interface ITurboFreezeVerdict {
  /** Le code que turbo aurait rendu, d'après son bilan. */
  readonly code: number;
  /** Le bilan lu. */
  readonly summary: ITurboSummary;
  /** Silence constaté après le bilan, en millisecondes. */
  readonly silentMs: number;
}

/** Silence toléré APRÈS le bilan avant de déclarer turbo figé. Mesuré : turbo sort en ~10 ms. */
export const TURBO_FREEZE_GRACE_MS = 30_000;

/** Lignes du journal détaillé gardées pour le rapport de gel. */
export const TURBO_LOG_TAIL = 60;

const ANSI = /\x1b\[[0-9;]*m/gu;

/** Ligne de journal de turbo en mode détaillé : `2026-10-08T07:12:49.635+0200 [DEBUG] crate: …`. */
const TURBO_LOG_LINE =
  /^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:?\d\d) \[(?:TRACE|DEBUG|INFO)\] /u;

/**
 * Lit le bilan de turbo dans une ligne de sa sortie.
 *
 * @param line - une ligne, codes de couleur compris.
 * @returns le bilan, ou `null` si la ligne n'en est pas un.
 */
export function parseTurboSummary(line: string): ITurboSummary | null {
  const m = /Tasks:\s+(\d+) successful, (\d+) total/u.exec(
    line.replace(ANSI, ""),
  );
  return m ? { successful: Number(m[1]), total: Number(m[2]) } : null;
}

/**
 * Dit si une ligne appartient au journal détaillé de turbo (`--verbosity=2`).
 * Un avertissement (`[WARN]`) n'en fait pas partie : il s'adresse au lecteur.
 *
 * @param line - une ligne de la sortie d'erreur.
 * @returns vrai pour une ligne de journal (gardée, jamais affichée).
 */
export function isTurboLogLine(line: string): boolean {
  return TURBO_LOG_LINE.test(line.replace(ANSI, ""));
}

/**
 * Le code de sortie qu'annonce un bilan : celui que turbo aurait rendu.
 *
 * @param summary - le bilan lu.
 * @returns 0 si toutes les tâches ont réussi, 1 sinon.
 */
export function turboSummaryExitCode(summary: ITurboSummary): number {
  return summary.successful === summary.total ? 0 : 1;
}

/**
 * Arguments de verbosité à placer AVANT la sous-commande de turbo : le journal
 * détaillé sous `CI` seulement, où il nommera l'étape de fermeture qui fige.
 * Après la sous-commande, un `--` l'enverrait aux tâches.
 *
 * @param ci - la valeur de `CI` (injectée).
 * @returns `["--verbosity=2"]` sous `CI`, `[]` sinon.
 */
export function turboVerbosityArgs(ci: string | undefined): string[] {
  return ci && ci !== "false" ? ["--verbosity=2"] : [];
}

/**
 * Suit la sortie d'un turbo en cours et dit QUAND il est figé.
 *
 * La sortie standard est lue pour le bilan ; la sortie d'erreur est triée — le
 * journal détaillé est gardé (les {@link TURBO_LOG_TAIL} dernières lignes),
 * le reste est rendu à l'appelant pour être affiché ou capturé.
 */
export class TurboFreezeWatch {
  readonly #graceMs: number;
  readonly #tailSize: number;
  #summary: ITurboSummary | null = null;
  #lastOutputAt: number;
  #outRest = "";
  #errRest = "";
  readonly #tail: string[] = [];

  /**
   * @param now - l'instant du lancement (horloge de l'appelant).
   * @param graceMs - silence toléré après le bilan.
   * @param tailSize - lignes de journal détaillé gardées.
   */
  constructor(
    now: number,
    graceMs: number = TURBO_FREEZE_GRACE_MS,
    tailSize: number = TURBO_LOG_TAIL,
  ) {
    this.#lastOutputAt = now;
    this.#graceMs = graceMs;
    this.#tailSize = tailSize;
  }

  /** Le bilan lu, s'il est passé. */
  get summary(): ITurboSummary | null {
    return this.#summary;
  }

  /** Les dernières lignes du journal détaillé, sans couleurs. */
  get logTail(): readonly string[] {
    return this.#tail;
  }

  /**
   * Reçoit un morceau de la sortie standard.
   *
   * @param chunk - le texte reçu (une ligne peut être coupée entre deux morceaux).
   * @param now - l'instant de réception.
   */
  stdout(chunk: string, now: number): void {
    this.#lastOutputAt = now;
    const parts = (this.#outRest + chunk).split(/\r?\n/u);
    this.#outRest = parts.pop() ?? "";
    for (const line of parts) this.#readSummary(line);
  }

  /**
   * Reçoit un morceau de la sortie d'erreur et rend ce qui n'est pas du journal
   * détaillé. Une ligne incomplète attend le morceau suivant (ou {@link flush}).
   *
   * @param chunk - le texte reçu.
   * @param now - l'instant de réception.
   * @returns le texte à afficher ou capturer (lignes complètes, `\n` compris).
   */
  stderr(chunk: string, now: number): string {
    this.#lastOutputAt = now;
    const parts = (this.#errRest + chunk).split(/\r?\n/u);
    this.#errRest = parts.pop() ?? "";
    let kept = "";
    for (const line of parts) {
      if (!this.#keepLog(line)) kept += `${line}\n`;
    }
    return kept;
  }

  /**
   * Termine la lecture : la dernière ligne incomplète de chaque flux est traitée.
   *
   * @returns le reste de la sortie d'erreur à afficher.
   */
  flush(): string {
    if (this.#outRest) this.#readSummary(this.#outRest);
    this.#outRest = "";
    const rest = this.#errRest;
    this.#errRest = "";
    return rest && !this.#keepLog(rest) ? rest : "";
  }

  /**
   * Temps restant avant que turbo soit déclaré figé.
   *
   * @param now - l'instant présent.
   * @returns des millisecondes (0 = figé), `Infinity` tant qu'aucun bilan n'est passé.
   */
  remaining(now: number): number {
    if (this.#summary === null) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.#graceMs - (now - this.#lastOutputAt));
  }

  /**
   * Le verdict : figé ou non.
   *
   * @param now - l'instant présent.
   * @returns le verdict quand turbo est figé, `null` sinon.
   */
  verdict(now: number): ITurboFreezeVerdict | null {
    if (this.#summary === null || this.remaining(now) > 0) return null;
    return {
      code: turboSummaryExitCode(this.#summary),
      summary: this.#summary,
      silentMs: now - this.#lastOutputAt,
    };
  }

  #readSummary(line: string): void {
    this.#summary = parseTurboSummary(line) ?? this.#summary;
  }

  #keepLog(line: string): boolean {
    if (!isTurboLogLine(line)) return false;
    this.#tail.push(line.replace(ANSI, ""));
    if (this.#tail.length > this.#tailSize) this.#tail.shift();
    return true;
  }
}

/**
 * Le rapport d'un gel : ce qui s'est passé, le code rendu, et la fin du journal
 * détaillé — sa dernière ligne nomme l'étape de fermeture où turbo s'est figé.
 *
 * @param verdict - le verdict de {@link TurboFreezeWatch.verdict}.
 * @param logTail - la fin du journal détaillé (vide hors `CI`).
 * @returns le texte, entouré de sauts de ligne.
 */
export function describeTurboFreeze(
  verdict: ITurboFreezeVerdict,
  logTail: readonly string[],
): string {
  const { successful, total } = verdict.summary;
  const journal = logTail.length
    ? " Fin du journal détaillé de turbo — la dernière ligne est l'étape où il " +
      `s'est figé :\n${logTail.join("\n")}\n`
    : "\n";
  return (
    `\n[turbo] bilan affiché (${successful}/${total} réussies) mais turbo ne rend ` +
    `pas la main depuis ${Math.round(verdict.silentMs / 1000)} s — arbre arrêté, ` +
    `code ${verdict.code} rendu d'après le bilan (#479).${journal}`
  );
}
