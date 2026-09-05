/**
 * Étage 3 de `doctor` — ce que le projet DÉCLARE, réellement exécuté.
 *
 * Les autres étages lisent : des fichiers, des manifestes, l'application
 * démarrée. Celui-ci LANCE — les scripts que l'application déclare déjà
 * (`typecheck`, `lint`, `test`) et l'interrogation du registre npm.
 *
 * ## Pourquoi ce n'est pas le comportement par défaut
 *
 * `doctor` rend son verdict en moins d'une seconde, et c'est ce qui le rend
 * lançable en boucle courte, avant chaque commit, dans un job de forge. Lancer
 * une suite de tests et une requête réseau le ferait passer à des dizaines de
 * secondes — et un diagnostic qui coûte une minute cesse d'être lancé. Le dépôt
 * en a la preuve : un lot d'auto-contrôles écrit, juste, et resté un mois sans
 * que personne ne l'exécute, parce qu'il fallait taper huit commandes.
 *
 * D'où `--deep` : deux publics, deux régimes. La boucle courte veut un verdict
 * immédiat ; celui qui prépare un déploiement veut tout.
 *
 * ## Ce que cet étage n'invente pas
 *
 * Il n'implémente AUCUN contrôle en propre. Il appelle les scripts du projet et
 * rend leur verdict — une seule implémentation par règle, celle que le projet a
 * déjà écrite. Redéfinir ici « ce que typecheck devrait vérifier » créerait une
 * seconde vérité qui divergerait de la première au premier ajout.
 *
 * @module
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { aggregateOutdated, type IOutdatedSummary } from "../../cli/outdated";
import type { NpmOutdatedReport } from "../../cli/outdated";

/**
 * Le temps au-delà duquel on cesse d'attendre un script, en millisecondes.
 *
 * 🔴 Vécu, et cher : `npm audit` ne rendait pas d'erreur — il PENDAIT cinq
 * minutes par essai et tuait le job de forge. Une commande qui n'a pas de borne
 * de temps n'échoue pas, elle immobilise ; et l'opérateur conclut que l'outil
 * est cassé, jamais que le réseau ne répond pas.
 */
const LIMITE_MS = 120_000;

/** Le temps accordé au registre npm — plus court : c'est du réseau, pas du calcul. */
const LIMITE_RESEAU_MS = 30_000;

/**
 * Ce qu'un étage profond ANNONCE pendant qu'il travaille.
 *
 * `--deep` lance des scripts qui prennent des minutes. Sans un mot, la commande
 * paraît bloquée — et un utilisateur qui croit un outil bloqué l'interrompt,
 * puis cesse de s'en servir. L'annonce n'est donc pas un confort : c'est ce qui
 * rend l'étage utilisable.
 *
 * Deux évènements par script, `start` puis `done` : le premier dit CE QUI est
 * en cours (la seule information utile pendant l'attente), le second ce qu'il a
 * donné et en combien de temps.
 */
export interface IDeepProgress {
  /** Le nom du script, ou `outdated` pour l'interrogation du registre. */
  step: string;
  phase: "start" | "done";
  /** Renseignés sur `done` seulement. */
  outcome?: IVerifyStepResult["outcome"] | "ok" | "unavailable";
  ms?: number;
}

/** Ce qui reçoit les annonces — `undefined` quand personne n'écoute. */
export type DeepReporter = (event: IDeepProgress) => void;

/** Le verdict d'un script déclaré par le projet, une fois lancé. */
export interface IVerifyStepResult {
  /** Le nom du script, tel qu'il figure dans `scripts` du manifeste. */
  step: string;
  /**
   * Ce qui s'est passé.
   *
   * `absent` n'est PAS un échec de cet étage : c'est le contrôle « les gardes
   * du projet sont-elles armées ? » qui en répond, et le dire deux fois ferait
   * compter un manquement pour deux.
   */
  outcome: "passed" | "failed" | "absent" | "timeout";
  /** La première ligne utile de la sortie, quand il a échoué. */
  detail?: string;
  /** Durée d'exécution, en millisecondes. */
  ms: number;
}

/** Ce que l'étage profond a pu établir — et ce qu'il n'a PAS pu. */
export interface IDeepResult {
  steps: IVerifyStepResult[];
  /** Le résumé des paquets en retard, ou `null` si le registre n'a pas répondu. */
  outdated: IOutdatedSummary | null;
  /** Pourquoi le registre n'a rien dit — vide quand il a répondu. */
  outdatedReason: string;
}

/**
 * Les scripts que le manifeste déclare, parmi ceux qu'on sait lancer.
 *
 * On ne lance QUE ce que le projet déclare : inventer une commande qu'il n'a
 * pas (`npx tsc`, par exemple) reviendrait à juger une application sur un
 * outillage qu'elle n'a pas choisi.
 *
 * @param projectRoot - racine de l'application.
 * @param steps - les noms de scripts à chercher, dans l'ordre d'exécution.
 * @returns les noms présents, et ceux qui manquent.
 */
export function declaredSteps(
  projectRoot: string,
  steps: readonly string[],
): { present: string[]; missing: string[] } {
  const manifeste = path.join(projectRoot, "package.json");
  if (!existsSync(manifeste)) return { present: [], missing: [...steps] };
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(readFileSync(manifeste, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    // Un manifeste illisible est un problème que d'autres contrôles nomment ;
    // ici on constate seulement qu'on n'a rien à lancer.
    return { present: [], missing: [...steps] };
  }
  const present: string[] = [];
  const missing: string[] = [];
  for (const s of steps) {
    if (typeof scripts[s] === "string") present.push(s);
    else missing.push(s);
  }
  return { present, missing };
}

/**
 * La première ligne qui NOMME l'échec, en sautant l'annonce de l'exécuteur.
 *
 * 🔴 Un script lancé par `npm run` reçoit d'abord `npm notice run <app> <nom>`.
 * Retenir cette ligne explique l'échec par le nom du script, jamais par la
 * cause — et le rapport devient inutile sans qu'on s'en aperçoive : il a
 * l'apparence d'une explication. Le bruit est donc sauté sur les DEUX flux
 * avant de se rabattre sur l'un d'eux.
 *
 * @param stderr - canal d'erreur du script.
 * @param stdout - sa sortie standard.
 * @returns la ligne utile, bornée, ou une chaîne vide s'il s'est tu.
 */
export function firstUsefulLine(stderr: string, stdout: string): string {
  const bruit =
    /^(?:npm (?:notice|warn|WARN|ERR!)\b|>\s|\$\s|yarn run |pnpm )/u;
  const flux = [stderr, stdout];
  for (const f of flux) {
    const utile = f
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !bruit.test(l));
    if (utile.length > 0) return borner(utile[0] as string);
  }
  for (const f of flux) {
    const lignes = f.split("\n").filter((l) => l.trim().length > 0);
    if (lignes.length > 0) return borner((lignes[0] as string).trim());
  }
  return "";
}

/** Borne une explication : une trace entière rend le rapport illisible. */
function borner(ligne: string): string {
  return ligne.length > 160 ? `${ligne.slice(0, 157)}…` : ligne;
}

/**
 * Lance les scripts déclarés, dans l'ordre, et rend leur verdict.
 *
 * L'ordre compte : `typecheck` avant `test`, parce qu'un type faux fait échouer
 * la suite pour une raison qui n'a rien à voir avec elle, et qu'on veut lire la
 * cause d'abord.
 *
 * @param projectRoot - racine de l'application.
 * @param steps - les scripts à lancer, dans l'ordre.
 * @param run - l'exécuteur, injecté pour que la logique s'éprouve sans lancer
 *   quoi que ce soit : une fonction qui appelle `spawnSync` en dur ne se teste
 *   que sur la machine qui l'exécute, c'est-à-dire nulle part.
 * @returns un verdict par script demandé.
 */
export function runVerifySteps(
  projectRoot: string,
  steps: readonly string[],
  run: (step: string) => {
    status: number | null;
    stderr: string;
    stdout: string;
    ms: number;
  } = (step) => runNpmScript(projectRoot, step),
  report?: DeepReporter,
): IVerifyStepResult[] {
  const { present } = declaredSteps(projectRoot, steps);
  const resultats: IVerifyStepResult[] = [];
  for (const step of steps) {
    if (!present.includes(step)) {
      // Un script absent n'est pas ANNONCÉ : rien n'a été lancé, et prévenir
      // qu'on ne lance pas quelque chose ajoute du bruit à une attente.
      resultats.push({ step, outcome: "absent", ms: 0 });
      continue;
    }
    report?.({ step, phase: "start" });
    const r = run(step);
    if (r.status === null) {
      report?.({ step, phase: "done", outcome: "timeout", ms: r.ms });
      resultats.push({
        step,
        outcome: "timeout",
        ms: r.ms,
        detail: `interrompu après ${Math.round(r.ms / 1000)} s — sans borne de temps, une commande qui ne rend pas la main immobilise au lieu d'échouer`,
      });
      continue;
    }
    report?.({
      step,
      phase: "done",
      outcome: r.status === 0 ? "passed" : "failed",
      ms: r.ms,
    });
    resultats.push(
      r.status === 0
        ? { step, outcome: "passed", ms: r.ms }
        : {
            step,
            outcome: "failed",
            ms: r.ms,
            detail: firstUsefulLine(r.stderr, r.stdout),
          },
    );
  }
  return resultats;
}

/** Lance un script npm du projet, borné dans le temps. */
function runNpmScript(
  projectRoot: string,
  step: string,
): { status: number | null; stderr: string; stdout: string; ms: number } {
  const debut = Date.now();
  const r = spawnSync("npm", ["run", step], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: LIMITE_MS,
    // `shell` sous Windows : `npm` y est un `.cmd`, que Node refuse d'exécuter
    // sans shell depuis le correctif de CVE-2024-27980 — et il rend `ENOENT`,
    // qui se lit « npm n'est pas installé » sur une machine où il l'est.
    shell: process.platform === "win32",
  });
  return {
    // `signal` posé = tué par la borne de temps, pas terminé : `status` vaut
    // alors `null`, et le confondre avec 0 ferait passer un timeout pour un
    // succès.
    status: r.signal ? null : (r.status ?? 1),
    stderr: r.stderr ?? "",
    stdout: r.stdout ?? "",
    ms: Date.now() - debut,
  };
}

/**
 * Le résumé des paquets en retard, via la MÊME agrégation que `nodefony outdated`.
 *
 * `aggregateOutdated` est appelée, jamais recopiée : elle porte le classement
 * par sévérité (majeure / mineure / correctif) et le regroupement par paquet.
 * Une seconde implémentation ici divergerait au premier ajustement, et les deux
 * passeraient leurs propres tests.
 *
 * @param projectRoot - racine de l'application.
 * @param run - l'exécuteur, injecté pour l'épreuve.
 * @returns le résumé, ou la raison de son absence.
 */
export function readOutdated(
  projectRoot: string,
  run: () => { stdout: string; failed: boolean } = () =>
    runNpmOutdated(projectRoot),
  report?: DeepReporter,
): { summary: IOutdatedSummary | null; reason: string } {
  const debut = Date.now();
  report?.({ step: "outdated", phase: "start" });
  const r = run();
  const annoncer = (outcome: "ok" | "unavailable"): void =>
    report?.({
      step: "outdated",
      phase: "done",
      outcome,
      ms: Date.now() - debut,
    });
  if (r.failed) {
    annoncer("unavailable");
    return {
      summary: null,
      reason:
        "le registre npm n'a pas répondu dans le temps imparti — ce n'est " +
        "pas un défaut de l'application, et rien n'en est déduit",
    };
  }
  // `npm outdated` sort en 1 quand il TROUVE des paquets en retard : son code
  // de sortie n'est donc pas un verdict, seulement un compte. Ne pas le lire
  // comme un échec est ce qui distingue « rien à signaler » de « rien lu ».
  if (r.stdout.trim().length === 0) {
    annoncer("ok");
    return { summary: aggregateOutdated({}), reason: "" };
  }
  try {
    const summary = aggregateOutdated(
      JSON.parse(r.stdout) as NpmOutdatedReport,
    );
    annoncer("ok");
    return { summary, reason: "" };
  } catch {
    annoncer("unavailable");
    return {
      summary: null,
      reason: "la réponse du registre npm n'était pas lisible",
    };
  }
}

/** Interroge le registre, borné — le réseau ne se laisse pas attendre. */
function runNpmOutdated(projectRoot: string): {
  stdout: string;
  failed: boolean;
} {
  const r = spawnSync("npm", ["outdated", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: LIMITE_RESEAU_MS,
    shell: process.platform === "win32",
  });
  return { stdout: r.stdout ?? "", failed: Boolean(r.signal) };
}
