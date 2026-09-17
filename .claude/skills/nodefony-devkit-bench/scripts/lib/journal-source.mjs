/**
 * D'OÙ vient le journal d'un agent — la sortie standard, ou un fichier à lui.
 *
 * Le banc écrivait `res.stdout` comme transcript, pour tout le monde. C'est juste
 * pour `claude`, `vibe`, `codex` et `gemini`, qui rendent tous un flux JSONL sur
 * cette sortie. C'est FAUX pour `copilot`, qui n'y écrit qu'un compte rendu
 * formaté pour un humain et range son journal réel chez l'utilisateur.
 *
 * Le coût n'était pas un transcript vide, c'était un DIAGNOSTIC INVERSÉ : le
 * garde-fou « l'agent a-t-il parlé ? » ne trouvait aucun tour d'assistant,
 * arrêtait la passe en `exit 2` et imputait à un défaut d'authentification ou de
 * quota un run qui s'était parfaitement déroulé. Mesuré le 2026-09-17 : le run le
 * plus démonstratif de la séance — `copilot` chargeant le skill en premier geste,
 * puis le script de documentation, puis le générateur, jusqu'à une route montée —
 * a été classé « aucun tour d'assistant ».
 *
 * ⚠️ **La provenance se DÉCLARE, elle ne se devine pas.** Ni depuis
 * `process.platform`, ni par un `existsSync` optimiste qui ramasserait le premier
 * journal venu : un dossier de session appartenant à un AUTRE travail de
 * l'utilisateur ferait juger le banc sur le transcript de quelqu'un d'autre, et
 * rien ne le dirait. Un agent absent de la table rend sa sortie standard — le
 * comportement historique, qui reste le bon pour quatre agents sur cinq.
 *
 * ⚠️ **Le choix se fait sur UNE horloge.** Le dossier retenu est celui dont le
 * journal a été touché APRÈS le début du run, mesuré par le même système de
 * fichiers que celui qui horodate. Comparer une date d'ici à une date de là-bas
 * est le défaut que ce dépôt a déjà payé sur un ordre d'événements.
 *
 * ⚠️ **`vibe` est un candidat NON TRANCHÉ, et c'est écrit plutôt que deviné.**
 * Son journal vit lui aussi chez l'utilisateur
 * (`~/.vibe/logs/session/<id>/messages.jsonl`), mais il est lancé avec
 * `--output streaming`, qui émet peut-être le même flux sur la sortie standard —
 * et le garde-fou du banc reconnaît bien du `"role": "assistant"` chez lui. Le
 * déclarer ici sans l'avoir CONSTATÉ casserait un agent qui marche, pour réparer
 * un défaut qu'il n'a peut-être pas. Ce qui trancherait, en un run : lancer
 * `vibe` sous le banc et comparer sa sortie standard au fichier de session. Une
 * capacité se constate ; elle ne se déduit pas d'une ressemblance.
 *
 * @module
 */
import path from "node:path";
import os from "node:os";

/**
 * Où chaque agent écrit son journal, quand ce n'est pas sa sortie standard.
 *
 * `dir` est relatif au dossier personnel — jamais absolu en dur, qui ne
 * traverserait ni les systèmes ni les comptes. `file` est le nom du journal DANS
 * chaque dossier de session.
 *
 * @type {Record<string, {dir: string[], file: string, note: string}>}
 */
export const JOURNAUX_HORS_STDOUT = {
  copilot: {
    dir: [".copilot", "session-state"],
    file: "events.jsonl",
    note: "un compte rendu formaté part sur la sortie standard ; le journal typé vit ici",
  },
};

/**
 * La provenance déclarée d'un agent, sous forme lisible — pour l'aide et les
 * messages, DÉRIVÉE de la table plutôt que recopiée en prose.
 *
 * @param {string} agent - le binaire lancé (`claude`, `copilot`…).
 * @param {string} [home] - le dossier personnel (injectable pour les tests).
 * @returns {string} une phrase qui situe le journal.
 */
export function provenanceLisible(agent, home = os.homedir()) {
  const spec = JOURNAUX_HORS_STDOUT[agent];
  if (!spec) return "sortie standard du processus";
  return path.join(home, ...spec.dir, "<id>", spec.file);
}

/**
 * Choisit le dossier de session qui appartient À CE RUN.
 *
 * Fonction PURE : elle ne touche pas au disque, on lui donne ce qu'on y a lu.
 * C'est ce qui la rend éprouvable sans agent installé, et sans attendre qu'un
 * run de vingt minutes se termine pour savoir si la règle tient.
 *
 * La règle, et ses deux refus :
 *
 * - on ne retient qu'un journal touché **après** le début du run — sinon on
 *   ramasse la session précédente de l'utilisateur, qui a l'air d'un résultat ;
 * - entre plusieurs candidats, le PLUS RÉCENT gagne : un agent peut ouvrir une
 *   session technique avant la vraie, mais c'est la dernière qu'il nourrit.
 *
 * @param {{path: string, mtimeMs: number}[]} candidats - les journaux trouvés.
 * @param {number} debutRunMs - l'instant où le banc a lancé l'agent.
 * @returns {{path: string}|{path: null, raison: string}} le journal, ou pourquoi
 *   aucun ne convient — jamais un silence.
 */
export function choisirJournal(candidats, debutRunMs) {
  if (!Array.isArray(candidats) || candidats.length === 0) {
    return {
      path: null,
      raison: "aucun dossier de session sous la racine déclarée",
    };
  }
  const pendantLeRun = candidats.filter((c) => c.mtimeMs >= debutRunMs);
  if (pendantLeRun.length === 0) {
    // Ce cas n'est PAS « introuvable » : les journaux existent, ils sont juste
    // tous antérieurs. Le dire sépare « l'agent n'a rien écrit » de « je ne
    // sais pas où regarder », qui appellent deux gestes différents.
    return {
      path: null,
      raison: `${candidats.length} journal/journaux trouvé(s), tous ANTÉRIEURS au début du run — l'agent n'a rien écrit`,
    };
  }
  const gagnant = pendantLeRun.reduce((a, b) =>
    b.mtimeMs > a.mtimeMs ? b : a,
  );
  return { path: gagnant.path };
}

/**
 * Le journal du run, LÀ OÙ CET AGENT l'écrit — capture complète.
 *
 * Les accès disque sont INJECTÉS, et ce n'est pas une coquetterie : c'est ce qui
 * rend éprouvable le cas qu'on ne sait pas fabriquer autrement — « la racine
 * déclarée n'existe pas », « des journaux existent mais tous antérieurs ». Ces
 * deux-là doivent produire un message, pas un silence, parce que le garde-fou
 * suivant du banc traduirait un transcript vide en « authentification ou quota ».
 *
 * @param {string} agent - le binaire lancé.
 * @param {string} stdout - ce que le processus a écrit sur sa sortie standard.
 * @param {number} debutRunMs - l'instant du lancement, même horloge que le disque.
 * @param {object} io - les accès disque.
 * @param {(p: string) => boolean} io.existe
 * @param {(p: string) => string[]} io.listeDossiers - les sous-dossiers d'une racine.
 * @param {(p: string) => number} io.mtimeMs
 * @param {(p: string) => string} io.lire
 * @param {string} io.home - le dossier personnel.
 * @param {typeof choisirJournal} [io.choisir] - la règle de choix. Injectable
 *   pour que l'auto-contrôle puisse l'AMPUTER ici aussi : sans ce point
 *   d'entrée, les cas qui passent par cette fonction restaient verts sous
 *   `--prove` et leur vert ne disait rien de la couverture.
 * @returns {{contenu: string, provenance: string, probleme?: string}} le journal,
 *   d'où il vient, et ce qui a manqué le cas échéant.
 */
export function capturerJournal(agent, stdout, debutRunMs, io) {
  const spec = JOURNAUX_HORS_STDOUT[agent];
  if (!spec) return { contenu: stdout, provenance: "stdout" };
  const racine = path.join(io.home, ...spec.dir);
  if (!io.existe(racine)) {
    return {
      contenu: stdout,
      provenance: "stdout",
      probleme: `la racine ${racine} n'existe pas`,
    };
  }
  /** @type {{path: string, mtimeMs: number}[]} */
  const candidats = [];
  for (const nom of io.listeDossiers(racine)) {
    const fichier = path.join(racine, nom, spec.file);
    // `existe` puis `mtimeMs` : une session en cours d'écriture peut apparaître
    // entre les deux, et un dossier sans journal n'est pas une erreur — c'est
    // une session que l'agent n'a pas nourrie.
    if (!io.existe(fichier)) continue;
    try {
      candidats.push({ path: fichier, mtimeMs: io.mtimeMs(fichier) });
    } catch {
      // Disparu entre les deux appels : il n'était pas le nôtre.
    }
  }
  const choix = (io.choisir ?? choisirJournal)(candidats, debutRunMs);
  if (choix.path === null) {
    return {
      contenu: stdout,
      provenance: "stdout",
      probleme: choix.raison ?? "aucun journal retenu",
    };
  }
  return { contenu: io.lire(choix.path), provenance: choix.path };
}
