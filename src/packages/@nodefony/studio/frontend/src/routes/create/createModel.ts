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
  /**
   * Réponse PRÉCÉDENTE exigée pour poser la question — là où `askIf` interroge
   * l'environnement, celle-ci exprime une dépendance entre deux choix du même
   * formulaire (la base SQL n'a de service à choisir qu'en preset `complete`).
   *
   * Non satisfaite, le moteur ramène la valeur au défaut : l'afficher
   * annoncerait un choix que la génération ignore.
   */
  askWhen?: { key: string; equals: string };
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
 * Un emplacement où une NOUVELLE application a le droit de naître.
 *
 * Miroir de `IScaffoldRoot` (core `cli/scaffold/destination.ts`). Le `path` n'est là que
 * pour être MONTRÉ (l'appelant est administrateur, en développement, sur sa machine : lui
 * cacher où il installe ne protégerait rien). Le client, lui, ne renvoie que l'`id`.
 */
export interface IScaffoldRoot {
  id: string;
  label: string;
  path: string;
}

/** Réponse de `GET /nodefony/studio/api/create/browse` — les sous-dossiers navigables. */
export interface IScaffoldBrowse {
  /** Sous-chemin relatif exploré (`""` = la racine). */
  sub: string;
  /** Sous-dossiers directs, triés (ni cachés, ni `node_modules`). */
  dirs: string[];
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
 * Ce que pousse le canal `nodefony:scaffold:job@<id>` : une ligne de terminal, ou l'état du job.
 *
 * L'état voyage sur le MÊME canal que les lignes (à l'abonnement, une fois les fichiers
 * écrits, et à la fin). C'est ce qui permet de ne jamais interroger le serveur en boucle
 * pour savoir si le job est terminé : la socket le dit.
 */
export type IScaffoldEvent =
  | { kind: "line"; line: IScaffoldLine }
  | { kind: "state"; state: IScaffoldJobState };

/** Snapshot d'un job, tel que servi par la socket (`nodefony:scaffold:run`) ou l'API (`create/job/{id}`). */
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

/**
 * Capacités de l'environnement, telles que le SERVEUR les constate (contrat `askIf`).
 *
 * Elles ne se devinent pas depuis un navigateur : `hasCheckout` (« un checkout du framework
 * est résolvable ») dépend de ce qu'il y a sur le disque du serveur. Les coder en dur côté
 * front revenait à supprimer une option en silence — vécu : la question `link` n'était
 * jamais posée, et l'app générée échouait à l'installation (`404` sur le registre npm, les
 * paquets `@nodefony/*` n'y étant pas encore publiés).
 */
export interface IScaffoldCaps {
  hasCheckout: boolean;
  /** Le serveur peut en déclarer d'autres : une capacité inconnue vaut « non ». */
  [key: string]: boolean | undefined;
}

/** Réponse de `GET /nodefony/studio/api/create/spec` quand la création est ouverte. */
export interface ICreateSpecOk {
  enabled: true;
  steps: ScaffoldStep[];
  specs: IScaffoldTypeSpec[];
  targets: IScaffoldTarget[];
  projectRoot: string;
  /** Emplacements autorisés pour une nouvelle app (vide = le serveur n'en propose aucun). */
  roots: IScaffoldRoot[];
  /** Capacités constatées par le serveur — pilotent les questions `askIf`. */
  caps: IScaffoldCaps;
}

/** Refus serveur (hors développement) — porte SA raison, qu'on affiche telle quelle. */
export interface ICreateSpecOff {
  enabled: false;
  reason: string;
}

export type CreateSpec = ICreateSpecOk | ICreateSpecOff;

/** Réponses du formulaire (clé de question → valeur). */
export type TAnswers = Record<string, string | boolean>;

/** Réponse de l'action `nodefony:scaffold:cancel`. */
export interface IScaffoldCancelResult {
  cancelled: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Destination d'une nouvelle app
 *
 * Une app est le SEUL type qui naît AILLEURS : les quatre autres écrivent dans le projet
 * courant, qui n'est pas un choix. D'où ce bloc, qui n'existe que pour `app`.
 *
 * Le front ne manipule JAMAIS un chemin : il choisit une racine par son **identifiant** et
 * descend dans des **noms de dossiers** rendus par le serveur. Le chemin affiché ici n'est
 * qu'un APERÇU (reconstitué pour l'œil) ; ce qui part sur la socket, ce sont `root` et
 * `subPath`. Le serveur recompose et refuse tout le reste.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Le type de scaffold qui naît hors du projet courant (le seul à avoir une destination). */
export const APP_TYPE = "app";

/** Clé de la question « câbler les paquets nodefony sur le checkout local » (spec du moteur). */
export const LINK_KEY = "link";

/** Clé de l'étape d'installation (allowlist serveur `SCAFFOLD_STEPS`). */
export const INSTALL_STEP = "install";

/** Ce type crée-t-il une app (→ destination à choisir) ? */
export function isAppType(type: string | null): boolean {
  return type === APP_TYPE;
}

/**
 * Nom d'application acceptable — MIROIR de `APP_NAME_RE` (core `destination.ts`), qui est
 * aussi le `pattern` de la question `name` de la spec. Recopié ici pour un seul usage :
 * dire, dans l'aperçu, POURQUOI la destination n'est pas encore complète.
 */
export const APP_NAME_RE = /^[a-z][a-z0-9-]*$/u;

/** Segments d'un sous-chemin (`"clients/acme"` → `["clients", "acme"]`). `""` → `[]`. */
export function subSegments(sub: string): string[] {
  return sub.split("/").filter((s) => s !== "");
}

/** Descend d'un cran : sous-chemin courant + un nom de dossier rendu par le serveur. */
export function joinSub(sub: string, dir: string): string {
  return sub === "" ? dir : `${sub}/${dir}`;
}

/** Remonte le fil d'Ariane : sous-chemin des `count` premiers segments (`0` = la racine). */
export function subUpTo(sub: string, count: number): string {
  return subSegments(sub).slice(0, count).join("/");
}

/** Aperçu de la destination d'une app — ce que l'utilisateur DOIT voir avant de confirmer. */
export interface IDestinationPreview {
  /** Chemin lisible : `<label de la racine>/<sous-dossier>/<nom>`. */
  label: string;
  /** Chemin serveur reconstitué — affichage seul, jamais envoyé. `null` sans racine. */
  path: string | null;
  /** Ce qui manque ou cloche ; `null` = destination complète et valable. */
  issue: string | null;
}

/**
 * Décrit la destination d'une app : où elle va naître, et sinon pourquoi on ne peut pas
 * encore le dire.
 *
 * @param root - racine choisie (`null` si aucune).
 * @param subPath - sous-dossier relatif (`""` = la racine elle-même).
 * @param name - nom de l'app tel que saisi.
 */
export function describeDestination(
  root: IScaffoldRoot | null,
  subPath: string,
  name: string,
): IDestinationPreview {
  const trimmed = name.trim();
  const issue =
    root === null
      ? "Choisissez un emplacement d'installation."
      : trimmed === ""
        ? "Donnez un nom à l'application pour voir sa destination."
        : APP_NAME_RE.test(trimmed)
          ? null
          : "Nom d'application invalide : minuscules, chiffres et tirets, commençant par une lettre (ex : mon-app).";
  // Le dernier segment reste visible même invalide : voir « …/Mon App » explique la faute
  // mieux qu'un aperçu qui disparaît.
  const leaf = trimmed === "" ? "<nom>" : trimmed;
  const parts = [root?.label ?? "<emplacement>", ...subSegments(subPath), leaf];
  return {
    label: parts.join("/"),
    path: root ? [root.path, ...subSegments(subPath), leaf].join("/") : null,
    issue,
  };
}

/** Racine choisie par défaut : la première proposée par le serveur (souvent la seule). */
export function defaultRootId(roots: IScaffoldRoot[]): string | null {
  return roots[0]?.id ?? null;
}

/**
 * Une question n'est posée que si le SERVEUR déclare vraie la capacité qu'elle
 * exige (`askIf`) ET si la réponse dont elle dépend a la valeur attendue
 * (`askWhen`).
 *
 * Les deux conditions sont celles du MOTEUR (`resolveAnswers`, core) : une
 * question qu'il ramènerait au défaut ne doit pas être offerte ici, sinon le
 * formulaire annonce un choix que la génération ignore.
 */
export function isQuestionVisible(
  q: IScaffoldQuestion,
  caps: IScaffoldCaps,
  answers: TAnswers = {},
): boolean {
  if (q.askIf && caps[q.askIf] !== true) return false;
  if (q.askWhen && String(answers[q.askWhen.key]) !== q.askWhen.equals) {
    return false;
  }
  return true;
}

/** Questions visibles, ventilées : celles du dialogue et celles du repli « avancé ». */
export function splitQuestions(
  spec: IScaffoldTypeSpec,
  caps: IScaffoldCaps,
  answers: TAnswers = {},
): {
  main: IScaffoldQuestion[];
  advanced: IScaffoldQuestion[];
} {
  const visible = spec.questions.filter((q) =>
    isQuestionVisible(q, caps, answers),
  );
  return {
    main: visible.filter((q) => !q.advanced),
    advanced: visible.filter((q) => q.advanced === true),
  };
}

/**
 * Réponses initiales d'un type = les défauts DU MOTEUR (jamais des défauts recopiés ici),
 * à UNE exception assumée : `link` pour une app, quand un checkout est résolvable.
 *
 * Pourquoi Studio coche là où le CLI ne coche pas : le moteur garde `link: false` par
 * défaut — un générateur ne réécrit pas des dépendances en `file:` sans demande explicite,
 * et en CLI l'utilisateur répond. Mais depuis Studio, dans un checkout du framework, on
 * crée une app POUR travailler avec le code local ; et surtout, tant que les paquets
 * `@nodefony/*` ne sont pas publiés sur npm, une app SANS lien ne s'installe pas
 * (`npm install` → 404 sur le registre). C'est une décision d'INTERFACE — la case reste
 * décochable, et le moteur, lui, n'est pas touché.
 */
export function defaultAnswers(
  spec: IScaffoldTypeSpec,
  caps: IScaffoldCaps,
): TAnswers {
  const answers: TAnswers = {};
  for (const q of spec.questions) {
    // `answers` en cours de construction : une question `askWhen` lit la réponse
    // DÉJÀ posée de celle dont elle dépend — l'ordre de la spec fait foi, comme
    // dans le moteur.
    if (!isQuestionVisible(q, caps, answers)) continue;
    answers[q.key] =
      q.key === LINK_KEY && spec.type === APP_TYPE && caps.hasCheckout === true
        ? true
        : q.default;
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
  caps: IScaffoldCaps,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of spec.questions) {
    if (!isQuestionVisible(q, caps)) continue;
    const message = validateAnswer(q, answers[q.key]);
    if (message) errors[q.key] = message;
  }
  return errors;
}

/**
 * L'installation de l'app va-t-elle échouer, et pourquoi ?
 *
 * Les paquets `@nodefony/*` ne sont **pas encore publiés sur npm** : un `npm install` dans
 * une app générée sans lien local part chercher `@nodefony/drizzle` & co sur le registre et
 * s'arrête sur un `404`. Le seul moyen d'obtenir une app installable aujourd'hui est
 * l'option `link` (elle réécrit ces dépendances en `file:<checkout>`). Autant le dire AVANT
 * de lancer plutôt que de laisser l'utilisateur lire l'échec dans le terminal.
 *
 * @returns le message d'alerte, ou `null` si l'installation a toutes ses chances.
 */
export function describeInstallRisk(
  type: string | null,
  caps: IScaffoldCaps,
  answers: TAnswers,
  steps: ScaffoldStep[],
): string | null {
  if (!isAppType(type)) return null;
  if (!steps.includes(INSTALL_STEP)) return null;
  if (answers[LINK_KEY] === true) return null;
  return caps.hasCheckout === true
    ? "Sans le câblage sur le checkout local, npm install ira chercher les paquets @nodefony/* sur le registre npm, où ils ne sont pas encore publiés : l'installation échouera (404). Cochez le câblage dans les réglages, ou décochez npm install et installez l'app plus tard."
    : "Aucun checkout du framework n'est résolvable depuis ce serveur, et les paquets @nodefony/* ne sont pas encore publiés sur npm : npm install échouera (404). Décochez l'étape — l'application sera écrite, à installer à la main.";
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
 * Étapes cochées par défaut : `install` dès que le scaffold **touche à un `package.json`**
 * — une app naît avec le sien (elle n'est pas lançable sans installation), un module
 * devient un workspace, un front ajoute les dépendances du builder. Sans l'installation, le
 * résultat n'est pas chargeable. Un controller ou une entité n'ajoutent rien à installer :
 * on ne fait pas payer une installation complète pour rien.
 */
export function defaultSteps(
  type: string,
  available: ScaffoldStep[],
): ScaffoldStep[] {
  const wanted =
    type === APP_TYPE || type === "module" || type === "front"
      ? ["install"]
      : [];
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
