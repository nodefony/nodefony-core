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
  const herite = Object.fromEntries(
    Object.entries(process.env).filter(([cle]) => raisonDEcart(cle) === null),
  );
  return Object.assign(herite, ...couches);
}

/**
 * Un nom de variable qui porte un SECRET — clé d'API, jeton, mot de passe.
 *
 * Le second défaut de l'héritage, découvert après le premier : le filtre `NF_`
 * laissait passer TOUT le reste du poste, dont la clé d'API d'un fournisseur
 * d'IA. L'agent mesuré la recevait (et pouvait l'écrire dans un transcript
 * conservé), l'application témoin aussi, et chaque juge à sa suite.
 *
 * Pourquoi un motif sur le NOM plutôt qu'une liste blanche : une liste blanche
 * devrait énumérer tout ce dont la chaîne a besoin — gestionnaire de versions,
 * configuration npm, proxy, sockets — et chaque oubli rend le décor inutilisable
 * sans dire pourquoi. Un secret, lui, s'annonce par son nom : c'est ce qui le
 * rend reconnaissable sans connaître le poste. `TOKENS` (un réglage de taille)
 * ne mord pas, `TOKEN` si — le segment est borné.
 */
export const NOM_DE_SECRET =
  /(?:^|_)(?:API_?KEY|(?:AUTH_?)?TOKEN|ACCESS_KEY|PRIVATE_KEY)(?:_|$)|SECRET|PASSWORD|PASSWD|CREDENTIAL/iu;

/**
 * Les marqueurs que l'agent QUI LANCE le banc pose pour ses enfants.
 *
 * Lancé depuis une session d'agent, le banc héritait de son identité : l'agent
 * mesuré démarrait en « session enfant », avec l'effort du lanceur, et
 * l'application témoin se croyait pilotée par lui (`AI_AGENT`, `CLAUDECODE`
 * changent l'écran de démarrage). Le même run rendait autre chose depuis un
 * terminal nu — la faute du filtre `NF_`, sous un autre nom. L'agent mesuré pose
 * les SIENS : ceux du lanceur n'ont rien à faire dans le décor.
 */
export const MARQUEURS_DE_SESSION = new Set([
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "GEMINI_CLI",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
]);

/**
 * Pourquoi une variable du poste n'entre pas dans le décor — `null` si elle entre.
 *
 * @param {string} cle - le nom de la variable.
 * @returns {"nodefony"|"secret"|"session"|null} la raison de l'écart.
 */
export function raisonDEcart(cle) {
  if (cle.startsWith("NF_")) return "nodefony";
  if (MARQUEURS_DE_SESSION.has(cle)) return "session";
  if (NOM_DE_SECRET.test(cle)) return "secret";
  return null;
}

/**
 * Les identifiants que chaque agent connu lit dans son environnement.
 *
 * Écarter les secrets du décor coupe aussi la clé dont l'agent MESURÉ a besoin
 * pour répondre — et un agent muet se lit « authentification ou quota », un
 * diagnostic faux. On lui rend donc SA clé, et seulement la sienne : un run
 * `gemini` n'a aucune raison de voir la clé d'un autre fournisseur. Un agent
 * hors table, ou une clé de plus, se déclare par `NF_DEVKIT_BENCH_AGENT_ENV`.
 */
export const IDENTIFIANTS_D_AGENT = Object.freeze({
  claude: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  vibe: ["MISTRAL_API_KEY"],
  copilot: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
});

/**
 * L'environnement de l'AGENT mesuré : celui du décor, plus ses identifiants.
 *
 * @param {Record<string, string|undefined>} decor - l'environnement du décor.
 * @param {string} agent - le binaire lancé (nom ou chemin).
 * @param {string} [declarees] - noms en plus, séparés par des virgules
 *   (`NF_DEVKIT_BENCH_AGENT_ENV`).
 * @returns {{env: Record<string, string|undefined>, transmises: string[]}}
 *   l'environnement, et les NOMS transmis (jamais les valeurs).
 */
export function envAgent(decor, agent, declarees = "") {
  const nom =
    agent
      .split(/[\\/]/u)
      .pop()
      ?.replace(/\.(?:cmd|exe)$/iu, "") ?? agent;
  const voulues = [
    ...(Object.hasOwn(IDENTIFIANTS_D_AGENT, nom)
      ? IDENTIFIANTS_D_AGENT[nom]
      : []),
    ...declarees
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  ];
  const transmises = [...new Set(voulues)]
    .filter((c) => typeof process.env[c] === "string")
    .sort();
  const env = { ...decor };
  for (const cle of transmises) env[cle] = process.env[cle];
  return { env, transmises };
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
    .filter((cle) => raisonDEcart(cle) === "nodefony")
    .sort();
}

/**
 * Les autres variables du poste écartées — secrets et marqueurs de session.
 *
 * Les NOMS seulement : la valeur d'un secret n'a rien à faire dans une sortie
 * de banc, qui se colle dans un ticket.
 *
 * @returns {{secret: string[], session: string[]}} les noms écartés, triés.
 */
export function autresEcartees() {
  const cles = Object.keys(process.env).sort();
  return {
    secret: cles.filter((c) => raisonDEcart(c) === "secret"),
    session: cles.filter((c) => raisonDEcart(c) === "session"),
  };
}
