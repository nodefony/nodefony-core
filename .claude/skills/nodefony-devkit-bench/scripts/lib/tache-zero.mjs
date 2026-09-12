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
