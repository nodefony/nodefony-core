/**
 * Les variables d'environnement que **Nodefony pose lui-même**, et qui ne
 * relèvent donc jamais de la configuration d'une application.
 *
 * ## Pourquoi cette liste existe
 *
 * `nodefony env` range en « inconnues » toutes les `NF_*` qu'aucune déclaration
 * n'explique, et il a raison de le faire : une faute de frappe sur une variable
 * d'environnement ne se voit JAMAIS autrement — la valeur est ignorée et le
 * défaut s'applique en silence.
 *
 * Mais le framework en pose lui-même, dans le dos de l'utilisateur : le lanceur
 * marque sa délégation, les commandes de démarrage inscrivent le mode, le
 * maître de grappe signale la grappe, la déclaration MCP porte le jeton. Elles
 * arrivent alors dans le rapport avec une suggestion de faute de frappe —
 * `NF_CLI_DELEGATED` « vouliez-vous dire NF_ADMIN_PASSWORD ? ». Le rapport
 * accuse l'utilisateur d'une variable qu'il n'a pas écrite.
 *
 * Elles ne sont pas TUES pour autant : le rapport les rend dans sa propre
 * section, avec leur rôle. Taire une variable présente, c'est refaire le défaut
 * dans l'autre sens.
 *
 * ## Une seule implémentation
 *
 * C'est la source unique de ces noms : `resolveLocalCli` importe les siens
 * d'ici plutôt que de les redéclarer. Deux listes divergent en silence, et
 * chacune passe ses propres tests.
 */

/** Une variable posée par le framework : son nom et ce qu'elle signale. */
export interface IReservedEnvVar {
  /** Nom de la variable, préfixe compris. */
  name: string;
  /** Qui la pose, et ce qu'elle veut dire — rendu tel quel dans le rapport. */
  role: string;
}

/**
 * Le catalogue des variables réservées, indexé par nom.
 *
 * Ajouter une entrée ici est OBLIGATOIRE dès qu'un code du framework écrit une
 * `NF_*` dans l'environnement d'un process : sans elle, la variable ressort en
 * « inconnue » chez tout utilisateur qui lance la commande au mauvais moment.
 */
export const RESERVED_ENV = Object.freeze({
  NF_CLI_DELEGATED: {
    name: "NF_CLI_DELEGATED",
    role: "posée par le lanceur du CLI quand il passe la main au `nodefony` du projet (garde anti-boucle)",
  },
  NF_CLI_DEBUG: {
    name: "NF_CLI_DEBUG",
    role: "trace la décision du lanceur du CLI sur la sortie d'erreur",
  },
  NF_MODE_START: {
    name: "NF_MODE_START",
    role: "posée par la commande de démarrage — le mode par lequel l'application a été lancée",
  },
  NF_CLUSTER: {
    name: "NF_CLUSTER",
    role: "posée par le maître de grappe dans chaque worker",
  },
  NF_MCP_TOKEN: {
    name: "NF_MCP_TOKEN",
    role: "jeton d'accès au serveur MCP de l'application, lu par le client de l'agent (`nodefony ai:mcp --auth`)",
  },
  NF_ENV: {
    name: "NF_ENV",
    role: "environnement de déploiement quand il diffère du mode runtime (`APP_ENV` gagne)",
  },
  NF_START: {
    name: "NF_START",
    role: "point d'entrée que le Kernel démarre, quand il ne doit pas être celui du projet",
  },
  NF_WORKERS: {
    name: "NF_WORKERS",
    role: "nombre de workers de la grappe (`nodefony cluster -w N`, en variable)",
  },
  NF_CLUSTER_PROBE: {
    name: "NF_CLUSTER_PROBE",
    role: "coupe la sonde du maître de grappe quand elle vaut `0`",
  },
  NF_POD_NAME: {
    name: "NF_POD_NAME",
    role: "nom du pod, dont se dérive l'identité d'origine du backplane temps réel",
  },
  NF_INSTANCE_ID: {
    name: "NF_INSTANCE_ID",
    role: "identifiant d'instance rendu par le plan d'administration (défaut : le pid)",
  },
  NF_DEV_CHILD: {
    name: "NF_DEV_CHILD",
    role: "posée par le superviseur de développement dans l'application qu'il relance",
  },
  NF_DEV_PORTS: {
    name: "NF_DEV_PORTS",
    role: "ports que le superviseur de développement doit libérer, imposés par l'opérateur",
  },
  NF_BOOT_TIMEOUT_MS: {
    name: "NF_BOOT_TIMEOUT_MS",
    role: "délai au-delà duquel un démarrage est déclaré perdu",
  },
  NF_BOOT_WARN_MS: {
    name: "NF_BOOT_WARN_MS",
    role: "délai au-delà duquel un démarrage lent est signalé",
  },
  NF_KERNEL_TRACE_FILE: {
    name: "NF_KERNEL_TRACE_FILE",
    role: "fichier où le Kernel écrit sa trace de démarrage (diagnostic)",
  },
  NF_NO_TTY: {
    name: "NF_NO_TTY",
    role: "force le rendu non interactif, quel que soit le terminal",
  },
  NF_PERF_PROBE: {
    name: "NF_PERF_PROBE",
    role: "arme la sonde de performance du pipeline HTTP",
  },
  NF_ORM_FLOW: {
    name: "NF_ORM_FLOW",
    role: "arme la sonde de flux de l'ORM",
  },
  NF_ORM_HEARTBEAT_MS: {
    name: "NF_ORM_HEARTBEAT_MS",
    role: "période du battement de cœur qui surveille les connecteurs de l'ORM",
  },
  NF_REALTIME_DRIVER: {
    name: "NF_REALTIME_DRIVER",
    role: "pilote du backplane temps réel (mémoire, Redis…)",
  },
  NF_REALTIME_BACKPLANE_SECRET: {
    name: "NF_REALTIME_BACKPLANE_SECRET",
    role: "secret qui scelle les enveloppes du backplane temps réel",
  },
  NF_REALTIME_BACKPLANE_NAMESPACE: {
    name: "NF_REALTIME_BACKPLANE_NAMESPACE",
    role: "espace de noms du backplane — ce qui cloisonne deux applications sur un même bus",
  },
}) satisfies Readonly<Record<string, IReservedEnvVar>>;

/** Cette variable est-elle posée par le framework lui-même ? */
export function isReservedEnv(name: string): boolean {
  return Object.hasOwn(RESERVED_ENV, name);
}

/**
 * Le rôle d'une variable réservée, ou `null` si elle ne l'est pas.
 *
 * @param name - le nom lu dans l'environnement.
 * @returns la phrase à rendre à l'utilisateur, ou `null`.
 */
export function reservedEnvRole(name: string): string | null {
  const entry = (RESERVED_ENV as Record<string, IReservedEnvVar | undefined>)[
    name
  ];
  return entry ? entry.role : null;
}
