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

/** Le dossier des juges et des préparateurs — `…/scripts/lib`. */
const DOSSIER_LIB = path.dirname(fileURLToPath(import.meta.url));

/** La racine du dépôt : `…/<repo>/.claude/skills/<skill>/scripts/lib` remonté de cinq crans. */
const RACINE_DEPOT = path.dirname(
  path.dirname(path.dirname(path.dirname(path.dirname(DOSSIER_LIB)))),
);

/**
 * Un texte débarrassé de ce qui dépend de la MACHINE, puis de sa mise en forme.
 *
 * 🔴 Les tâches composent leurs chemins de juge en ABSOLU (`path.join(dirname,
 * "lib", "gate-x.mjs")`), et un `prepare` les porte tels quels. L'empreinte en
 * héritait : mesuré, la même tâche rendait `b64564eb4de3` ici et `7f2a8c283449`
 * sous `/home/runner/work` — deux machines, deux empreintes, et un dépistage
 * qui aurait annoncé « tâche réécrite » sur un dépôt simplement cloné ailleurs.
 * Une référence est VERSIONNÉE : elle doit valoir pour qui la relit.
 *
 * Remplacer « la racine de CETTE machine » ne suffit pas : elle est la seule
 * qu'on connaisse, et l'empreinte doit valoir pour un dépôt cloné ailleurs. La
 * normalisation coupe donc à un REPÈRE présent dans le chemin — `.claude/` —,
 * ce qui vaut pour n'importe quel préfixe, connu ou non. Les séparateurs
 * passent en `/` d'abord : deux plateformes ne doivent pas produire deux
 * empreintes (axiome « normaliser AVANT de comparer »).
 *
 * L'espace est ensuite écrasé pour qu'un passage du formateur n'invalide pas
 * des mesures payées. Tout le reste — un token, un opérateur, un seuil —
 * continue de compter.
 *
 * @param {unknown} texte
 * @returns {string}
 */
const stable = (texte) =>
  String(texte ?? "")
    .split("\\")
    .join("/")
    // La lettre de lecteur fait partie du préfixe à couper : sans elle,
    // `D:/a/x/.claude/…` garde son `D:` et Windows rend une TROISIÈME empreinte.
    .replace(/(?:[A-Za-z]:)?\/[^\s"'`]*?(\.claude\/)/gu, "<repo>/$1")
    .split(RACINE_DEPOT.split(path.sep).join("/"))
    .join("<repo>")
    .replace(/\s+/gu, " ")
    .trim();

/**
 * Les fichiers de code dont dépend le VERDICT d'une tâche.
 *
 * Ils ne se déclarent nulle part : ils se LISENT dans la tâche, puisqu'une
 * sonde de type `gate` nomme son juge dans sa commande et qu'un `prepare` nomme
 * son préparateur. Une table à tenir à la main serait un troisième endroit à
 * synchroniser, donc un troisième endroit à oublier.
 *
 * @param {{prepare?: string, probes?: Array<{cmd?: string[]}>}} task
 * @returns {string[]} les noms de fichiers, triés.
 */
export function fichiersDuVerdict(task) {
  const textes = [String(task.prepare ?? "")];
  for (const p of task.probes ?? [])
    if (Array.isArray(p.cmd)) textes.push(p.cmd.join(" "));
  const noms = new Set();
  for (const t of textes)
    for (const m of t.matchAll(/[\w.-]+\.mjs(?![\w.])/gu)) noms.add(m[0]);
  return [...noms].sort();
}

/**
 * Empreinte d'une TÂCHE — l'énoncé, et TOUT ce qui décide de son verdict.
 *
 * Le décor est une variable de la mesure ; la tâche en est une autre, et elle
 * se modifie bien plus souvent. Vécu à l'heure près : la route de l'énoncé a
 * changé de préfixe, ce qui change tout ce que l'agent doit écrire — et sans
 * cette empreinte, le dépistage suivant aurait comparé le résultat à une
 * référence mesurée sur une AUTRE question, puis annoncé une « remontée » ou
 * une « chute » avec le même aplomb.
 *
 * 🔴 **Le NOM d'une sonde ne dit pas ce qu'elle juge.** L'empreinte ne couvrait
 * que l'énoncé, le `prepare` et les noms — jamais le code qui rend le verdict.
 * Corriger un juge n'invalidait donc rien : trois juges qui punissaient une
 * protection légitime ont été corrigés, un quatrième était mort depuis cinq
 * jours, et pas une seule référence n'a bougé. On comparait des verdicts
 * d'aujourd'hui à des verdicts rendus par un juge qui n'existe plus, et le
 * dépistage annonçait « conforme à la référence » avec l'aplomb d'une mesure.
 *
 * Entrent donc dans l'empreinte : l'énoncé, le `prepare`, les noms des sondes,
 * **le source de chaque `observe`**, et **le contenu de chaque fichier de juge
 * ou de préparateur** que la tâche nomme. Un commentaire réécrit dans un juge
 * invalide sa tâche : c'est voulu — refuser à tort coûte un run nommé, comparer
 * à tort coûte la mesure entière et ne se voit pas.
 *
 * @param {{prompt?: string, prepare?: string, probes?: Array<{name: string, observe?: Function, cmd?: string[]}>}} task
 * @returns {string} douze caractères — assez pour distinguer, assez court pour se lire.
 */
export function empreinteTache(task) {
  const sondes = (task.probes ?? [])
    .map((p) => [
      p.name,
      typeof p.observe === "function" ? stable(p.observe) : "",
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const juges = fichiersDuVerdict(task).map((nom) => {
    for (const dossier of [DOSSIER_LIB, path.dirname(DOSSIER_LIB)]) {
      const f = path.join(dossier, nom);
      if (existsSync(f)) {
        return [
          nom,
          createHash("sha256")
            .update(stable(readFileSync(f, "utf8")))
            .digest("hex")
            .slice(0, 12),
        ];
      }
    }
    // Un juge introuvable est un fait, pas une erreur à taire : l'empreinte
    // change le jour où il revient, et la tâche se remesure.
    return [nom, "ABSENT"];
  });
  const matiere = JSON.stringify([
    stable(task.prompt),
    stable(task.prepare),
    sondes,
    juges,
  ]);
  return createHash("sha256").update(matiere).digest("hex").slice(0, 12);
}

/**
 * La référence de CET agent — un fichier par agent, à côté du `SKILL.md`.
 *
 * `claude` garde `baseline.json` : c'est l'agent de la référence historique, et
 * la renommer couperait l'historique git de la seule mesure qu'on relit en diff.
 * Les autres reçoivent `baseline.<agent>.json`.
 *
 * Pourquoi séparer plutôt qu'un seul fichier multi-agents : la garde de décor
 * (`fusionnerReference`) REFUSE déjà de mélanger deux décors et renvoyait
 * l'opérateur vers « un fichier séparé » — que rien ne savait produire. Un agent
 * tiers n'avait donc aucune référence, donc pas de `--depistage`, donc aucune
 * façon de répondre « qu'est-ce qui a bougé ? ». La garde reste entière À
 * L'INTÉRIEUR de chaque fichier : elle protège encore du mélange de modèle, de
 * décor et de régime MCP, qui sont les vraies variables d'une mesure.
 *
 * ⚠️ Écrire le fichier est bon marché ; le REMPLIR ne l'est pas. Une référence
 * n'a de sens que si l'agent est REJOUABLE, et l'entrée dans la référence exige
 * l'unanimité sur trois passes. Mesuré : trois agents sur quatre butent sur un
 * mur de fournisseur avant d'avoir fini une seule passe.
 *
 * @param {string} agent - l'agent mesuré (`NF_DEVKIT_BENCH_AGENT`).
 * @returns {string} le chemin de sa référence.
 */
export function cheminReference(agent) {
  return agent === "claude"
    ? CHEMIN_REFERENCE
    : path.join(path.dirname(CHEMIN_REFERENCE), `baseline.${agent}.json`);
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
