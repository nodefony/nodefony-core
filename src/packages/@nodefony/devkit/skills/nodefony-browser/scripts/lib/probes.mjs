/**
 * Grammaire de la ligne de commande des sondes — fonctions PURES, sans
 * navigateur, sans réseau, sans état.
 *
 * Extraites des scripts pour être éprouvées par des tests qui tournent
 * partout : une allowlist de familles qui laisse passer un nom inconnu, ou un
 * découpage de sélecteurs qui avale une entrée malformée, produit une mesure
 * FAUSSE en silence — exactement la classe de bug qu'une sonde ne peut pas se
 * permettre.
 */
import { createHash } from "node:crypto";

/**
 * Les familles de sondes activables — l'allowlist, et sa documentation.
 *
 * Un nom absent d'ici est REFUSÉ (code 64), jamais ignoré : une famille
 * fautée en silence ferait croire qu'on a mesuré ce qu'on n'a pas mesuré.
 */
export const FAMILLES = Object.freeze({
  a11y: "accessibilité — étiquettes, noms accessibles, titres, cibles, arbre ARIA",
  axe: "audit WCAG complet par axe-core — une centaine de règles, dont le contraste de tout le texte",
  rendu:
    "rendu — débordement horizontal, éléments hors viewport, polices réellement chargées",
  reseau: "réseau — requêtes, échecs, ressources lourdes, temps de réponse",
  perf: "temps de rendu — TTFB, FCP, LCP, CLS, tâches longues",
  stockage: "cookies (attributs, jamais les valeurs) et Web Storage",
  responsive: "débordement horizontal à plusieurs largeurs d'écran",
});

/**
 * Analyse la liste de familles demandée (`NF_BROWSER_FAMILIES`).
 *
 * `Object.hasOwn` et non `in` : `"toString" in FAMILLES` est vrai par la chaîne
 * de prototypes, et une « famille » toString serait acceptée sans exister.
 *
 * @param {string|undefined} brut - valeur brute (`"a11y,perf"`, `"toutes"`, vide).
 * @param {string[]} [defaut] - familles retenues quand rien n'est demandé.
 * @returns {{ retenues: string[], inconnues: string[] }} les familles valides,
 *   et celles qui n'existent pas — à refuser, jamais à ignorer.
 */
export function parseFamilies(brut, defaut = []) {
  const demande = String(brut ?? "").trim();
  if (!demande) return { retenues: [...defaut], inconnues: [] };
  if (demande === "toutes") {
    return { retenues: Object.keys(FAMILLES), inconnues: [] };
  }
  const retenues = [];
  const inconnues = [];
  for (const nom of demande
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)) {
    if (Object.hasOwn(FAMILLES, nom)) {
      if (!retenues.includes(nom)) retenues.push(nom);
    } else {
      inconnues.push(nom);
    }
  }
  return { retenues, inconnues };
}

/**
 * Analyse les sondes de style (`NF_BROWSER_PROBES`, forme `libellé=sélecteur`).
 *
 * Les entrées malformées sont RENDUES, pas avalées : une sonde qu'on croit
 * poser et qui n'existe pas est une mesure qui manque sans bruit.
 *
 * @param {string|undefined} brut - entrées séparées par des virgules.
 * @returns {{ sondes: { label: string, sel: string }[], rejetees: string[] }}
 */
export function parseProbes(brut) {
  const sondes = [];
  const rejetees = [];
  for (const morceau of String(brut ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const i = morceau.indexOf("=");
    const label = i > 0 ? morceau.slice(0, i).trim() : "";
    const sel = i > 0 ? morceau.slice(i + 1).trim() : "";
    if (label && sel) sondes.push({ label, sel });
    else rejetees.push(morceau);
  }
  return { sondes, rejetees };
}

/** Verbes qui prennent une VALEUR après la cible. Les autres n'en ont aucune. */
const VERBES_A_VALEUR = new Set(["saisir"]);

/** Verbes reconnus d'une action, le premier étant celui par défaut. */
export const VERBES_ACTION = [
  "clic",
  "double",
  "droit",
  "survol",
  "saisir",
  "touche",
  "voir",
  "defiler",
  "attendre",
];

/**
 * Analyse une séquence d'actions (`NF_BROWSER_ACTIONS`).
 *
 * Grammaire : `verbe:cible[=valeur]`, séquence séparée par `|`, verbe facultatif
 * (`clic` par défaut).
 *
 * ⚠️ Le signe `=` appartient AUSSI à la grammaire des sélecteurs CSS —
 * `[data-active=true]`, `input[type=search]`, `[aria-expanded="false"]`. Couper
 * la cible au premier `=` rencontré, ce que faisait la version précédente,
 * amputait ces sélecteurs : la cible devenait `[data-active` et la sonde
 * s'arrêtait en annonçant un élément introuvable, ce qui envoyait chercher un
 * défaut dans la page. D'où deux règles :
 *
 * 1. seuls les verbes qui PRENNENT une valeur (`saisir`) découpent sur `=` ;
 *    pour tous les autres, la cible est le reste entier ;
 * 2. même pour ceux-là, la coupure ignore les `=` situés à l'intérieur de
 *    crochets — `saisir:input[name=q]=bonjour` saisit bien « bonjour » dans
 *    `input[name=q]`.
 *
 * @param brut - la valeur de la variable d'environnement, ou une chaîne vide.
 * @returns la liste des actions `{ verbe, cible, valeur }`, dans l'ordre.
 */
export function parseActions(brut) {
  const verbes = VERBES_ACTION.join("|");
  const entete = new RegExp(`^(${verbes}):([\\s\\S]*)$`);
  return String(brut ?? "")
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((entree) => {
      const m = entete.exec(entree);
      const verbe = m ? m[1] : "clic";
      const reste = m ? m[2] : entree;
      if (!VERBES_A_VALEUR.has(verbe)) {
        return { verbe, cible: reste.trim(), valeur: "" };
      }
      // Dernier `=` HORS crochets : la valeur est ce qui suit.
      let profondeur = 0;
      let coupe = -1;
      for (let i = 0; i < reste.length; i += 1) {
        const c = reste[i];
        if (c === "[") profondeur += 1;
        else if (c === "]") profondeur = Math.max(0, profondeur - 1);
        else if (c === "=" && profondeur === 0) coupe = i;
      }
      return coupe === -1
        ? { verbe, cible: reste.trim(), valeur: "" }
        : {
            verbe,
            cible: reste.slice(0, coupe).trim(),
            valeur: reste.slice(coupe + 1),
          };
    });
}

/**
 * Analyse le schéma de couleurs demandé (`NF_BROWSER_COLOR_SCHEME`).
 *
 * Les valeurs sont celles de la MÉDIA QUERY standard, jamais le vocabulaire
 * d'une bibliothèque : `prefers-color-scheme` est ce que tout moteur de rendu
 * comprend, quelle que soit la trousse d'interface au-dessus.
 *
 * Une valeur inconnue est REFUSÉE : silencieusement ignorée, elle ferait
 * mesurer le thème par défaut en croyant tenir l'autre — le faux vert dont un
 * défaut visible dans UN SEUL thème est le cas d'école.
 *
 * @param {string|undefined} brut - valeur brute (`"light"`, `"dark"`, vide).
 * @returns {{ schema: "light"|"dark"|"no-preference"|null, invalide: string|null }}
 *   `schema` à null quand rien n'est demandé (on ne force rien).
 */
export function parseColorScheme(brut) {
  const v = String(brut ?? "")
    .trim()
    .toLowerCase();
  if (!v) return { schema: null, invalide: null };
  if (v === "light" || v === "dark" || v === "no-preference")
    return { schema: v, invalide: null };
  return { schema: null, invalide: v };
}

/**
 * Analyse les entrées de stockage à poser avant chargement (`NF_BROWSER_STORAGE`).
 *
 * Pourquoi ce détour plutôt qu'un réglage de thème tout fait : une application
 * qui MÉMORISE son thème ne suit plus `prefers-color-scheme`, et la clé qu'elle
 * emploie lui appartient. Chaque trousse d'interface a la sienne, et elles
 * changent d'une version à l'autre ; en coder une rendrait la sonde juste pour
 * cette trousse-là et faussement rassurante pour toutes les autres. La
 * précision vit donc dans l'ARGUMENT, jamais dans le code — c'est celui qui
 * connaît son application qui donne la clé.
 *
 * Forme `clé=valeur`, séparées par des virgules. Une valeur peut contenir `=`
 * (jeton, JSON) : seul le PREMIER `=` sépare.
 *
 * @param {string|undefined} brut - entrées séparées par des virgules.
 * @returns {{ entrees: { cle: string, valeur: string }[], rejetees: string[] }}
 */
export function parseStorage(brut) {
  const entrees = [];
  const rejetees = [];
  for (const morceau of String(brut ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const i = morceau.indexOf("=");
    const cle = i > 0 ? morceau.slice(0, i).trim() : "";
    const valeur = i > 0 ? morceau.slice(i + 1).trim() : "";
    if (cle && valeur) entrees.push({ cle, valeur });
    else rejetees.push(morceau);
  }
  return { entrees, rejetees };
}

/**
 * Les deux réglages qui dépendent de l'ENDROIT d'où la sonde s'exécute.
 *
 * Le navigateur tourne soit sur la machine du développeur, soit dans un
 * conteneur — et les deux ne voient pas le même monde : `127.0.0.1` désigne le
 * CONTENEUR lui-même quand on y est enfermé, et le dossier de sortie n'est un
 * volume monté que là-bas.
 *
 * Le verdict est INJECTÉ, jamais déduit d'une plateforme ni lu ici : c'est ce
 * qui rend cette fonction éprouvable des deux côtés sans conteneur, et ce qui
 * évite de faire dire à `process.platform` une chose qu'il ne sait pas. Une
 * capacité se constate ; c'est l'appelant qui constate, cette fonction décide.
 *
 * @param {{dansConteneur: boolean, base?: string, out?: string}} decor -
 *   le constat, et les valeurs explicites qui l'emportent toujours.
 * @returns {{ base: string, out: string }} origine à joindre, dossier de sortie.
 */
export function defautsDecor({ dansConteneur, base, out } = {}) {
  return {
    base:
      base ||
      (dansConteneur
        ? "https://host.docker.internal:5152"
        : "https://127.0.0.1:5152"),
    out: out || (dansConteneur ? "/output" : "tmp/browser"),
  };
}

/**
 * Nom du fichier d'état d'authentification, DÉRIVÉ de l'identifiant.
 *
 * Un état sauvegardé est réutilisé pour éviter de rejouer le parcours de
 * connexion à chaque sonde. Tant qu'il porte un nom unique, il est repris quel
 * que soit l'utilisateur demandé : on réclame une mesure sous un compte de
 * moindre privilège et l'on obtient celle de l'administrateur, sans un mot.
 * Vécu ici — un canal refusé au compte demandé s'ouvrait sous l'identité de la
 * sonde précédente. Une session appartient à quelqu'un ; son fichier le dit.
 *
 * Deux parties, deux rôles : un fragment LISIBLE, pour qu'un humain reconnaisse
 * ses fichiers dans le dossier de sortie, et une EMPREINTE de l'identifiant
 * complet, parce que deux identifiants distincts peuvent s'assainir en un même
 * fragment (`a@b` et `a-b`) — et une collision de nom rouvrirait exactement le
 * trou qu'on ferme.
 *
 * @param {string|undefined} identifiant - l'identifiant de connexion demandé.
 * @returns {string} le nom de fichier, sans dossier.
 */
export function nomEtatAuth(identifiant) {
  const brut = String(identifiant ?? "");
  const lisible =
    brut.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 40) || "anonyme";
  const empreinte = createHash("sha256").update(brut).digest("hex").slice(0, 8);
  return `.auth-state-${lisible}-${empreinte}.json`;
}

/**
 * Analyse les largeurs d'écran de la famille `responsive` (`NF_BROWSER_WIDTHS`).
 *
 * Bornes 240–4000 : en deçà aucun navigateur réel, au-delà on ne mesure plus un
 * écran mais un mur d'affichage — et un zéro ou un négatif ferait échouer le
 * redimensionnement avec un message qui n'incrimine pas la vraie cause.
 *
 * @param {string|undefined} brut - largeurs en pixels, séparées par des virgules.
 * @returns {{ largeurs: number[], invalides: string[] }}
 */
export function parseWidths(brut) {
  const largeurs = [];
  const invalides = [];
  for (const morceau of String(brut ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const n = Number(morceau);
    if (Number.isInteger(n) && n >= 240 && n <= 4000) {
      if (!largeurs.includes(n)) largeurs.push(n);
    } else {
      invalides.push(morceau);
    }
  }
  return { largeurs, invalides };
}

/**
 * Agrège les verdicts des familles mesurées en un verdict de page.
 *
 * « OK » seulement si TOUT est OK : un verdict global qui moyenne cache
 * précisément l'alerte qu'on cherchait.
 *
 * @param {string[]} verdicts - les verdicts des familles actives.
 * @returns {"OK"|"ALERTE"} l'état le plus défavorable rencontré.
 */
export function verdictGlobal(verdicts) {
  return verdicts.every((v) => v === "OK") ? "OK" : "ALERTE";
}

/**
 * Médiane d'une série de mesures — la statistique d'un RTT, jamais la moyenne.
 *
 * Une moyenne est déplacée par un seul aller-retour aberrant (GC, réveil de
 * connexion) ; la médiane dit ce qu'un appel TYPIQUE coûte.
 *
 * @param {number[]} valeurs - mesures en millisecondes.
 * @returns {number|null} la médiane, ou null si la série est vide.
 */
export function mediane(valeurs) {
  if (!Array.isArray(valeurs) || valeurs.length === 0) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(tri.length / 2);
  return tri.length % 2 === 1 ? tri[m] : (tri[m - 1] + tri[m]) / 2;
}
/**
 * Résume un rapport axe-core en un bloc lisible — le tri éditorial, pas la mesure.
 *
 * Rendue à part et PURE pour être éprouvée sans navigateur : c'est la seule
 * partie qu'on écrit soi-même, donc la seule qui puisse être fausse.
 *
 * @param {{violations: object[], passes?: object[], incomplete?: object[]}} rapport
 *   ce que rend `axe.run()`.
 * @returns {object} verdict, comptes par gravité, et les manquements les plus
 *   graves avec un exemple de cible chacun.
 */
export function resumeAxe(rapport) {
  const violations = rapport.violations ?? [];
  const parGravite = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations)
    if (Object.hasOwn(parGravite, v.impact ?? "")) parGravite[v.impact] += 1;
  const rang = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const graves = [...violations].sort(
    (a, b) => (rang[a.impact] ?? 9) - (rang[b.impact] ?? 9),
  );
  return {
    // Un manquement AVÉRÉ vaut alerte ; `incomplete` ne suffit pas — ce sont
    // les cas qu'axe refuse de trancher seul (fond en image, par exemple), pas
    // des défauts. Les compter comme tels ferait crier la sonde à tort.
    verdict: violations.length === 0 ? "OK" : "ALERTE",
    moteur: `axe-core ${rapport.testEngine?.version ?? "?"}`,
    reglesJouees:
      violations.length +
      (rapport.passes?.length ?? 0) +
      (rapport.incomplete?.length ?? 0),
    conformes: rapport.passes?.length ?? 0,
    manquements: { total: violations.length, parGravite },
    // À trancher à la main — axe dit qu'il ne peut pas conclure, il ne dit pas
    // que c'est bon.
    aVerifier: (rapport.incomplete ?? []).slice(0, 5).map((v) => ({
      regle: v.id,
      description: v.help,
      cibles: v.nodes.length,
    })),
    plusGraves: graves.slice(0, 8).map((v) => ({
      regle: v.id,
      gravite: v.impact,
      description: v.help,
      criteres: (v.tags ?? []).filter((t) => /^wcag\d|^best-practice$/.test(t)),
      cibles: v.nodes.length,
      // Jusqu'à CINQ cibles par règle, pas une seule : une même règle couvre
      // des défauts DISTINCTS à des endroits distincts — huit contrastes ratés
      // dans huit composants différents ne se corrigent pas d'un seul geste.
      // N'en montrer qu'un ferait croire le travail fini après le premier.
      exemples: v.nodes.slice(0, 5).map((n) => ({
        cible: n.target?.join(" ") ?? "",
        // Le « pourquoi » calculé par axe : contraste mesuré, rôle attendu…
        constat: (
          n.any?.[0]?.message ??
          n.all?.[0]?.message ??
          n.failureSummary ??
          ""
        )
          .replace(/\s+/g, " ")
          .slice(0, 200),
        extrait: (n.html ?? "").slice(0, 120),
      })),
      autresCibles: Math.max(0, v.nodes.length - 5),
      documentation: v.helpUrl,
    })),
  };
}

/**
 * Résume un rapport Lighthouse — le tri éditorial, pas la mesure.
 *
 * Un rapport brut pèse près d'un mégaoctet : le rendre tel quel, c'est garantir
 * que personne ne le lise. On en tire les scores par catégorie et les audits
 * RATÉS, du plus lourd au plus léger, avec ce qui les explique.
 *
 * Deux pièges de lecture, encodés ici :
 *  • un audit dont le score est `null` n'a PAS échoué — il ne s'applique pas
 *    (rien à mesurer) ou n'est qu'informatif. Le compter en échec ferait crier
 *    le rapport sur des pages saines ;
 *  • un score de catégorie est une moyenne pondérée : il peut rester flatteur
 *    alors qu'un audit important est au plus bas. On rend donc les DEUX.
 *
 * @param {object} lhr - le rapport (`runnerResult.lhr`).
 * @param {number} [seuil] - score en deçà duquel un audit est retenu (0–1).
 * @returns {object} scores par catégorie, audits ratés, et le décor de mesure.
 */
export function resumeLighthouse(lhr, seuil = 0.9) {
  const audits = lhr?.audits ?? {};
  const categories = Object.values(lhr?.categories ?? {});
  const scores = {};
  for (const c of categories) {
    // `null` se distingue de 0 : « pas de score » n'est pas « score nul ».
    scores[c.id] =
      c.score === null || c.score === undefined
        ? null
        : +(c.score * 100).toFixed(0);
  }
  const rates = [];
  for (const c of categories) {
    for (const ref of c.auditRefs ?? []) {
      const a = audits[ref.id];
      if (!a || a.score === null || a.score === undefined) continue;
      if (a.score >= seuil) continue;
      rates.push({
        categorie: c.id,
        audit: ref.id,
        titre: a.title,
        score: +(a.score * 100).toFixed(0),
        // Le poids dans la note : un audit à 0 qui pèse 0 ne coûte rien, et
        // c'est ce qui explique un score élevé malgré des rouges.
        poids: ref.weight ?? 0,
        valeur: a.displayValue ?? null,
        details: (a.description ?? "")
          .replace(/\s*\[.*?\]\(.*?\)/gu, "")
          .trim()
          .slice(0, 180),
      });
    }
  }
  // Trié par poids décroissant puis score croissant : ce qui coûte le plus, en
  // premier — un tri par score seul remonterait des broutilles sans influence.
  rates.sort((a, b) => b.poids - a.poids || a.score - b.score);
  return {
    verdict: rates.length === 0 ? "OK" : "ALERTE",
    moteur: `lighthouse ${lhr?.lighthouseVersion ?? "?"}`,
    url: lhr?.finalDisplayedUrl ?? lhr?.finalUrl ?? null,
    // Le DÉCOR fait partie de la mesure : un score de performance n'a aucun
    // sens sans savoir quel appareil et quel réseau ont été simulés.
    decor: {
      appareil: lhr?.configSettings?.formFactor ?? "?",
      bridage: lhr?.configSettings?.throttlingMethod ?? "?",
    },
    scores,
    // Les catégories SANS score sont dites : elles n'ont pas été évaluées, ce
    // qui n'est pas la même chose qu'un score parfait.
    nonNotees: Object.entries(scores)
      .filter(([, v]) => v === null)
      .map(([k]) => k),
    auditsRates: { total: rates.length, exemples: rates.slice(0, 12) },
  };
}

/**
 * L'ordre dans lequel essayer les navigateurs — et pourquoi celui-là.
 *
 * ⚠️ Ne pas confondre avec le CANAL d'un socket applicatif (`NF_BROWSER_CHANNEL`),
 * qui désigne tout autre chose : le mot « canal » est celui du pilote pour
 * nommer une variante de navigateur, et le réutiliser ici a déjà provoqué une
 * collision — un nom de canal temps réel interprété comme un navigateur.
 *
 * Le but est de **ne rien télécharger quand ce n'est pas nécessaire**. Un poste
 * de développement a presque toujours un navigateur ; sous Windows, Edge est
 * même préinstallé. Exiger cent mégaoctets avant de pouvoir regarder un écran
 * est une barrière que rien ne justifie.
 *
 * L'ordre place quand même `chromium` en tête : c'est celui que le pilote
 * installe et dont il connaît la version, donc le plus reproductible. Les
 * navigateurs du système sont un repli — parfaitement bon pour REGARDER, moins
 * pour COMPARER une mesure dans le temps, puisque leur version bouge sans
 * prévenir. C'est la même distinction que local / conteneur.
 *
 * Un navigateur demandé EXPLICITEMENT n'est jamais complété par un repli : se
 * rabattre en silence sur un autre navigateur que celui exigé rendrait une
 * mesure attribuée au mauvais moteur.
 *
 * @param {string|undefined} explicite - navigateur imposé (`NF_BROWSER_ENGINE`).
 * @returns {string[]} les navigateurs à essayer, dans l'ordre.
 */
export function ordreNavigateurs(explicite) {
  const v = String(explicite ?? "").trim();
  if (v) return [v];
  return ["chromium", "chrome", "msedge"];
}
