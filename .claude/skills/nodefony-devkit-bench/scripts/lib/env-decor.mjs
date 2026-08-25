/**
 * L'environnement d'une application témoin — celui d'un utilisateur qui vient
 * d'installer, pas celui de l'atelier qui lance le banc.
 *
 * ## Pourquoi ce fichier existe
 *
 * Les trois bancs composaient `{ ...process.env, ...PORTS }`. L'application
 * témoin héritait donc de TOUTES les variables du shell de lancement — dont les
 * `NF_*`, qui sont par convention réservées à Nodefony. Chacune arrive dans
 * l'app comme une variable **qu'elle ne déclare pas**, et `nodefony env --json`
 * les rend en `unknown`.
 *
 * Deux dégâts constatés, l'un mesurable, l'autre invisible :
 *
 * 1. **Un juge condamnait l'agent pour la saleté du décor.** La tâche 6 du banc
 *    de découvrabilité exige « 0 variable inconnue » : elle rougissait sur
 *    `NF_DEVKIT_BENCH_AGENT`, `NF_DEVKIT_BENCH_AGENT_ARGS`,
 *    `NF_DEVKIT_BENCH_MODEL` et `NF_MCP_TOKEN` — les variables du HARNAIS.
 *    Quoi que l'agent écrive, le verdict était FAIL. Constaté identique sur
 *    quatre agents.
 * 2. **Le banc n'était pas reproductible d'un poste à l'autre.** La session qui
 *    le lançait portait un `NF_MCP_TOKEN` émis pour le serveur MCP du DÉPÔT
 *    (audience `localhost:5151`) : le même run rendait PASS sur un shell propre
 *    et FAIL sur un shell outillé. Une mesure qui dépend de qui la lance ne
 *    mesure rien. La référence donne d'ailleurs cette tâche à PASS 3/3, figée
 *    avant que ces variables existent dans l'environnement de lancement.
 *
 * C'est la règle de l'isolation du décor, appliquée à l'environnement plutôt
 * qu'au disque : le banc mesure ce qu'un utilisateur reçoit, et **cet
 * utilisateur n'a aucune `NF_*` dans son shell**. Ce que le banc veut poser, il
 * le pose ENSUITE et explicitement — ports, jeton, URL de base.
 *
 * ## Une seule implémentation
 *
 * Trois bancs partagent la règle ; la recopier trois fois la ferait diverger en
 * silence — chacun passerait ses propres tests. Le helper est donc ici, à côté
 * de `isolation.mjs` et `http-probe.mjs`, avec le reste du socle partagé.
 */

/**
 * Compose l'environnement d'une application témoin.
 *
 * @param {...Record<string, string|undefined>} couches - ce que le banc pose
 *   délibérément (ports, jeton, URL de base), appliqué APRÈS le filtrage.
 * @returns {Record<string, string|undefined>} l'environnement à passer aux
 *   process lancés dans l'app témoin.
 */
export function envDecor(...couches) {
  const heriteSansNf = Object.fromEntries(
    Object.entries(process.env).filter(([cle]) => !cle.startsWith("NF_")),
  );
  return Object.assign(heriteSansNf, ...couches);
}

/**
 * Les `NF_*` du poste que le filtrage vient d'écarter.
 *
 * Sert à le DIRE plutôt qu'à le taire : un opérateur dont le shell porte des
 * variables Nodefony doit savoir que le décor ne les voit pas — sinon il
 * cherchera longtemps pourquoi son `NF_DATABASE_URL` reste sans effet.
 *
 * @returns {string[]} les noms écartés, triés.
 */
export function nfEcartees() {
  return Object.keys(process.env)
    .filter((cle) => cle.startsWith("NF_"))
    .sort();
}
