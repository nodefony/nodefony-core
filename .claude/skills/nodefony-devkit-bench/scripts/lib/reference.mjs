/**
 * RÉFÉRENCE versionnée du banc — ce à quoi un run se compare.
 *
 * Le banc rend des verdicts binaires sur des agents non déterministes : rejouer
 * les 25 tâches trois fois à chaque changement coûte des heures et des dizaines
 * de dollars, et rejouer une seule fois ne prouve rien (T14 : même gabarit,
 * même modèle, même décor → 2 PASS / 2 FAIL). La sortie n'est ni « tout, trois
 * fois » ni « tout, une fois », c'est le DÉPISTAGE : un run large qui se compare
 * à une référence écrite, et qui NOMME le peu qui mérite trois runs.
 *
 * Trois règles, toutes payées par une erreur déjà commise :
 *
 *  1. **Unanimité.** Un verdict agrégé n'est PASS que si TOUS les runs sont
 *     PASS. Une tâche qui passe deux fois sur trois n'est pas « plutôt bonne » :
 *     elle est instable, donc non prouvée — et c'est exactement l'état dans
 *     lequel un « c'est corrigé » a déjà été écrit.
 *  2. **Asymétrie.** Une CHUTE (référence PASS → run FAIL) et une REMONTÉE
 *     (référence FAIL → run PASS) demandent toutes deux confirmation, mais la
 *     remontée est la plus traître : elle SUIT une correction, elle arrive quand
 *     on l'espère, et on la croit. Un vert qui suit un correctif exige trois
 *     runs — l'erreur de la session qui a produit cette règle.
 *  3. **Le décor est une variable de la mesure.** Modèle, nature du décor
 *     (isolé / lié) et agent : deux runs qui n'en partagent pas les trois ne se
 *     comparent pas. Le module REFUSE, il ne prévient pas — un avertissement se
 *     lit après coup, une comparaison fausse s'utilise tout de suite.
 *
 * Le commit du dépôt, lui, s'ENREGISTRE sans jamais être exigé identique :
 * c'est précisément ce qu'on veut voir changer entre la référence et le run.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Emplacement de la référence — dans le SKILL, donc versionnée avec le banc.
 *
 * Elle vaut pour le dépôt entier et se relit en diff (`git log -p`) : c'est ce
 * qui permet de dire « cette tâche est passée au vert à ce commit-là ». Un
 * fichier posé dans le run, lui, disparaît avec le décor jetable.
 */
export const CHEMIN_REFERENCE = path.join(
  // …/scripts/lib/reference.mjs → la RACINE du skill, à côté du SKILL.md : une
  // référence rangée sous `scripts/` se lit comme un artefact d'outillage,
  // alors qu'elle est la mesure elle-même.
  path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
  "baseline.json",
);

/** Champs du décor qui doivent CORRESPONDRE pour qu'une comparaison ait un sens. */
const CHAMPS_DECOR = ["model", "decor", "agent"];

/**
 * Empreinte d'une TÂCHE — l'énoncé et ce qu'on juge.
 *
 * Le décor est une variable de la mesure ; la tâche en est une autre, et elle
 * se modifie bien plus souvent. Vécu à l'heure près : la route de l'énoncé a
 * changé de préfixe, ce qui change tout ce que l'agent doit écrire — et sans
 * cette empreinte, le dépistage suivant aurait comparé le résultat à une
 * référence mesurée sur une AUTRE question, puis annoncé une « remontée » ou
 * une « chute » avec le même aplomb.
 *
 * Ne couvre que ce qui change la RÉPONSE ATTENDUE : l'énoncé, la préparation du
 * décor, et le nom des sondes. Un commentaire réécrit ne casse donc pas la
 * comparaison ; une sonde ajoutée, si.
 *
 * @param {{prompt?: string, prepare?: string, probes?: Array<{name: string}>}} task
 * @returns {string} douze caractères — assez pour distinguer, assez court pour se lire.
 */
export function empreinteTache(task) {
  const matiere = JSON.stringify([
    task.prompt ?? "",
    task.prepare ?? "",
    (task.probes ?? []).map((p) => p.name).sort(),
  ]);
  return createHash("sha256").update(matiere).digest("hex").slice(0, 12);
}

/**
 * Lit la référence versionnée.
 *
 * @returns {object|null} la référence, ou `null` si elle n'a jamais été écrite.
 */
export function lireReference(chemin = CHEMIN_REFERENCE) {
  if (!existsSync(chemin)) return null;
  return JSON.parse(readFileSync(chemin, "utf8"));
}

/**
 * Écrit la référence. Appelée UNIQUEMENT sur demande explicite de l'opérateur
 * (`--enregistrer-reference`) : une référence qui se met à jour toute seule
 * finit par enregistrer la régression qu'elle était censée détecter.
 */
export function ecrireReference(ref, chemin = CHEMIN_REFERENCE) {
  writeFileSync(chemin, JSON.stringify(ref, null, 2) + "\n");
  return chemin;
}

/** Verdict d'un run dont une sonde rouge ne portait pas sur l'état mesuré. */
export const NON_JUGEABLE = "NON JUGEABLE";

/**
 * Verdict d'une tâche jouée N fois — PASS seulement à l'UNANIMITÉ.
 *
 * Les runs NON JUGEABLES sont ÉCARTÉS, pas comptés : un rouge qui ne porte pas
 * sur l'état de la tâche (gate rejouée sur l'app d'aujourd'hui) fabriquerait
 * une régression, et le compter PASS fabriquerait une preuve. Si aucun run ne
 * reste, la tâche n'a pas de verdict — et c'est une réponse, pas un échec.
 *
 * @param {string[]} verdicts - un verdict par répétition.
 * @returns {{verdict: string, passes: number, total: number, stable: boolean, ecartes: number}}
 *   `total` compte les runs RETENUS. `stable` distingue « 3/3 » de « 2/3 » : les
 *   deux sont FAIL ou PASS, mais un résultat partagé se signale.
 * @throws {Error} si la liste est vide — un verdict sans run n'existe pas.
 */
/**
 * Écart RELATIF au-delà duquel une dérive de tours mérite d'être signalée.
 *
 * Choisi sur la dispersion MESURÉE, pas au jugé : sur la tâche 13, les runs où
 * l'agent trouve le générateur tiennent en 52-54 tours, ceux où il ne le trouve
 * pas en 69-88. Le plus petit écart réel vaut donc ~28 %. En dessous de 25 %, on
 * regarde le bruit d'un modèle non déterministe.
 */
export const SEUIL_DERIVE_TOURS = 0.25;

/**
 * Plancher ABSOLU sous lequel aucune dérive n'est signalée.
 *
 * Sans lui, une tâche à 4 tours qui en prend 6 déclencherait une alerte à +50 %
 * pour deux tours d'écart — du bruit présenté comme un signal. Les tâches
 * courtes du banc (7 à 14 tours) sont précisément celles où le devkit marche
 * déjà : elles n'ont rien à nous apprendre par ce canal.
 */
export const PLANCHER_DERIVE_TOURS = 8;

/**
 * Médiane des tours d'une tâche jouée N fois.
 *
 * 🔴 **La MÉDIANE, jamais le dernier run ni la moyenne.** Le verdict binaire
 * d'une tâche a une résolution catastrophique — à l'unanimité sur 3 runs, une
 * tâche que le devkit réussit 4 fois sur 5 sort « instable » une fois sur deux,
 * et trois runs payés n'apprennent alors rien. Le nombre de TOURS, lui, est
 * continu : il sépare nettement là où le verdict hésite. C'est la même
 * information vue par l'autre bout — ce que l'agent ne trouve pas, il le
 * cherche.
 *
 * La moyenne serait tirée par un run qui part en boucle ; la médiane tient.
 *
 * @param {Array<{tours?: number}|null|undefined>} efforts - un effort par run.
 * @returns {number|null} la médiane arrondie, ou `null` si aucun run ne l'a mesurée.
 */
export function medianeTours(efforts) {
  const tours = (efforts ?? [])
    .map((e) => e?.tours)
    .filter((n) => typeof n === "number" && Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!tours.length) return null;
  const milieu = Math.floor(tours.length / 2);
  return tours.length % 2
    ? tours[milieu]
    : Math.round((tours[milieu - 1] + tours[milieu]) / 2);
}

/**
 * Une dérive de tours mérite-t-elle d'être signalée, et dans quel sens ?
 *
 * @param {number|null|undefined} avant - médiane de référence.
 * @param {number|null|undefined} apres - médiane du run.
 * @returns {{signale: boolean, sens: "alourdie"|"allegee"|null, ecart: number}}
 *   `ecart` est relatif et signé (+0.3 = 30 % de tours en plus).
 */
export function deriveTours(avant, apres) {
  const muet = { signale: false, sens: null, ecart: 0 };
  if (typeof avant !== "number" || typeof apres !== "number") return muet;
  if (avant <= 0) return muet;
  // Le plancher porte sur les DEUX bornes : passer de 4 à 12 tours est aussi peu
  // parlant que l'inverse, et l'un comme l'autre reste sous le bruit utile.
  if (avant < PLANCHER_DERIVE_TOURS && apres < PLANCHER_DERIVE_TOURS)
    return muet;
  const ecart = (apres - avant) / avant;
  if (Math.abs(ecart) < SEUIL_DERIVE_TOURS) return muet;
  return { signale: true, sens: ecart > 0 ? "alourdie" : "allegee", ecart };
}

export function verdictAgrege(verdicts) {
  if (!verdicts?.length) throw new Error("verdictAgrege : aucun run");
  const ecartes = verdicts.filter((v) => v === NON_JUGEABLE).length;
  const retenus = verdicts.filter((v) => v !== NON_JUGEABLE);
  if (!retenus.length) {
    return {
      verdict: NON_JUGEABLE,
      passes: 0,
      total: 0,
      stable: false,
      ecartes,
    };
  }
  const passes = retenus.filter((v) => v === "PASS").length;
  return {
    verdict: passes === retenus.length ? "PASS" : "FAIL",
    passes,
    total: retenus.length,
    stable: passes === 0 || passes === retenus.length,
    ecartes,
  };
}

/**
 * Le run et la référence parlent-ils du même décor ?
 *
 * @returns {{compatible: boolean, ecarts: Array<{champ: string, reference: unknown, run: unknown}>}}
 */
export function comparerDecor(ref, run) {
  const ecarts = [];
  for (const champ of CHAMPS_DECOR) {
    // Un champ absent d'une référence ancienne n'est pas un écart : on ne peut
    // pas reprocher à un enregistrement de ne pas porter ce qui n'existait pas.
    if (ref[champ] === undefined || run[champ] === undefined) continue;
    if (ref[champ] !== run[champ]) {
      ecarts.push({ champ, reference: ref[champ], run: run[champ] });
    }
  }
  return { compatible: ecarts.length === 0, ecarts };
}

/**
 * Confronte les résultats d'un run à la référence.
 *
 * Ne décide RIEN et ne relance RIEN : rend le classement, à l'opérateur de
 * lancer les trois runs. Un banc qui relance seul dépense sans qu'on l'ait
 * voulu, et le seul chiffre qu'on regarde alors est la facture.
 *
 * @param {object} ref - référence chargée (`{verdicts: {id: {verdict, runs}}}`).
 * @param {Array<{id: number, verdict: string, passes?: number, total?: number}>} results
 * @returns {{stables: object[], chutes: object[], remontees: object[], inconnues: object[], instables: object[], aRejouer: number[]}}
 */
export function depister(ref, results) {
  const stables = [];
  // Verdict INCHANGÉ, effort qui bouge : le seul canal où un progrès de guidage
  // se voit sans repayer trois runs. Ces tâches ne se REJOUENT pas — elles se
  // regardent.
  const alourdies = [];
  const allegees = [];
  const chutes = [];
  const remontees = [];
  const inconnues = [];
  const instables = [];
  const modifiees = [];
  for (const r of results) {
    // Une tâche RÉÉCRITE ne se compare pas : ni chute ni remontée, la question
    // n'est plus la même. Elle se remesure, et sa référence se réécrit.
    const ref0 = ref.verdicts?.[String(r.id)];
    if (ref0?.empreinte && r.empreinte && ref0.empreinte !== r.empreinte) {
      modifiees.push({ ...r, reference: ref0 });
      continue;
    }
    // Un run partagé (2/3) ne se classe pas par son verdict : il DIT déjà que la
    // tâche est instable, quelle que soit la référence. Le confondre avec une
    // chute enverrait chercher une régression là où il n'y a qu'un aléa connu.
    if (r.total > 1 && r.passes > 0 && r.passes < r.total) {
      instables.push(r);
      continue;
    }
    const attendu = ref.verdicts?.[String(r.id)];
    if (!attendu) {
      inconnues.push(r);
    } else if (attendu.verdict === r.verdict) {
      const derive = deriveTours(attendu.tours, r.tours);
      const entree = { ...r, reference: attendu, derive };
      stables.push(entree);
      if (derive.signale) {
        (derive.sens === "alourdie" ? alourdies : allegees).push(entree);
      }
    } else if (attendu.verdict === "PASS") {
      chutes.push({ ...r, reference: attendu });
    } else {
      remontees.push({ ...r, reference: attendu });
    }
  }
  // Les stables ne se rejouent pas — c'est tout l'intérêt : le dépistage achète
  // du silence sur ce qui n'a pas bougé.
  const aRejouer = [
    ...chutes,
    ...remontees,
    ...instables,
    ...inconnues,
    ...modifiees,
  ]
    .filter((r) => (r.total ?? 1) < 3)
    .map((r) => r.id);
  return {
    stables,
    chutes,
    remontees,
    inconnues,
    instables,
    modifiees,
    // Sous-ensembles de `stables` : à AFFICHER, jamais à rejouer. Les inclure
    // dans `aRejouer` rendrait au dépistage le coût qu'il existe pour éviter.
    alourdies,
    allegees,
    aRejouer,
  };
}

/**
 * Fusionne les résultats d'un run dans la référence, tâche par tâche.
 *
 * Fusion et non remplacement : un run de dépistage ne joue parfois que trois
 * tâches, et écraser la référence entière effacerait vingt-deux verdicts que ce
 * run n'a jamais mesurés — un oubli qui ne se voit qu'au dépistage suivant,
 * quand tout ressort « inconnu ».
 *
 * @throws {Error} si le décor du run diffère de celui de la référence : mélanger
 *   deux décors dans un même fichier produit une référence qui ne décrit aucun
 *   état réel, et rien ne le signalerait ensuite.
 */
export function fusionnerReference(ref, run) {
  if (ref) {
    const { compatible, ecarts } = comparerDecor(ref, run);
    if (!compatible) {
      throw new Error(
        "décor différent de la référence — " +
          ecarts
            .map((e) => `${e.champ} : « ${e.reference} » ≠ « ${e.run} »`)
            .join(" · ") +
          "\nUne référence ne mélange pas deux décors. Écrire un fichier séparé " +
          "ou rejouer dans le décor de la référence.",
      );
    }
  }
  const verdicts = { ...ref?.verdicts };
  for (const r of run.results) {
    verdicts[String(r.id)] = {
      verdict: r.verdict,
      runs: r.total ?? 1,
      passes: r.passes ?? (r.verdict === "PASS" ? 1 : 0),
      // La MESURE que le verdict binaire jette. Elle ne décide rien — elle rend
      // comparable ce qui, sinon, ressort « instable » d'un run à l'autre sans
      // qu'on apprenne jamais rien.
      tours: r.tours ?? null,
      // L'énoncé mesuré, pas seulement son résultat : une référence qui ne dit
      // pas à quelle QUESTION elle répond se compare à n'importe quoi.
      empreinte: r.empreinte,
      // `date` = quand on a ENREGISTRÉ ; `sources` = quand on a MESURÉ. Un
      // re-jugement sépare les deux, et seule la seconde situe la mesure.
      date: run.date,
      sources: run.sources,
      commit: run.commit,
    };
  }
  return {
    model: run.model,
    decor: run.decor,
    agent: run.agent,
    // Trace de la dernière écriture. Le commit par TÂCHE (ci-dessus) est celui
    // qui compte : une référence se remplit par morceaux, à des commits
    // différents, et confondre les deux ferait croire à un état d'ensemble.
    date: run.date,
    commit: run.commit,
    verdicts,
  };
}
