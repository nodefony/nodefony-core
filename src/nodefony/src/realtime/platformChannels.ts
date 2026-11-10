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
  /**
   * Canal qu'AUCUN fournisseur ne sert : s'y abonner ne lève rien et ne reçoit jamais rien.
   *
   * @deprecated Utiliser {@link PLATFORM_CHANNELS.supervision} (`nodefony:supervision`),
   *   qui porte les métriques des process. Valeur conservée à l'identique pendant la série 10 ;
   *   retrait en 11.0.0.
   */
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

/**
 * Canaux de la plateforme qui ne circulent QU'ENTRE SERVEURS, sur le bus (backplane) — jamais servis à un client.
 *
 * Ils sont l'inverse des deux tables précédentes : aucun écran ne les regarde,
 * aucun navigateur n'y écrit. Le hub les lit à l'entrée du bus par une branche
 * dédiée, avant toute diffusion ; ils ne sont jamais réinjectés aux abonnés
 * locaux. Ils portent la marque `nodefony:` pour que le bus refuse qu'une
 * application les déclare diffusables, et pour qu'aucun client ne puisse s'y
 * abonner sans le plancher de la plateforme.
 */
export const PLATFORM_BUS_CHANNELS = {
  /**
   * Ordres qui ENLÈVENT, appliqués par chaque serveur à ses propres connexions :
   * terminer un canal, éjecter un compte d'un canal (ADR-0022 §6 décision 4).
   */
  control: "nodefony:bus:control",
  /**
   * Présence répartie (ADR-0025 P2) : lots de changements, demandes d'état et réponses.
   * JETABLES par la file d'envoi saturée — leur volume suit l'activité, et une perte se
   * répare (trou → demande d'état ciblée).
   */
  presence: "nodefony:bus:presence",
  /**
   * Preuve de vie de la présence (ADR-0025 P2) : quelques dizaines d'octets par intervalle,
   * indépendants du nombre de canaux. HORS QUOTA de la file d'envoi
   * ({@link isPriorityBusChannel}) — jetée, elle ferait oublier un pod vivant.
   */
  presenceAlive: "nodefony:bus:presence:alive",
} as const;

/**
 * Préfixe de tous les canaux de {@link PLATFORM_BUS_CHANNELS} — le territoire du bus entre serveurs.
 *
 * Une version suivante y AJOUTE des canaux (présence répartie, ADR-0025) : un
 * serveur plus ancien les reçoit pendant un déploiement progressif sans les
 * connaître. Le préfixe est ce qui lui permet de les reconnaître comme « de la
 * plateforme, d'une autre version » plutôt que comme une injection.
 */
export const PLATFORM_BUS_PREFIX = "nodefony:bus:";

/**
 * Le canal appartient-il au territoire du bus de la plateforme ({@link PLATFORM_BUS_PREFIX}) ?
 *
 * Sensible à la casse, à l'inverse d'{@link isPlatformChannel} : celle-ci pose
 * un plancher de sécurité, qu'une variante de casse ne doit pas contourner ;
 * celle-là CLASSE un message qu'un pair légitime émet toujours sous sa forme
 * exacte. Une variante de casse n'est donc pas « d'une autre version » — elle
 * reste comptée comme suspecte.
 *
 * @param channel - canal d'un message reçu du bus.
 */
export function isPlatformBusChannel(channel: string): boolean {
  return channel.startsWith(PLATFORM_BUS_PREFIX);
}

/**
 * Le canal du bus passe-t-il HORS QUOTA de la file d'envoi (jamais jeté quand elle sature) ?
 *
 * Seule source de la règle, lue par la file et par tout driver qui en tient une
 * (ADR-0025 P2) : l'ordre de contrôle (il ENLÈVE — éjection, fin de canal) et la preuve
 * de vie de la présence (jetée, elle ferait oublier un pod vivant). Tout le reste est
 * jetable, lots de présence compris. « Hors quota » veut dire jamais jeté, pas livré à
 * temps : un bus bloqué se constate par l'écho.
 *
 * Nom EXACT, sensible à la casse : un pair légitime émet toujours la forme exacte, et
 * une variante n'a pas à gagner la voie prioritaire. Deux comparaisons de chaîne, sans
 * allocation — l'appelant ne la consulte que file saturée.
 *
 * @param channel - canal d'une publication vers le bus.
 */
export function isPriorityBusChannel(channel: string): boolean {
  return (
    channel === PLATFORM_BUS_CHANNELS.control ||
    channel === PLATFORM_BUS_CHANNELS.presenceAlive
  );
}

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
 * `realtime:denied`, `realtime:subscribed`) : celles-là décrivent la mécanique de la socket elle-même, pas
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
  /**
   * Renvoie une charge d'octets de taille fixe (`THROUGHPUT_PAYLOAD_SIZES`),
   * serveur → client : mesure du coût d'un codec sur le fil.
   */
  throughput: "nodefony:realtime:throughput",
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
