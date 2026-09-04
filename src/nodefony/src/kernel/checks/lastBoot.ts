/**
 * Le BILAN du dernier démarrage — `var/last-boot.json`.
 *
 * Le problème qu'il résout n'est pas celui qu'on croit d'abord. Un boot qui
 * ÉCHOUE est visible par construction : l'erreur s'affiche dans le terminal de
 * celui qui vient de lancer. Un boot qui **réussit en dégradé** ne l'est pas —
 * les briques ignorées, les replis annoncés et les modules gatés défilent une
 * fois et disparaissent avec le terminal. L'application démarre, tout paraît
 * sain, et le développeur (ou l'agent) code contre une application amputée.
 *
 * Ce fichier fige donc les DEUX issues. Il sert aussi le cas où la sortie est
 * perdue plutôt que lue : démarrage détaché, conteneur qui sort en 78, tâche
 * d'intégration continue, ou quelqu'un qui arrive après coup et n'a que
 * `nodefony doctor` — le contrôle qui, lui, n'exécute rien.
 *
 * Écrivain (le Kernel) et lecteur (`check`) partagent ce module : le nom, le
 * chemin et la forme de l'enregistrement sont définis ICI et nulle part
 * ailleurs. Deux définitions dériveraient en silence — un producteur qui écrit
 * `phase` quand le lecteur attend `step` ne casse aucun build, il rend
 * simplement un diagnostic vide.
 *
 * Coût : une écriture par démarrage applicatif, hors de tout chemin de requête.
 */
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

/** Emplacement du bilan, relatif à la racine de l'application. */
export const LAST_BOOT_FILE = path.join("var", "last-boot.json");

/** Une brique qui n'a pas été chargée, et la raison qui l'explique. */
export interface ILastBootBrick {
  /** Nom du module ou du service concerné. */
  module: string;
  /** Raison condensée (1ʳᵉ ligne du message). */
  reason: string;
  /** Étape du boot où c'est arrivé, quand elle est connue. */
  phase?: string;
}

/**
 * Ce qu'on sait du dernier démarrage — abouti ou non.
 *
 * Chaque champ répond à une question qu'on se pose devant une application dont
 * on n'a pas vu démarrer : QUAND (donc : est-ce encore d'actualité ?), sous
 * quel environnement, et surtout ce qui MANQUE à l'appel.
 */
export interface ILastBoot {
  /**
   * `"ok"` — le démarrage est allé au bout (ce qui n'implique PAS que tout
   * fonctionne : lire `bricksSkipped` et `healthy`).
   * `"failed"` — il a été abandonné ; `error` porte la cause.
   */
  status: "ok" | "failed";
  /** Horodatage ISO 8601 de la fin du démarrage. */
  timestamp: string;
  /** Environnement résolu (`development`, `production`…). */
  environment: string;
  /** PID du process — utile en cluster pour recouper les journaux. */
  pid: number;
  /** Version de Node.js. */
  node: string;
  /** Durée du démarrage en millisecondes, quand elle est connue. */
  durationMs?: number;
  /**
   * Dernière phase du cycle de boot ATTEINTE (`onPreBoot`, `onBoot`,
   * `onReady`…). Sur un échec c'est l'information la plus discriminante : elle
   * situe le défaut sans qu'on ait à lire une pile.
   */
  phase?: string;
  /** Verdict global du bilan de boot (`false` = profil serveur sans serveur). */
  healthy?: boolean;
  /** Modules effectivement chargés. */
  modulesLoaded?: string[];
  /**
   * Briques ignorées ou tombées en fail-soft, AVEC leur raison. C'est le cœur
   * de l'intérêt de ce fichier sur un démarrage réussi : l'application tourne,
   * et il manque quelque chose que personne ne verra autrement.
   */
  bricksSkipped?: ILastBootBrick[];
  /**
   * Modules volontairement non chargés par le gating `policy`/`when`. Ce ne
   * sont PAS des échecs — mais un gating silencieux se lit comme un module
   * perdu, et se diagnostique comme tel pendant une heure.
   */
  bricksGated?: ILastBootBrick[];
  /** Nombre de `WARNING` émis pendant le démarrage. */
  warnings?: number;
  /** Nombre de `ERROR` et pire émis pendant le démarrage. */
  errors?: number;
  /** Serveurs réellement en écoute (description courte). */
  serversListening?: string[];
  /** Action corrective suggérée par le bilan, quand une heuristique l'a trouvée. */
  remediation?: string;
  /** La cause de l'abandon — présent uniquement si `status === "failed"`. */
  error?: {
    /** Message de l'erreur. */
    message: string;
    /** Nom de la classe d'erreur (`nodefonyError`, `TypeError`…). */
    name: string;
    /**
     * Code de sortie porté par l'erreur, quand elle en porte un. `78`
     * (EX_CONFIG) distingue une configuration fautive d'un défaut logiciel.
     */
    exitCode?: number;
    /** Pile d'appels, si l'erreur en portait une. */
    stack?: string;
  };
}

/**
 * Écrit le bilan, SANS JAMAIS pouvoir aggraver la situation.
 *
 * Volontairement SYNCHRONE. Sur le chemin d'échec, elle est appelée juste avant
 * que l'erreur soit relancée et que l'orchestrateur termine le process : une
 * écriture asynchrone n'aurait aucune garantie d'aboutir avant la sortie — on
 * aurait bâti un bilan qui manque précisément quand il sert.
 *
 * Toute défaillance d'écriture est avalée : un disque plein ou un dossier en
 * lecture seule ne doit pas transformer un démarrage diagnosticable en une
 * seconde erreur qui masque la première.
 *
 * @param appPath - racine de l'application (le dossier qui porte `var/`).
 * @param entry - le bilan à figer.
 */
export function writeLastBoot(appPath: string, entry: ILastBoot): void {
  try {
    const file = path.join(appPath, LAST_BOOT_FILE);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  } catch {
    // Un bilan qu'on ne peut pas écrire n'est pas un incident : c'est le
    // démarrage qui compte, et son erreur éventuelle doit remonter intacte.
  }
}

/**
 * Lit le bilan, sans exécuter quoi que ce soit.
 *
 * @param appPath - racine de l'application inspectée.
 * @returns le bilan, ou `null` s'il n'y en a pas — ou s'il est illisible : un
 *          fichier corrompu ne doit pas faire tomber le contrôle qui vient
 *          justement diagnostiquer une application cassée.
 */
export function readLastBoot(appPath: string): ILastBoot | null {
  try {
    const raw = readFileSync(path.join(appPath, LAST_BOOT_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<ILastBoot>;
    if (parsed.status !== "ok" && parsed.status !== "failed") return null;
    if (typeof parsed.timestamp !== "string") return null;
    return parsed as ILastBoot;
  } catch {
    return null;
  }
}

/**
 * Rend l'ancienneté d'un bilan en clair (« il y a 3 jours »).
 *
 * L'âge n'est pas un ornement : il décide de la conduite à tenir. Un bilan de
 * la minute précédente décrit l'état courant ; un bilan de la semaine dernière
 * peut décrire un problème résolu depuis, et croire l'un pour l'autre fait
 * chercher un défaut qui n'existe plus.
 *
 * @param timestamp - horodatage ISO du bilan.
 * @param now - instant de référence (injecté pour rendre la fonction pure et
 *              donc éprouvable sans dépendre de l'horloge).
 * @returns une formule lisible, ou `"date illisible"` si l'horodatage est cassé.
 */
export function formatAge(timestamp: string, now: number): string {
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return "date illisible";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "il y a moins d'une minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} heure${hours > 1 ? "s" : ""}`;
  const days = Math.round(hours / 24);
  return `il y a ${days} jour${days > 1 ? "s" : ""}`;
}
