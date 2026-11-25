/**
 * Une action de l'invite — le contrat que partagent les verbes du
 * superviseur, les commandes du CLI et l'assistant (ADR-0013 §7, #538).
 * Figé par l'ADR : il ne bouge pas d'un lot à l'autre, chacun l'implémente.
 */

/** Une demande de confirmation, posée par une action avant d'agir. */
export interface IConfirmRequest {
  readonly title: string;
  readonly detail?: string;
  readonly action?: {
    tool: string;
    arguments: Readonly<Record<string, unknown>>;
  };
  readonly risk: "read" | "write" | "destructive";
}

/**
 * La réponse à une confirmation — le même triplet que l'élicitation MCP.
 * `decline` est rendu au modèle ; `cancel` arrête le tour. Une approbation
 * ne vaut que pour l'appel qu'elle accompagne, jamais « pour la session ».
 */
export interface IConfirmDecision {
  readonly action: "accept" | "decline" | "cancel";
  readonly id: string;
  readonly at: number;
}

/** Ce que l'invite prête à une action pendant qu'elle tourne. */
export interface IPromptIO {
  /** Vers l'historique, au fil de l'eau (jeton par jeton). */
  write(text: string, stream?: "out" | "err"): void;
  confirm(request: IConfirmRequest): Promise<IConfirmDecision>;
  /** Une commande interactive prend le terminal, puis le rend. */
  suspend<T>(task: () => Promise<T>): Promise<T>;
  readonly columns: number;
}

/** Une action que l'invite sait lancer. */
export interface IPromptAction {
  readonly id: string;
  /** La saisie lui revient-elle ? */
  matches(input: string): boolean;
  complete?(prefix: string): readonly string[] | Promise<readonly string[]>;
  /**
   * Lance l'action.
   *
   * @returns son code de sortie.
   */
  run(input: string, io: IPromptIO, signal: AbortSignal): Promise<number>;
}

/** Ce que les verbes du superviseur font faire — fournis par lui. */
export interface ISupervisorVerbs {
  /**
   * Relance le serveur sans reconstruire.
   *
   * @returns `false` si un rechargement est déjà en cours.
   */
  restart(): Promise<boolean>;
  /** Vide l'onglet affiché. */
  clear(): void;
  /** Ouvre l'aide. */
  help(): void;
  /** Arrête proprement le serveur et ses enfants. */
  quit(): void;
}

/** Les verbes du superviseur, et ce qu'ils font — l'aide et le texte d'invite les lisent. */
export const SUPERVISOR_VERBS: readonly {
  readonly id: "restart" | "clear" | "help" | "quit";
  readonly does: string;
}[] = [
  { id: "restart", does: "relancer le serveur, sans reconstruire" },
  { id: "clear", does: "vider l'onglet affiché" },
  { id: "help", does: "l'aide des gestes" },
  { id: "quit", does: "arrêter proprement" },
];

/**
 * Le premier mot d'une saisie, sans le `/` d'un verbe tapé à la manière de
 * Claude Code (`/quit`).
 *
 * @param input - la saisie.
 * @returns le mot, ou `""`.
 */
export function promptVerb(input: string): string {
  const trimmed = input.trim();
  const start = trimmed.startsWith("/") ? 1 : 0;
  let end = start;
  while (end < trimmed.length && !/\s/.test(trimmed.charAt(end))) end++;
  return trimmed.slice(start, end);
}

/**
 * Les verbes du superviseur comme actions de l'invite : `restart`, `clear`,
 * `help`, `quit` (et leur forme `/verbe`). Aucun ne prend d'argument : un
 * verbe suivi d'autre chose n'est pas le verbe.
 *
 * @param verbs - ce qu'ils font faire.
 * @returns les actions, dans l'ordre de {@link SUPERVISOR_VERBS}.
 */
export function supervisorActions(verbs: ISupervisorVerbs): IPromptAction[] {
  return SUPERVISOR_VERBS.map(({ id }) => ({
    id,
    matches: (input: string): boolean => {
      const trimmed = input.trim();
      return trimmed === id || trimmed === `/${id}`;
    },
    complete: (prefix: string): readonly string[] =>
      id.startsWith(prefix) ? [id] : [],
    run: async (_input: string, io: IPromptIO): Promise<number> => {
      switch (id) {
        case "restart":
          if (!(await verbs.restart())) {
            io.write("un rechargement est déjà en cours\n", "err");
            return 1;
          }
          return 0;
        case "clear":
          verbs.clear();
          return 0;
        case "help":
          verbs.help();
          return 0;
        case "quit":
          verbs.quit();
          return 0;
      }
    },
  }));
}
