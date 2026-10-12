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

import type { EnvVarPlacement, NamedEnvVarMeta } from "./defineEnv";

/** Une variable posée par le framework : son nom et ce qu'elle signale. */
export interface IReservedEnvVar {
  /** Nom de la variable, préfixe compris. */
  name: string;
  /** Qui la pose, et ce qu'elle veut dire — rendu tel quel dans le rapport. */
  role: string;
  /**
   * Présent : un RÉGLAGE que l'exploitant ou le développeur peut poser, rendu
   * dans la notice `.env.example` de toute application (cf
   * {@link frameworkEnvCatalog}). Absent : le framework la pose lui-même, et la
   * notice n'en dit rien — l'annoncer inviterait à l'écrire à la main.
   */
  tunable?: {
    /** Bandeau de la variable dans la notice. */
    title: string;
    /** Ce que le code applique quand elle est absente, tel que relu au site de lecture. */
    defaultNote: string;
    /** Où la poser en production. */
    placement: EnvVarPlacement;
    /**
     * La valeur est un secret : masquée par `nodefony env`, marquée
     * `@sensitive` dans la notice. Absent : déduit du NOM (`pathLooksSecret`) —
     * à poser quand le nom ne le dit pas (une URL qui porte un mot de passe).
     */
    sensitive?: boolean;
    /**
     * Les modules qui la LISENT — la notice ne la nomme que si l'application
     * en déclare un. Absent : lue par le cœur, toujours nommée.
     */
    modules?: readonly string[];
  };
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
    tunable: {
      title: "Trace du lanceur du CLI",
      defaultNote: "désactivée",
      placement: "workstation",
    },
  },
  NF_NO_UPDATE_CHECK: {
    name: "NF_NO_UPDATE_CHECK",
    role: "empêche `create app` de demander au registre npm si une version plus récente du CLI existe",
    tunable: {
      title: "Vérification de version du CLI",
      defaultNote: "active (désactivée d'office quand `CI` est posée)",
      placement: "workstation",
    },
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
    tunable: {
      title: "Environnement de déploiement",
      defaultNote: "le mode d'exécution (NODE_ENV)",
      placement: "platform",
    },
  },
  NF_START: {
    name: "NF_START",
    role: "point d'entrée que le Kernel démarre, quand il ne doit pas être celui du projet",
  },
  NF_WORKERS: {
    name: "NF_WORKERS",
    role: "nombre de workers de la grappe (`nodefony cluster -w N`, en variable)",
    tunable: {
      title: "Nombre de workers de la grappe",
      defaultNote:
        "cluster.workers de la configuration, sinon 1 (--workers l'emporte)",
      placement: "platform",
    },
  },
  NF_CLUSTER_PROBE: {
    name: "NF_CLUSTER_PROBE",
    role: "coupe la sonde du maître de grappe quand elle vaut `0`",
    tunable: {
      title: "Sonde du maître de grappe",
      defaultNote: "active (0 la coupe)",
      placement: "platform",
    },
  },
  NF_POD_NAME: {
    name: "NF_POD_NAME",
    role: "nom du pod, dont se dérive l'identité d'origine du backplane temps réel",
    tunable: {
      title: "Nom du pod",
      defaultNote: "le nom de la machine",
      placement: "platform",
      modules: ["@nodefony/realtime"],
    },
  },
  NF_INSTANCE_ID: {
    name: "NF_INSTANCE_ID",
    role: "identifiant d'instance rendu par le plan d'administration (défaut : le pid)",
    tunable: {
      title: "Identifiant d'instance",
      defaultNote: "le pid du process",
      placement: "platform",
    },
  },
  NF_DEV_CHILD: {
    name: "NF_DEV_CHILD",
    role: "posée par le superviseur de développement dans l'application qu'il relance",
  },
  NF_DEV_TERMINAL: {
    name: "NF_DEV_TERMINAL",
    role: "verdict du terminal que le superviseur de développement transmet au serveur dont il relaie la sortie",
  },
  NF_DEV_UI: {
    name: "NF_DEV_UI",
    role: "plein écran du terminal de développement : `1` le demande, `0` l'interdit — défaut : oui hors Windows (`--ui` / `--no-ui` l'emportent)",
    tunable: {
      title: "Plein écran du terminal de développement",
      defaultNote: "oui, sauf sous Windows",
      placement: "workstation",
    },
  },
  NF_DEV_MOUSE: {
    name: "NF_DEV_MOUSE",
    role: "capture de la souris en plein écran de développement : `1` la demande, `0` l'interdit — défaut : oui hors Windows (`--mouse` / `--no-mouse` l'emportent)",
    tunable: {
      title: "Souris en plein écran de développement",
      defaultNote: "oui, sauf sous Windows",
      placement: "workstation",
    },
  },
  NF_DEV_PORTS: {
    name: "NF_DEV_PORTS",
    role: "ports que le superviseur de développement doit libérer, imposés par l'opérateur",
    tunable: {
      title: "Ports libérés par le superviseur de développement",
      defaultNote: "les ports déclarés par l'application, sinon 5151,5152",
      placement: "workstation",
    },
  },
  NF_BOOT_TIMEOUT_MS: {
    name: "NF_BOOT_TIMEOUT_MS",
    role: "délai au-delà duquel un démarrage est déclaré perdu",
    tunable: {
      title: "Délai maximal de démarrage (ms)",
      defaultNote: "20000 en développement, 60000 en production",
      placement: "platform",
    },
  },
  NF_BOOT_WARN_MS: {
    name: "NF_BOOT_WARN_MS",
    role: "délai au-delà duquel un démarrage lent est signalé",
    tunable: {
      title: "Seuil de démarrage lent (ms)",
      defaultNote: "5000 (0 désactive la mesure)",
      placement: "platform",
    },
  },
  NF_KERNEL_TRACE_FILE: {
    name: "NF_KERNEL_TRACE_FILE",
    role: "fichier où le Kernel écrit sa trace de démarrage (diagnostic)",
    tunable: {
      title: "Trace de démarrage du Kernel",
      defaultNote: "aucune trace",
      placement: "workstation",
    },
  },
  NF_NO_TTY: {
    name: "NF_NO_TTY",
    role: "force le rendu non interactif, quel que soit le terminal",
    tunable: {
      title: "Rendu non interactif forcé",
      defaultNote: "déduit du terminal",
      placement: "workstation",
    },
  },
  NF_PERF_PROBE: {
    name: "NF_PERF_PROBE",
    role: "arme la sonde de performance du pipeline HTTP",
    tunable: {
      title: "Sonde de performance HTTP",
      defaultNote: "désactivée (1 l'arme)",
      placement: "workstation",
    },
  },
  NF_ORM_FLOW: {
    name: "NF_ORM_FLOW",
    role: "arme la sonde de flux de l'ORM",
    tunable: {
      title: "Sonde de flux de l'ORM",
      defaultNote: "active en développement, coupée en production (1 la force)",
      placement: "workstation",
      modules: ["@nodefony/drizzle", "@nodefony/mongoose"],
    },
  },
  NF_ORM_HEARTBEAT_MS: {
    name: "NF_ORM_HEARTBEAT_MS",
    role: "période du battement de cœur qui surveille les connecteurs de l'ORM",
    tunable: {
      title: "Battement de cœur de l'ORM (ms)",
      defaultNote: "30000 (0 le désactive)",
      placement: "platform",
      modules: ["@nodefony/drizzle", "@nodefony/mongoose"],
    },
  },
  NF_MIGRATE_DATABASE_URL: {
    name: "NF_MIGRATE_DATABASE_URL",
    role: "base visée par `orm:migrate`, quand le compte qui migre n'est pas celui qui sert",
    tunable: {
      title: "Base des migrations",
      defaultNote: "l'URL du connecteur",
      placement: "secrets",
      sensitive: true,
      modules: ["@nodefony/drizzle"],
    },
  },
  NF_OUTPUT: {
    name: "NF_OUTPUT",
    role: "rendu du démarrage : human, plain ou json (`--output` l'emporte)",
    tunable: {
      title: "Rendu du démarrage",
      defaultNote: "human dans un terminal, plain sinon",
      placement: "workstation",
    },
  },
  NF_NO_PROGRESS: {
    name: "NF_NO_PROGRESS",
    role: "coupe les barres de progression du CLI",
    tunable: {
      title: "Barres de progression du CLI",
      defaultNote: "affichées dans un terminal (jamais en CI)",
      placement: "workstation",
    },
  },
  NF_BANNER_ASCII: {
    name: "NF_BANNER_ASCII",
    role: "bannière du CLI en ASCII pur (`1`), pour une police sans caractères de dessin",
    tunable: {
      title: "Bannière ASCII",
      defaultNote: "déduite du terminal",
      placement: "workstation",
    },
  },
  NF_NODE_DIST_URL: {
    name: "NF_NODE_DIST_URL",
    role: "liste des versions de Node lue par `nodefony doctor` (URL d'un miroir ou chemin)",
    tunable: {
      title: "Index des versions de Node",
      defaultNote: "https://nodejs.org/dist/index.json",
      placement: "workstation",
    },
  },
  NF_WITH_DEV_MODULES: {
    name: "NF_WITH_DEV_MODULES",
    role: "dérogation : charge les modules de développement hors développement (`1`), pour une mesure",
    tunable: {
      title: "Modules de développement hors développement",
      defaultNote: "non chargés",
      placement: "workstation",
    },
  },
  NF_WITH_DEV_MODULES_TTL_MIN: {
    name: "NF_WITH_DEV_MODULES_TTL_MIN",
    role: "durée de vie, en minutes, d'un runtime en dérogation NF_WITH_DEV_MODULES",
    tunable: {
      title: "Durée de la dérogation (min)",
      defaultNote: "30 (plafond 240)",
      placement: "workstation",
    },
  },
  NF_DETACH_CHILD: {
    name: "NF_DETACH_CHILD",
    role: "posée par `--detach` dans le serveur qu'il lance en arrière-plan (garde anti-boucle)",
  },
  NF_DEV_RELOAD: {
    name: "NF_DEV_RELOAD",
    role: "posée par le superviseur de développement quand il relance après une modification",
  },
  NF_DEV_BUILD_ISSUE: {
    name: "NF_DEV_BUILD_ISSUE",
    role: "verdict de construction que le superviseur de développement transmet au serveur relancé",
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

/** Section de la notice qui range les réglages de déploiement du framework. */
const FRAMEWORK_DEPLOYMENT_SECTION = "Framework : déploiement";
/** Section de la notice qui range les réglages de poste et de diagnostic. */
const FRAMEWORK_WORKSTATION_SECTION = "Framework : poste et diagnostic";

/**
 * Les réglages du FRAMEWORK, au format du catalogue d'une application — la
 * section « Framework » de toute notice `.env.example`.
 *
 * Ils ne sont dans aucun `env.ts` : le framework les lit lui-même. Sans cette
 * projection, la notice taisait une vingtaine de variables que l'exploitant
 * peut poser — le nombre de workers, le délai de démarrage, le pilote du
 * backplane. Dérivée de {@link RESERVED_ENV}, seule liste de ces noms.
 *
 * Les réglages de déploiement passent avant ceux du poste : c'est l'ordre dans
 * lequel un exploitant les cherche.
 *
 * @param declared - les modules que l'application déclare (`use("…")` de son
 *   manifeste) ; un réglage lu par un module absent n'y figure pas — la notice
 *   d'une application sans temps réel ne parle pas du backplane. `null` : tous.
 * @returns les variables réglables, rangées en deux sections.
 */
export function frameworkEnvCatalog(
  declared: readonly string[] | null = null,
): readonly NamedEnvVarMeta[] {
  const deployment: NamedEnvVarMeta[] = [];
  const workstation: NamedEnvVarMeta[] = [];
  for (const entry of Object.values(RESERVED_ENV) as IReservedEnvVar[]) {
    if (!entry.tunable) continue;
    const { modules, ...shown } = entry.tunable;
    if (declared && modules && !modules.some((m) => declared.includes(m))) {
      continue;
    }
    const local = shown.placement === "workstation";
    (local ? workstation : deployment).push({
      name: entry.name,
      kind: "string",
      optional: true,
      section: local
        ? FRAMEWORK_WORKSTATION_SECTION
        : FRAMEWORK_DEPLOYMENT_SECTION,
      // Le rôle est un fragment écrit pour le rapport de `nodefony env` ; la
      // notice le rend en phrase.
      description: `${entry.role.charAt(0).toUpperCase()}${entry.role.slice(1)}.`,
      ...shown,
    });
  }
  return [...deployment, ...workstation];
}
