/**
 * Le socle de la TÂCHE 0 — l'agent crée lui-même l'application, dans le vide.
 *
 * Toutes les autres tâches démarrent dans une application que le décor a
 * fabriquée, toujours en contenu « Vitrine complète ». L'étage du dessous n'est
 * jamais joué : l'agent ne choisit pas le contenu, ne répond pas au
 * questionnaire, n'installe rien. Or c'est là que l'essai réel du 2026-09-10 a
 * cassé, et c'est le premier contact d'un découvreur.
 *
 * Ce module ne contient QUE des fonctions pures : les accès au disque sont
 * injectés. Le motif n'est pas l'élégance — c'est qu'une fonction qui lit
 * `process.platform` ou le disque ne s'éprouve que là où elle tourne,
 * c'est-à-dire jamais dans un banc qu'on veut vérifier sans monter un décor de
 * 300 Mo.
 *
 * @module
 */

/**
 * Le canal et la source vivent dans `decor-source.mjs` — ils valent pour TOUTES
 * les tâches, pas seulement pour celle-ci. Les réexporter ici plutôt que de les
 * recopier : deux copies d'une règle divergent en silence, chacune passant ses
 * propres tests.
 */
export {
  ETIQUETTES,
  canalDe,
  registreLocalRequis,
  specifieur,
} from "./decor-source.mjs";
import { specifieur as specifieurInterne } from "./decor-source.mjs";

/**
 * La commande que l'ÉNONCÉ de la tâche 0 donne à l'agent.
 *
 * Elle fait partie de l'énoncé parce qu'un agent dans un dossier vide ne peut
 * pas la deviner : aucun fichier ne porte le canal, et `npm create nodefony` nu
 * sert la **version 7**. Ce qu'on mesure n'est pas sa capacité à deviner un
 * canal npm, c'est ce qu'il fait ENSUITE.
 *
 * @param {string} canal - le canal (voir `canalDe`).
 * @returns {string} la commande, telle qu'elle apparaît dans l'énoncé.
 */
export function commandeCreation(canal) {
  return `npm create ${specifieurInterne("nodefony", canal)}`;
}

/**
 * Résout le dossier que l'agent a créé — il ne se SUPPOSE jamais.
 *
 * `--dir` existe et le défaut est `./<nom>` : l'agent peut générer dans le
 * dossier courant comme dans un sous-dossier de son choix, sous un nom qu'il
 * a inventé. Un juge qui attendrait `<vide>/<nom-attendu>/` rendrait « n'a pas
 * abouti » sur un travail réussi — le faux rouge le plus cher du lot, puisqu'il
 * accuse l'agent d'un échec qui est le nôtre.
 *
 * Le critère est ce qui définit une application Nodefony, pas son nom : un
 * `package.json` qui dépend de `nodefony`. Plusieurs candidats ⇒ on ne tranche
 * PAS : la prémisse est ambiguë et la tâche n'est pas jugée. Mieux vaut une
 * tâche non jouée qu'un verdict rendu sur le mauvais dossier.
 *
 * @param {string} racine - le répertoire confié à l'agent.
 * @param {{listerDossiers: (d: string) => string[], lirePackage: (d: string) => object|null}} io
 *   - les accès disque, injectés pour que la règle s'éprouve sans décor.
 * @returns {{ok: true, dir: string} | {ok: false, cause: string, detail: string}}
 */
export function resoudreAppGeneree(racine, io) {
  const estApp = (dir) => {
    const pkg = io.lirePackage(dir);
    if (!pkg) return false;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.prototype.hasOwnProperty.call(deps, "nodefony");
  };

  const candidats = [];
  if (estApp(racine)) candidats.push(racine);
  for (const sous of io.listerDossiers(racine)) {
    // `node_modules` contient des centaines de `package.json` dépendant de
    // `nodefony` : sans cette exclusion, le premier paquet venu passerait pour
    // l'application de l'agent.
    if (sous === "node_modules" || sous.startsWith(".")) continue;
    const dir = `${racine}/${sous}`;
    if (estApp(dir)) candidats.push(dir);
  }

  if (candidats.length === 0) {
    return {
      ok: false,
      cause: "aucune-application",
      detail:
        "aucun dossier ne porte un package.json dépendant de « nodefony » — " +
        "l'agent n'a pas créé d'application",
    };
  }
  if (candidats.length > 1) {
    return {
      ok: false,
      cause: "application-ambigue",
      detail:
        `${candidats.length} dossiers candidats (${candidats.join(", ")}) : ` +
        "on ne devine pas lequel juger — tâche non jugée",
    };
  }
  return { ok: true, dir: candidats[0] };
}

/**
 * La version de `nodefony` RÉELLEMENT installée — pas celle qu'on a demandée.
 *
 * 🔴 Elle entre dans l'empreinte du décor, au même titre que le modèle et
 * l'agent. Sans elle, deux runs séparés par une publication seraient comparés
 * comme s'ils avaient joué le même décor : c'est l'erreur exacte que la règle 3
 * du dépistage existe pour refuser, et elle serait invisible puisque le dépôt,
 * lui, n'aurait pas bougé d'une ligne.
 *
 * On lit la version RÉSOLUE (`node_modules/nodefony/package.json`), jamais la
 * plage déclarée par le manifeste : `^10.0.0-alpha.5` désigne des versions
 * différentes selon le jour.
 *
 * @param {string} appDir - le dossier de l'application.
 * @param {{lirePackage: (d: string) => object|null}} io - accès disque injecté.
 * @returns {string|null} la version, ou null si elle n'est pas lisible.
 */
export function versionInstallee(appDir, io) {
  const pkg = io.lirePackage(`${appDir}/node_modules/nodefony`);
  return typeof pkg?.version === "string" ? pkg.version : null;
}

/**
 * La RÉFÉRENCE CONCURRENTE — un agent tiers, sur le même travail.
 *
 * Relevée dans `copilot-chat-app-2026-09-12.jsonl` (mémoire IA), le seul essai
 * réel dont on possède le transcript complet. Elle ne sert pas à décerner un
 * vainqueur : elle donne une ÉCHELLE. Un banc qui ne rend qu'un nombre de tours
 * ne dit pas si 40 est bon ou mauvais.
 *
 * 🔴 **C'est une borne BASSE, et assistée.** Quatre messages humains sont venus
 * s'ajouter à l'énoncé, dont une correction de trajectoire à 2 min 30 — « non
 * il faut travailler dans le repertoire de app » : l'agent s'était trompé de
 * répertoire, ce qui est précisément ce que la tâche 0 met en jeu. Un agent
 * autonome n'a pas ce filet. Comparer sans le dire surestimerait le concurrent.
 */
export const REFERENCE_CONCURRENTE = Object.freeze({
  agent: "copilot",
  hote: "vscode-agent-host",
  modele: "gpt-5.6-luna",
  tours: 86,
  outils: 143,
  dureeMs: 2_068_178,
  relancesHumaines: 4,
  skillsCharges: [
    "nodefony-add-crud",
    "nodefony-add-realtime-channel",
    "nodefony-protect-route",
  ],
  transcript: "core-dev/transcripts/copilot-chat-app-2026-09-12.jsonl",
  reserve:
    "borne basse ASSISTÉE — 4 relances humaines, dont une correction de " +
    "trajectoire à 2 min 30 (mauvais répertoire de travail)",
});

/**
 * Situe un nombre de tours face à la référence concurrente.
 *
 * Le nombre de TOURS est la mesure qui compte : un devkit qui obtient la bonne
 * réponse au bout de trente allers-retours a échoué autrement — plus lentement,
 * plus cher, et sur un fil. Ce que l'agent ne trouve pas du premier coup, il le
 * cherche ou il l'invente.
 *
 * Le verdict n'est jamais binaire : on rend l'écart et sa réserve, à charge du
 * lecteur d'en juger. Un seuil chiffré ici vieillirait en silence.
 *
 * @param {number|null} tours - la médiane des tours mesurée (jamais le dernier run).
 * @returns {{tours: number|null, reference: number, ecart: number|null, lecture: string}}
 */
export function situerTours(tours) {
  const reference = REFERENCE_CONCURRENTE.tours;
  if (typeof tours !== "number" || !Number.isFinite(tours)) {
    return {
      tours: null,
      reference,
      ecart: null,
      lecture: "tours non mesurés — rien à situer",
    };
  }
  const ecart = tours - reference;
  const pct = Math.round((Math.abs(ecart) / reference) * 100);
  const lecture =
    ecart < 0
      ? `${tours} tours contre ${reference} pour ${REFERENCE_CONCURRENTE.agent} — ${pct} % de MOINS`
      : ecart > 0
        ? `${tours} tours contre ${reference} pour ${REFERENCE_CONCURRENTE.agent} — ${pct} % de PLUS`
        : `${tours} tours — à égalité avec ${REFERENCE_CONCURRENTE.agent}`;
  return {
    tours,
    reference,
    ecart,
    lecture: `${lecture} (${REFERENCE_CONCURRENTE.reserve})`,
  };
}

/**
 * Les portes CLIENTES du framework, par moteur front — `marker` → `subpath`.
 *
 * 🔴 **Cette table est une COPIE**, et elle est assumée comme telle. Sa source
 * unique vit dans le produit (`FRONTEND_PARAMS[<moteur>].client`,
 * `src/nodefony/src/cli/scaffold/engine.ts`), en TypeScript, derrière une
 * frontière de paquets qu'un banc en JavaScript pur ne franchit pas : le
 * décor isolé n'a ni le checkout ni un `dist` à importer.
 *
 * Deux copies d'une règle divergent en silence — chacune passant ses propres
 * tests. C'est pourquoi l'auto-contrôle CONFRONTE celle-ci au source du
 * produit plutôt que de la relire : ajouter un moteur côté produit sans
 * l'ajouter ici fait TOMBER le contrôle, au lieu de laisser le banc juger une
 * application Vue avec un critère qu'il ne connaît pas.
 *
 * `marker` est le paquet qui SIGNE le moteur dans le manifeste — le moteur se
 * CONSTATE dans les dépendances, il ne se déduit pas d'un choix que personne
 * n'a rejoué. C'est le mot du produit, et le motif est le même que pour le
 * dossier de l'application : on ne suppose pas, on lit.
 */
export const PORTES_CLIENT = Object.freeze([
  Object.freeze({
    moteur: "react",
    marker: "react",
    subpath: "nodefony/react",
  }),
  Object.freeze({ moteur: "vue", marker: "vue", subpath: "nodefony/vue" }),
  Object.freeze({
    moteur: "angular",
    marker: "@angular/core",
    subpath: "nodefony/angular",
  }),
  Object.freeze({
    moteur: "svelte",
    marker: "svelte",
    subpath: "nodefony/svelte",
  }),
]);

/**
 * La porte cliente d'une application — celle de son moteur RÉELLEMENT choisi.
 *
 * 🔴 Le critère client ne peut pas être écrit pour un seul moteur. Le banc
 * était React-centré exactement comme le gabarit qu'il éprouve : sa sonde
 * cherchait `RealtimeClient|nodefony/react`, si bien qu'une application Svelte
 * — moteur que le premier essai réel a effectivement choisi — aurait rendu un
 * FAUX ROUGE sur un travail juste, et un FAUX VERT sur le trou que #347 a
 * fermé. Ce qui se mesure est « l'agent a-t-il employé LA façade de SON
 * moteur », jamais « a-t-il employé celle de React ».
 *
 * Sans moteur front (`--frontend none`), la porte est la façade isomorphe de
 * base, `nodefony/client` : c'est elle que le framework offre alors de plus
 * haut niveau, et ne rien exiger laisserait passer un `new WebSocket`.
 *
 * Plusieurs moteurs signés ⇒ on ne tranche PAS. Même règle que pour le dossier
 * de l'application : mieux vaut une sonde non opposable qu'un verdict rendu
 * sur le mauvais critère.
 *
 * @param {object|null} pkg - le `package.json` de l'application générée.
 * @returns {{ok: true, moteur: string, subpath: string}
 *   | {ok: false, cause: string, detail: string}}
 */
export function porteClientDe(pkg) {
  if (!pkg || typeof pkg !== "object") {
    return {
      ok: false,
      cause: "manifeste-illisible",
      detail:
        "pas de package.json lisible — le moteur front se CONSTATE dans les " +
        "dépendances, il ne se suppose pas",
    };
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const signes = PORTES_CLIENT.filter((p) =>
    Object.prototype.hasOwnProperty.call(deps, p.marker),
  );
  if (signes.length > 1) {
    return {
      ok: false,
      cause: "moteur-front-ambigu",
      detail:
        `${signes.length} moteurs signés dans le manifeste ` +
        `(${signes.map((s) => s.moteur).join(", ")}) : on ne devine pas ` +
        "lequel juger — sonde non opposable",
    };
  }
  if (signes.length === 0) {
    // `--frontend none` : pas un échec, un choix. La façade isomorphe de base
    // reste ce que le framework offre de plus haut niveau côté client.
    return { ok: true, moteur: "none", subpath: "nodefony/client" };
  }
  return { ok: true, moteur: signes[0].moteur, subpath: signes[0].subpath };
}

/**
 * Le motif qui constate l'emploi d'une porte cliente donnée.
 *
 * `RealtimeClient` est accepté partout : c'est la façade isomorphe elle-même,
 * exportée par `nodefony/client`, et l'employer directement est légitime quel
 * que soit le moteur. Ce qu'on refuse est le WebSocket recomposé à la main —
 * et cela se mesure par la sonde négative jumelle, pas par celle-ci.
 *
 * Le subpath est échappé : `nodefony/react` porte une barre oblique, et un
 * point mal placé ferait mordre le motif sur autre chose.
 *
 * @param {string} subpath - la porte attendue (`nodefony/svelte`…).
 * @returns {RegExp} le motif, prêt pour une sonde `code`.
 */
export function motifPorteClient(subpath) {
  const echappe = subpath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`RealtimeClient|${echappe}`, "u");
}

/**
 * Les entrées de PATH qui fournissent DÉJÀ un `nodefony` sur le poste.
 *
 * 🔴 **Le trou que ceci ferme a produit une mesure entièrement fausse.** Lors du
 * premier run réel de la tâche 0, l'agent a tapé la commande de l'énoncé, ses
 * drapeaux inventés ont échoué, et il s'est rabattu sur `npm install -g
 * nodefony@<version>` puis `nodefony create app`. Le PATH du poste résolvait
 * alors un lien vers le CHECKOUT du dépôt : l'application a été générée par le
 * code en cours de développement, sur une tâche dont la raison d'être est
 * d'éprouver la chaîne PUBLIÉE. Le décor enregistré annonçait une version, le
 * manifeste en portait une autre, et seule la version RÉSOLUE l'a dit.
 *
 * Ce n'est pas un accident d'agent : c'est la définition même du décor. « Un
 * dossier vide » veut dire qu'aucun outil du framework n'est déjà là — sinon on
 * ne mesure pas un premier contact, on mesure le poste de celui qui lance le
 * banc, et deux machines rendent deux verdicts.
 *
 * ⚠️ **Cette fonction NOMME, elle ne retire pas.** Retirer l'entrée du PATH a
 * été essayé et c'est une faute : ces dossiers sont ceux d'un gestionnaire de
 * versions (`~/.nvm/versions/node/<v>/bin`) et d'un `~/.local/bin` — ils
 * fournissent aussi `node`, `npm`, `git`, et l'agent lui-même. Les amputer rend
 * le décor inutilisable, pas vierge. C'est le binaire qu'on MASQUE, par un
 * leurre placé en tête (voir `leurreNodefony`), jamais le dossier.
 *
 * Fonction PURE, grammaire de chemins injectée : une règle qui lit
 * `process.platform` ne s'éprouve que là où elle tourne.
 *
 * @param {string} chemin - la valeur de `PATH`.
 * @param {{existe: (f: string) => boolean}} io - test d'existence, injecté.
 * @param {{delimiter: string, join: (a: string, b: string) => string}} [grammaire]
 *   - la grammaire de chemins (défaut : POSIX ; `path.win32` pour Windows).
 * @returns {string[]} les entrées qui fournissent un `nodefony`, sans doublon.
 */
export function entreesQuiFournissentNodefony(chemin, io, grammaire) {
  const g = grammaire ?? { delimiter: ":", join: (a, b) => `${a}/${b}` };
  const trouvees = [];
  for (const dir of String(chemin ?? "")
    .split(g.delimiter)
    .filter((e) => e.length > 0)) {
    // Les deux noms qu'npm pose pour un binaire : l'un sous Unix, l'autre le
    // lanceur de Windows. Chercher le seul `nodefony` laisserait passer un
    // poste Windows entier.
    const fournit =
      io.existe(g.join(dir, "nodefony")) ||
      io.existe(g.join(dir, "nodefony.cmd"));
    if (fournit && !trouvees.includes(dir)) trouvees.push(dir);
  }
  return trouvees;
}

/**
 * Le corps du LEURRE qui masque un `nodefony` déjà installé sur le poste.
 *
 * Il imite ce qu'un découvreur obtient vraiment — une commande introuvable —
 * mais en le DISANT, parce qu'un agent qui lit « command not found » cherchera
 * à installer le framework globalement, et c'est précisément le contournement
 * qui fausse la version mesurée. Le message le renvoie à la commande de
 * l'énoncé.
 *
 * Le code `127` est celui d'un shell pour une commande absente : le choisir
 * plutôt qu'un `1` fait que tout outil qui interprète les codes de sortie lit
 * la même chose qu'en l'absence réelle du binaire.
 *
 * @returns {string} le script du leurre (shell POSIX).
 */
export function leurreNodefony() {
  return [
    "#!/bin/sh",
    // Aucun accent grave, commentaires compris : le contrôle porte sur le
    // fichier ENTIER, et un shell qui interpréterait un commentaire autrement
    // n'aurait pas à être découvert ici.
    "# Leurre du banc devkit — la tache 0 mesure un PREMIER CONTACT : aucun",
    "# framework n'est installe sur le poste. Ce fichier masque un nodefony",
    "# qui trainait dans le PATH et qui aurait scaffolde a la place de la",
    "# version demandee.",
    // 🔴 Guillemets SIMPLES, et aucun accent grave. En double, le shell
    // substituerait une commande entre accents graves — donc `nodefony`
    // lui-même, c'est-à-dire ce leurre : une récursion, dans le fichier écrit
    // pour empêcher exactement cet appel.
    "echo 'nodefony : aucun framework installe sur ce poste.' >&2",
    "echo \"Cree l'application avec la commande de l'enonce ; nodefony sera\" >&2",
    'echo "ensuite disponible DANS l\'application, via npx." >&2',
    "exit 127",
    "",
  ].join("\n");
}
