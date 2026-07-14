/**
 * Modèle de la page « Créer » — types MIROIR du contrat serveur + helpers PURS (0 JSX).
 *
 * Frontière isomorphe : le front n'importe JAMAIS un module serveur. Les formes
 * décrites ici recopient, sans les importer :
 *  - `src/nodefony/src/cli/scaffold/spec.ts` (questions déclaratives du moteur) ;
 *  - `@nodefony/studio` `nodefony/service/ScaffoldService.ts` (lignes + état d'un job) ;
 *  - `nodefony/controller/StudioCreateController.ts` (réponse de `create/spec`).
 *
 * Le formulaire est **piloté par la donnée** : une question ajoutée au moteur apparaît
 * ici sans qu'aucun champ ne soit écrit à la main. Rien n'est recopié en dur — ni les
 * clés, ni les défauts, ni les expressions de validation.
 */

/** Nature d'une question — décide du contrôle rendu. */
export type ScaffoldQuestionType = "string" | "boolean" | "choice";

/** Un choix d'une question `choice` (le premier n'est PAS forcément le défaut). */
export interface IScaffoldChoice {
  value: string;
  label: string;
  hint?: string;
}

/** Une question du moteur de scaffold (100 % JSON — pas de fonction). */
export interface IScaffoldQuestion {
  key: string;
  label: string;
  type: ScaffoldQuestionType;
  choices?: IScaffoldChoice[];
  default: string | boolean;
  /** Source d'une regex (sans flags) que la valeur doit satisfaire. */
  pattern?: string;
  /** Message affiché quand `pattern` n'est pas satisfait. */
  patternHint?: string;
  /** Capacité d'environnement exigée pour poser la question (cf {@link FRONT_CAPABILITIES}). */
  askIf?: string;
  /** Réglage avancé — replié par défaut (son défaut est sûr). */
  advanced?: boolean;
}

/** Un type de scaffold servi par Studio (`module` / `controller` / `front` / `entity`). */
export interface IScaffoldTypeSpec {
  type: string;
  description: string;
  questions: IScaffoldQuestion[];
}

/** Une cible d'écriture : l'app racine ou un module du projet. */
export interface IScaffoldTarget {
  kind: "app" | "module";
  /** Nom du paquet — c'est LA valeur attendue par la réponse `module`. */
  name: string;
  dir: string;
}

/**
 * Étape post-écriture. Volontairement `string` et non une union figée : l'allowlist
 * fait autorité **côté serveur** (`SCAFFOLD_STEPS`) et voyage dans la réponse de
 * `create/spec` — la recopier ici la ferait diverger en silence.
 */
export type ScaffoldStep = string;

/** Nature d'une ligne de terminal — pilote sa couleur. */
export type ScaffoldStream = "info" | "out" | "err" | "ok" | "fail";

/** Une ligne de terminal. `seq` est monotone → détection de doublon/trou. */
export interface IScaffoldLine {
  seq: number;
  ts: number;
  stream: ScaffoldStream;
  text: string;
}

export type ScaffoldJobStatus = "running" | "done" | "failed";

/**
 * Ce que pousse le canal `scaffold:job@<id>` : une ligne de terminal, ou l'état du job.
 *
 * L'état voyage sur le MÊME canal que les lignes (à l'abonnement, une fois les fichiers
 * écrits, et à la fin). C'est ce qui permet de ne jamais interroger le serveur en boucle
 * pour savoir si le job est terminé : la socket le dit.
 */
export type IScaffoldEvent =
  | { kind: "line"; line: IScaffoldLine }
  | { kind: "state"; state: IScaffoldJobState };

/** Snapshot d'un job, tel que servi par la socket (`scaffold:run`) ou l'API (`create/job/{id}`). */
export interface IScaffoldJobState {
  id: string;
  type: string;
  status: ScaffoldJobStatus;
  startedAt: number;
  endedAt: number | null;
  /** Fichiers écrits (chemins relatifs). */
  files: string[];
  /** Notes du moteur (routes/canaux câblés, actions restantes). */
  notes: string[];
  lines: IScaffoldLine[];
}

/**
 * L'état d'un job SANS ses lignes.
 *
 * Les lignes vivent à part dans la vue : elles arrivent par le canal temps réel (une à
 * une), alors que l'état (statut, fichiers, notes) se relit par instantané. Les garder
 * dans le même objet obligerait à recopier tout le terminal à chaque relecture d'état.
 */
export type IScaffoldJobMeta = Omit<IScaffoldJobState, "lines">;

/** Réponse de `GET /nodefony/studio/api/create/spec` quand la création est ouverte. */
export interface ICreateSpecOk {
  enabled: true;
  steps: ScaffoldStep[];
  specs: IScaffoldTypeSpec[];
  targets: IScaffoldTarget[];
  projectRoot: string;
}

/** Refus serveur (hors développement) — porte SA raison, qu'on affiche telle quelle. */
export interface ICreateSpecOff {
  enabled: false;
  reason: string;
}

export type CreateSpec = ICreateSpecOk | ICreateSpecOff;

/** Réponses du formulaire (clé de question → valeur). */
export type TAnswers = Record<string, string | boolean>;

/** Réponse de l'action `scaffold:cancel`. */
export interface IScaffoldCancelResult {
  cancelled: boolean;
}

/**
 * Capacités d'environnement déclarées par CE front (contrat `askIf` de la spec).
 *
 * `hasCheckout` = « un checkout du framework est résolvable » : c'est vrai pour le CLI
 * lancé à la main, jamais pour Studio (qui tourne DANS l'app, pas dans le checkout).
 * Une question `askIf` non déclarée ici n'est simplement pas posée — son défaut sûr
 * s'applique côté moteur.
 */
export const FRONT_CAPABILITIES: Readonly<Record<string, boolean>> = {
  hasCheckout: false,
};

/** Une question n'est posée que si sa capacité est déclarée vraie par le front. */
export function isQuestionVisible(q: IScaffoldQuestion): boolean {
  return !q.askIf || FRONT_CAPABILITIES[q.askIf] === true;
}

/** Questions visibles, ventilées : celles du dialogue et celles du repli « avancé ». */
export function splitQuestions(spec: IScaffoldTypeSpec): {
  main: IScaffoldQuestion[];
  advanced: IScaffoldQuestion[];
} {
  const visible = spec.questions.filter(isQuestionVisible);
  return {
    main: visible.filter((q) => !q.advanced),
    advanced: visible.filter((q) => q.advanced === true),
  };
}

/** Réponses initiales d'un type = les défauts DU MOTEUR (jamais des défauts recopiés ici). */
export function defaultAnswers(spec: IScaffoldTypeSpec): TAnswers {
  const answers: TAnswers = {};
  for (const q of spec.questions) {
    if (!isQuestionVisible(q)) continue;
    answers[q.key] = q.default;
  }
  return answers;
}

/**
 * Cache des expressions de validation : `pattern` arrive en **source** (string), et
 * recompiler une `RegExp` à chaque frappe serait du gaspillage pur.
 */
const patternCache = new Map<string, RegExp>();

function compilePattern(source: string): RegExp | null {
  const cached = patternCache.get(source);
  if (cached) return cached;
  try {
    const re = new RegExp(source);
    patternCache.set(source, re);
    return re;
  } catch {
    // Un pattern illisible ne doit pas bloquer l'envoi : le serveur revalide de
    // toute façon (il est l'autorité). On laisse simplement passer côté client.
    return null;
  }
}

/**
 * Valide UNE réponse contre sa question.
 *
 * @returns le message d'aide (`patternHint`) si la valeur est refusée, sinon `null`.
 */
export function validateAnswer(
  q: IScaffoldQuestion,
  value: string | boolean | undefined,
): string | null {
  if (q.type !== "string" || !q.pattern) return null;
  const text = typeof value === "string" ? value : "";
  const re = compilePattern(q.pattern);
  if (!re || re.test(text)) return null;
  return q.patternHint ?? `Valeur attendue : ${q.pattern}`;
}

/** Valide toutes les réponses visibles → map `clé → message`. Vide = formulaire valide. */
export function validateAnswers(
  spec: IScaffoldTypeSpec,
  answers: TAnswers,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of spec.questions) {
    if (!isQuestionVisible(q)) continue;
    const message = validateAnswer(q, answers[q.key]);
    if (message) errors[q.key] = message;
  }
  return errors;
}

/** Libellé humain d'une étape post-écriture (le serveur, lui, n'envoie que sa clé). */
export interface IStepLabel {
  label: string;
  help: string;
}

const STEP_LABELS: Readonly<Record<string, IStepLabel>> = {
  install: {
    label: "npm install",
    help: "Installe les dépendances et — pour un module — crée le lien de workspace. Sans lui, un module tout juste créé n'est PAS résolvable par le kernel (il l'importe par son NOM).",
  },
  build: {
    label: "npm run build",
    help: "Compile le projet (et les modules). Le nouveau code n'est chargé qu'au redémarrage du serveur.",
  },
  typecheck: {
    label: "npm run typecheck",
    help: "Vérifie les types du projet — le seul gate qui attrape une erreur de type (le bundler, lui, ne type pas).",
  },
};

/** Libellé d'une étape ; une étape inconnue du front reste rendue (par sa clé). */
export function stepLabel(step: ScaffoldStep): IStepLabel {
  return (
    STEP_LABELS[step] ?? {
      label: step,
      help: "Étape déclarée par le serveur.",
    }
  );
}

/**
 * Étapes cochées par défaut : `install` dès que le scaffold **touche au `package.json`**
 * (un module devient un workspace, un front ajoute les dépendances du builder) — sans
 * l'installation, le résultat n'est pas chargeable. Un controller ou une entité n'ajoutent
 * rien à installer : on ne fait pas payer une installation complète pour rien.
 */
export function defaultSteps(
  type: string,
  available: ScaffoldStep[],
): ScaffoldStep[] {
  const wanted = type === "module" || type === "front" ? ["install"] : [];
  return available.filter((s) => wanted.includes(s));
}

/** Nombre de lignes RENDUES dans le terminal (le serveur en garde 4000 ; le DOM n'en veut pas autant). */
export const MAX_TERMINAL_LINES = 500;

/** Ajoute une ligne en bornant la fenêtre rendue (ring côté vue). */
export function appendLine(
  lines: IScaffoldLine[],
  line: IScaffoldLine,
): IScaffoldLine[] {
  const next =
    lines.length >= MAX_TERMINAL_LINES ? lines.slice(1) : lines.slice();
  next.push(line);
  return next;
}

/** Couleur d'une ligne, par nature. Variables Mantine → suit le thème clair/sombre. */
export const STREAM_COLORS: Readonly<Record<ScaffoldStream, string>> = {
  info: "var(--mantine-color-gray-5)",
  out: "var(--mantine-color-gray-2)",
  err: "var(--mantine-color-orange-4)",
  ok: "var(--mantine-color-teal-4)",
  fail: "var(--mantine-color-red-5)",
};

/** Valeur d'une réponse, telle qu'on la RÉCAPITULE avant de lancer (jamais une valeur brute nue). */
export function formatAnswer(
  q: IScaffoldQuestion,
  value: string | boolean | undefined,
): string {
  if (q.type === "boolean") return value === true ? "oui" : "non";
  const text = typeof value === "string" ? value : "";
  if (text === "") return "— (défaut)";
  if (q.type === "choice") {
    const choice = q.choices?.find((c) => c.value === text);
    return choice ? choice.label : text;
  }
  return text;
}

/** Le job est-il encore en cours ? (pilote « arrêter » et le sondage d'état). */
export function isRunning(job: IScaffoldJobMeta | null): boolean {
  return job?.status === "running";
}

/**
 * Message honnête d'un refus — le pont temps réel rend un message générique (le détail
 * reste côté serveur, Zero Trust), autant ne pas afficher un code brut à l'utilisateur.
 */
export function describeScaffoldError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Le serveur a refusé la demande.";
}
