/**
 * platformChannels — **espace de nommage des surfaces temps réel de la plateforme**,
 * partagé par les deux bords de la socket (serveur et navigateur).
 *
 * Tout ce que Nodefony expose sur la socket pour parler **de lui-même** (journaux,
 * santé de la base, métriques du process, supervision du cluster, journal d'audit,
 * contrôle du pod) porte le préfixe {@link NODEFONY_CHANNEL_NAMESPACE}. Ce que
 * l'application expose pour parler de **son métier** ne le porte pas.
 *
 * C'est la même convention que les routes d'administration (`/nodefony/<module>/api/*`) :
 * une seule marque, des deux côtés du transport. Avant, chaque sonde apportait son
 * propre namespace (`syslog:`, `orm:`, `dashboard:`, `node:`…) — neuf territoires pour
 * une douzaine de canaux, dont un (`node:`) qui percutait le préfixe d'import des
 * modules natifs Node et polluait tout audit.
 *
 * **La table est la source unique** : personne n'écrit un nom de canal de plateforme en
 * clair, ni côté serveur (producteurs) ni côté navigateur (consommateurs). Une chaîne
 * recopiée dans un écran est une chaîne qui survivra au renommage suivant.
 *
 * Pur et isomorphe (aucun import, aucune allocation) : chargé aussi bien dans le bundle
 * navigateur que dans le pod.
 *
 * @see {@link rateChannel} — le suffixe de cadence (`base:<ms>`) se compose PAR-DESSUS
 *   ces bases ; ajouter un segment au préfixe ne le perturbe pas.
 */

/**
 * Marque des surfaces de plateforme sur la socket. Un canal qui commence par ce préfixe
 * décrit le serveur, jamais le métier de l'application.
 *
 * Conséquence côté sécurité : ces canaux ont un **plancher irréductible**
 * (authentification exigée, et sans module de sécurité ils sont purement fermés aux
 * connexions clientes). Une application ne peut pas se les approprier par accident —
 * c'est tout l'intérêt d'une marque en toutes lettres plutôt que d'un mot courant.
 */
export const NODEFONY_CHANNEL_NAMESPACE = "nodefony:";

/**
 * Canaux de **diffusion** de la plateforme (le serveur pousse, les écrans regardent).
 *
 * Les valeurs sont des **bases** : trois d'entre elles se déclinent par cible
 * (`…@<pid>` pour un forage sur un process, `…@<id>` pour un job) et toutes acceptent
 * le suffixe de cadence `:<ms>` (cf {@link rateChannel}). Composer, jamais concaténer
 * un préfixe à la main.
 */
export const PLATFORM_CHANNELS = {
  /** Journaux du pod (flux de `Pdu`, coalescé par le pont syslog). */
  syslog: "nodefony:syslog",
  /** Journal d'audit sécurité — plancher super-admin, un cran au-dessus des autres. */
  audit: "nodefony:audit",
  /** Métriques agrégées du tableau de bord (vue d'ensemble). */
  dashboard: "nodefony:dashboard",
  /** Supervision des process du cluster ; forage par process : `…@<pid>`. */
  supervision: "nodefony:supervision",
  /** Sondes de la barre de debug (mêmes mesures que la supervision, ticker séparé). */
  debugbar: "nodefony:debugbar",
  /** Auto-observabilité de la socket elle-même (canaux, abonnés, fan-out, backpressure). */
  socket: "nodefony:socket",
  /** Santé des connecteurs de base (état, ping). */
  ormHealth: "nodefony:orm:health",
  /** Flux ORM (débit de requêtes, latence, requêtes lentes) — plus dynamique que la santé. */
  ormFlow: "nodefony:orm:flow",
  /** Forage détaillé d'un connecteur sur un process donné : `…@<pid>`. */
  ormRich: "nodefony:orm:rich",
  /** Sortie d'un job de génération de code : `…@<jobId>` (développement uniquement). */
  scaffoldJob: "nodefony:scaffold:job",
} as const;

/**
 * Canaux **MONTANTS** de la plateforme (le navigateur pousse, le pod reçoit).
 *
 * Ils vivent dans une table à part parce qu'ils sont l'inverse de
 * {@link PLATFORM_CHANNELS} : là un écran regarde, ici un écran ÉCRIT. Les mélanger
 * ferait passer une surface d'écriture pour une surface de lecture au premier coup
 * d'œil — et c'est précisément la distinction qui décide des bornes à poser.
 *
 * Ils portent la même marque `nodefony:`, donc le même **plancher irréductible**
 * (authentification exigée ; sans module de sécurité, fermés aux connexions
 * clientes). C'est le défaut voulu : un journal d'exploitation ouvert en écriture
 * anonyme se noie et se falsifie. Une application qui veut capter les erreurs de
 * visiteurs non authentifiés le déclare explicitement, et hérite des bornes.
 */
export const PLATFORM_INBOUND = {
  /** Journaux du navigateur remontés vers le `Syslog` du pod (lots de `Pdu`). */
  syslogUplink: "nodefony:syslog:uplink",
} as const;

/** Nom d'un canal montant de plateforme (valeur de {@link PLATFORM_INBOUND}). */
export type PlatformInboundChannel =
  (typeof PLATFORM_INBOUND)[keyof typeof PLATFORM_INBOUND];

/**
 * Méthodes **RPC** de la plateforme (le client demande, le serveur répond).
 *
 * Elles portent la même marque que les canaux pour la même raison : ce sont des
 * surfaces du serveur, pas de l'application. `nodefony:kernel:gc` déclenche un cycle
 * de ramasse-miettes bloquant — un nom aussi lourd de conséquences n'a rien à faire
 * dans l'espace de nommage où une application déclare ses propres actions.
 *
 * ⚠️ À ne pas confondre avec les **notifications du protocole** (`realtime:welcome`,
 * `realtime:denied`) : celles-là décrivent la mécanique de la socket elle-même, pas
 * une surface de la plateforme, et ne sont ni des canaux ni des actions.
 */
export const PLATFORM_METHODS = {
  /** Liveness + mesure du temps d'aller-retour. */
  ping: "nodefony:kernel:ping",
  /** Force un cycle GC (seulement si le pod tourne avec `--expose-gc`). */
  gc: "nodefony:kernel:gc",
  /** Ce qu'un scaffold écrirait — fichiers créés, diff des réécritures — sans rien écrire. */
  scaffoldPreview: "nodefony:scaffold:preview",
  /** Démarre un job de génération de code et rend son identifiant. */
  scaffoldRun: "nodefony:scaffold:run",
  /** Demande l'arrêt d'un job de génération en cours. */
  scaffoldCancel: "nodefony:scaffold:cancel",
} as const;

/**
 * Événements **DOM** de la plateforme (`window`), dans le même espace de nommage.
 *
 * Ils ne passent pas par la socket — ce sont des `CustomEvent` que le navigateur
 * fait circuler entre la barre de debug, le pont HMR et l'écran qui les écoute.
 * Ils portent la marque pour la même raison que les canaux : `window` est un
 * espace partagé avec l'application, et un nom d'événement générique s'y
 * télescoperait.
 */
export const PLATFORM_EVENTS = {
  /** Un hot-update Vite vient d'être appliqué (émis par le pont du template). */
  hmr: "nodefony:hmr",
  /** L'utilisateur a choisi une entrée dans la barre de debug. */
  debugbarSelect: "nodefony:debugbar:select",
} as const;

/** Nom d'un canal de plateforme (valeur de {@link PLATFORM_CHANNELS}). */
export type PlatformChannel =
  (typeof PLATFORM_CHANNELS)[keyof typeof PLATFORM_CHANNELS];

/** Nom d'une méthode RPC de plateforme (valeur de {@link PLATFORM_METHODS}). */
export type PlatformMethod =
  (typeof PLATFORM_METHODS)[keyof typeof PLATFORM_METHODS];

/**
 * `s` commence-t-il par `prefix`, **insensible à la casse** et sans allocation ?
 *
 * La casse doit être neutralisée : sinon `NODEFONY:syslog` échapperait au plancher que
 * `nodefony:syslog` subit — un contournement à un `toUpperCase()` près. Comparaison
 * caractère par caractère plutôt que `toLowerCase()` : ce test est sur le chemin
 * d'abonnement, on n'y alloue pas de chaîne.
 */
export function startsWithCI(s: string, prefix: string): boolean {
  if (s.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    let a = s.charCodeAt(i);
    if (a >= 65 && a <= 90) a += 32;
    let b = prefix.charCodeAt(i);
    if (b >= 65 && b <= 90) b += 32;
    if (a !== b) return false;
  }
  return true;
}

/**
 * Le nom désigne-t-il une surface de la plateforme (canal OU méthode) ?
 *
 * Un seul `startsWith` insensible à la casse, là où il fallait auparavant parcourir
 * neuf préfixes à chaque abonnement.
 *
 * @param name - nom du canal demandé (suffixes de cadence/forage inclus) ou de la
 *   méthode RPC appelée.
 */
export function isPlatformChannel(name: string): boolean {
  return startsWithCI(name, NODEFONY_CHANNEL_NAMESPACE);
}
