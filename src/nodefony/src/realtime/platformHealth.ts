/**
 * platformHealth — **charges de santé de la plateforme**, telles qu'elles voyagent
 * sur la socket (`nodefony:socket`) et sur le plan d'administration
 * (`/nodefony/realtime/api/health`).
 *
 * Les PRODUCTEURS vivent côté serveur (sondes process, ORM, hub de `@nodefony/realtime`),
 * mais la FORME de ce qu'ils publient appartient aux deux bouts : le navigateur la lit.
 * Elle vit donc ici, au cœur isomorphe — types seuls, aucun import, 0 octet compilé —,
 * et chaque producteur la ré-exporte depuis son emplacement historique. Un écran qui
 * recopiait ces formes (« miroir ») divergeait du jour où une sonde ajoutait un champ,
 * sans une erreur de compilation.
 */

/**
 * Santé PROCESS d'un worker — lue par `ProcessProbe`, agrégée par worker dans le
 * snapshot pod (cf `ClusterProbeAggregator`). Volontairement **lean** (sérialisée par
 * worker à chaque tick de report ≥ 1 s) : juste de quoi peupler une grille « salle des
 * machines » (1 carte/worker). Les sondes lourdes (GC, heap-spaces, ctx-switches) restent
 * au canal `nodefony:supervision` per-process pour le drill-down.
 */
export interface IProcessHealth {
  /** PID du worker (= instanceId de la vue pod). */
  pid: number;
  /** Uptime du process (secondes). */
  uptime: number;
  /** % d'UN cœur sur l'intervalle (comme `top` : un Node mono-thread sature ~100). */
  cpuPercent: number;
  /**
   * Retard moyen de la boucle sur l'intervalle (ms), période d'échantillonnage
   * retranchée : 0 sur une boucle libre.
   */
  eventLoopMs: number;
  /** Pire retard de la boucle sur l'intervalle (ms) : le plus long blocage. */
  eventLoopMaxMs: number;
  /** Saturation de la boucle (ELU) sur l'intervalle, 0–1 (~1 = thread saturé). */
  eluUtilization: number;
  /** Resident Set Size (octets). */
  rss: number;
  /** Heap V8 utilisé (octets). */
  heapUsed: number;
  /** Heap V8 total (octets). */
  heapTotal: number;
  /** Plafond heap V8 (octets, constant) — pour `heapUsed/heapLimit` (% avant OOM). */
  heapLimit: number;
  /** Mémoire hors-heap (buffers, etc.) (octets). */
  external: number;
  /** Horodatage de la mesure. */
  ts: number;
}

/**
 * Sonde process **riche** d'un worker — le complément du lean {@link IProcessHealth}
 * pour le drill-down (Phase 2). Ne contient QUE ce qui manque au lean : pression GC,
 * répartition du heap V8, ressources actives, ELU active/idle (ms) et changements de
 * contexte OS. Fusionné côté front avec le lean déjà présent dans le snapshot pod.
 */
export interface IProcessRich {
  /** Pression GC sur l'intervalle (cycles, pause totale ms, majeurs/mineurs). */
  gc: { count: number; pauseMs: number; major: number; minor: number };
  /** Répartition mémoire V8 par espace (new/old/code/large_object…), octets. */
  heapSpaces: { name: string; used: number; size: number }[];
  /** Ressources actives qui tiennent la boucle, total + par type. */
  handles: { total: number; byType: Record<string, number> };
  /** Saturation de la boucle sur l'intervalle (ms actifs / idle ; utilization est dans le lean). */
  elu: { active: number; idle: number };
  /** Changements de contexte OS sur l'intervalle (volontaires = cède, involontaires = préempté). */
  ctx: { voluntary: number; involuntary: number };
  /** Load average système (1/5/15 min). */
  loadavg: [number, number, number];
  /** Limite de heap V8 du process (octets) — constante. */
  heapLimit: number;
  /** Nombre de cœurs vus par le process — constante. */
  cpuCount: number;
  /** Horodatage de la mesure. */
  ts: number;
}

/**
 * Santé ORM **agrégée per-instance** (lean) — somme process-wide de tous les connecteurs
 * enregistrés, dérivée des singletons `queryFlowMonitor` + `connectionMonitor` (0 ping, 0
 * `toSQL`, O(N connecteurs)). Rejoint le report de sonde du worker à chaque tick (≥ 1 s).
 * Tous les cumuls sont **monotones** → débit/s dérivé côté lecteur (delta/ts, comme le CPU%).
 */
export interface IOrmLeanHealth {
  /** Connecteurs ORM enregistrés (registre). */
  connectors: number;
  /** Connecteurs actuellement connectés (`isConnected()`). */
  connected: number;
  /**
   * Parmi les connectés, ceux dont l'état est **SUPPOSÉ** et non constaté :
   * leur adapter n'a aucun signal de cycle de vie à traduire (base embarquée,
   * driver muet), donc « connecté » y veut seulement dire « la connexion a
   * été ouverte et n'a pas été fermée ».
   *
   * Sans ce compte, une readiness ne peut pas distinguer un connecteur qu'on
   * SAIT vivant d'un connecteur dont on ne sait rien — et c'est le second qui
   * fait prendre les mauvaises décisions.
   */
  assumed: number;
  /** Requêtes ORM cumulées, tous connecteurs (monotone ; 0 si flux OFF en prod). */
  queryTotal: number;
  /** Requêtes lentes cumulées (au-dessus du seuil `slowMs`) (monotone). */
  slowTotal: number;
  /** Erreurs de connexion ORM cumulées (monotone). */
  errorTotal: number;
  /** Reconnexions ORM cumulées (monotone). */
  reconnectTotal: number;
  /** Pire latence EWMA (ms) parmi les connecteurs (instantané), ou `null` si non observé. */
  maxEwmaMs: number | null;
}

/**
 * Santé **erreurs per-instance** — compteurs Syslog monotones (cf `Syslog.errorTotal` /
 * `Syslog.criticTotal`). Permet une carte « erreurs par worker » + un taux d'erreur pod
 * (delta côté lecteur). Lecture pure d'entiers, 0 scan du ring buffer.
 */
export interface IInstanceErrorHealth {
  /** Logs ERROR/CRITIC/ALERT/EMERGENCY cumulés (sévérité 0–3) (monotone). */
  errorTotal: number;
  /** Sous-ensemble CRITIQUE : CRITIC/ALERT/EMERGENCY (sévérité 0–2) (monotone). */
  criticTotal: number;
}

/**
 * Compteurs de la **file d'envoi** d'un backplane à transport réseau : ce qui est
 * publié mais pas encore acquitté par le bus. Sans borne, cette file (interne au
 * client réseau) grossit sans limite sous rafale — d'où le seuil et ses compteurs,
 * exposés jusqu'à la sonde et Studio. Cf `BackplanePublishQueue`.
 */
export interface IBackplaneQueueInfo {
  /** Octets publiés en attente d'acquittement par le transport (instantané). */
  bytes: number;
  /** Seuil au-dessus duquel une publication est jetée ; `0` = illimité. */
  maxBytes: number;
  /** Publications JETÉES faute de place (monotone). `0` en régime sain. */
  droppedTotal: number;
  /** Publications REFUSÉES par le transport (bus coupé…) (monotone). */
  failedTotal: number;
  /**
   * Ordres de contrôle (terminer un canal, éjecter un compte) refusés par le
   * transport, donc non appliqués par les autres serveurs (monotone). Un ordre
   * n'est jamais JETÉ par la file — seul un bus injoignable le perd. `0` en
   * régime sain. Absent d'un driver tiers qui ne le mesure pas.
   */
  controlLostTotal?: number;
}

/**
 * **Carte d'identité** d'un backplane — descripteur de DONNÉE (pas un log) décrivant
 * l'état du fond de panier. Source unique alimentant trois sorties cohérentes : la
 * ligne stdout au boot, le champ `backplane` de la sonde (`/api/health`) et la vue
 * Studio. Réutilisable par les tests / un agent IA sans dupliquer la connaissance
 * « c'est quoi ce backplane ».
 */
export interface IBackplaneInfo {
  /** Nom du driver (clé du registre). Ex. `redis`, `cluster`, `loopback`. */
  driver: string;
  /** Nature du transport. Ex. `redis-pubsub`, `ipc`, `local`. */
  kind: string;
  /** Identité de CE pair (process/pod). Ex. `String(process.pid)`. */
  originId: string;
  /** `true` si le fan-out franchit les frontières de pod (multi-host). */
  crossPod: boolean;
  /** Canal/topic de transport, si applicable (canal Redis, topic Kafka). */
  channel?: string;
  /**
   * Les messages sont-ils **scellés** (authenticité de l'émetteur vérifiée) ?
   * Renseigné par les drivers à transport PARTAGÉ, où un tiers peut écrire :
   * `false` y signale un bus ouvert. Absent quand la question n'a pas de sens
   * (mono-process, IPC master↔workers — authentifié par construction).
   */
  sealed?: boolean;
  /**
   * Messages reçus du bus dont le sceau est refusé — unité : un message reçu d'un
   * exemplaire, jeté parce que son sceau ne se vérifie pas (ADR-0021 S6, S9). Monotone.
   * Pendant une rotation du secret, les exemplaires qui n'ont pas le même se refusent
   * leurs messages : ce compteur le montre. Présent seulement quand le bus est scellé
   * (`sealed: true`) ; relayé au premier niveau de la sonde du hub.
   */
  sealRejectedTotal?: number;
  /**
   * État de la **file d'envoi** vers le bus (octets en vol, seuil, jetés). Renseigné
   * par les drivers à transport RÉSEAU, dont les publications sont acquittées de
   * façon asynchrone : c'est là qu'un bus lent fait grossir la mémoire du pod.
   * `droppedTotal > 0` = du fan-out cross-pod a été sacrifié pour tenir la mémoire.
   * Absent quand le transport n'a pas de file (mono-process, IPC synchrone).
   */
  queue?: IBackplaneQueueInfo;
  /**
   * Les octets d'une charge traversent-ils le bus intacts (`IBackplane.enableBytes`) ?
   * `true` seulement quand le serveur a un codec binaire ET que le transport sait les
   * porter. Absent : les octets restent sur ce serveur (ADR-0021 S6).
   */
  bytes?: boolean;
}

/** Stat per-canal du hub (fan-out). */
export interface IRealtimeChannelStat {
  /** Nom du canal (suffixe `:<ms>` de granularité inclus). */
  channel: string;
  /** Abonnés locaux vivants (sinks) — instantané. */
  subscribers: number;
  /** Publications cumulées sur ce canal (monotone) → débit dérivé côté lecteur. */
  messages: number;
}

/**
 * Snapshot PUR du hub (sans identité process) — ce que renvoie `RealtimeHub.probe()`.
 * Per-instance/pod (cloud-native) ; l'agrégat multi-pod = backplane Redis / Prometheus.
 *
 * Trois familles de signaux, dérivées de l'analyse du multiplexing N canaux / 1 WS :
 *  - **fan-out** : combien de canaux, d'abonnés, de livraisons (chatter du broker) ;
 *  - **backpressure** (risque #1, SEUL vrai blocker mémoire) : `bufferedAmount` par
 *    connexion — une connexion lente fait grossir la file `ws` → OOM, et le
 *    multiplexing CONCENTRE (1 WS lente bloque TOUS ses canaux) ;
 *  - **débit octets/frames** : tous les cumuls sont **monotones** → le débit/s se
 *    dérive côté lecteur (delta `total`/`ts`) : 0 état de lecture.
 */
export interface IRealtimeProbe {
  /** Horodatage du snapshot (ms epoch) — base du calcul de débit côté lecteur. */
  ts: number;
  /** Canaux actifs (≥ 1 abonné) avec abonnés + publications cumulées. */
  channels: IRealtimeChannelStat[];
  /** Nombre de canaux actifs (= 1 provider/canal/pod). */
  channelCount: number;
  /** Appels `publish` cumulés (monotone). */
  publishTotal: number;
  /** Livraisons cumulées (`publish` × abonnés) — vrai coût de fan-out (monotone). */
  fanoutTotal: number;
  /** Frames entrantes full-duplex cumulées (canaux gated SIP/bridge) (monotone). */
  inboundTotal: number;
  /**
   * Messages d'ingress backplane REFUSÉS (canal non déclaré broadcast) — monotone.
   * Reste à 0 en fonctionnement normal : un pair légitime n'émet que des canaux
   * broadcast. Un compteur qui décolle = pair mal configuré, ou écriture tierce
   * dans un bus partagé (Redis mutualisé). Cf `RealtimeHub` (contrôle d'admission).
   */
  ingressRejectedTotal: number;
  /**
   * Messages du bus JETÉS parce que d'une version plus récente — canal de la
   * plateforme `nodefony:bus:*` ou type d'ordre que ce serveur ne connaît pas —
   * monotone. Jamais compté dans `ingressRejectedTotal` (ADR-0025, S-rt-92) : il
   * monte LÉGITIMEMENT pendant un déploiement progressif, et retombe à plat quand
   * tous les serveurs portent la même version. Qui monte hors déploiement = un
   * serveur resté sur une version plus ancienne.
   */
  ingressUnknownDiscardedTotal: number;
  /**
   * Publications restées sur CE serveur alors qu'un bus est branché — canal non
   * déclaré diffusable (`@RealtimeBroadcast`) — monotone ; toujours 0 sans bus.
   * Voulu pour un canal propre au pod (forage de Studio, barre de débogage) ;
   * ailleurs, c'est l'oubli qui prive les abonnés des autres serveurs, en silence.
   */
  localOnlyTotal: number;
  /**
   * Abonnements clients REFUSÉS par le plancher des canaux de plateforme —
   * monotone. Un canal réservé (`nodefony:*`) a été demandé alors qu'aucun
   * module de sécurité n'est chargé : sans identité vérifiable, le hub ferme.
   * `> 0` signale une configuration incomplète (sécurité absente) autant qu'une
   * tentative d'accès — dans les deux cas, quelque chose est à regarder.
   */
  systemFloorDeniedTotal: number;
  /**
   * Messages du bus REFUSÉS parce que leur sceau ne se vérifie pas — monotone, unité :
   * un message reçu d'un exemplaire. Relaie `backplane.sealRejectedTotal` (compté par
   * le driver, seul à ouvrir l'enveloppe) ; `0` sans bus scellé. `> 0` = rotation du
   * secret en cours, producteur mal configuré, ou écriture tierce dans le bus.
   */
  sealRejectedTotal: number;
  /**
   * Trames entrantes ÉCARTÉES par la borne de débit, avant tout décodage — monotone,
   * unité : une trame reçue. Cumul du PROCESSUS relayé de `@nodefony/http`
   * (`frameRateRejectedTotal()`) : une trame écartée n'atteint aucun hub. `0` tant que
   * `maxFramesPerSecond` vaut 0 (défaut de la série 10).
   */
  frameRateRejectedTotal: number;
  /**
   * Appels d'`allow` restés SANS RÉPONSE dans `allowTimeoutMs` — monotone, unité : un
   * appel d'`allow`. L'abonné a reçu `unavailable` et réessaie. `> 0` qui monte =
   * la base ou le service que lisent les règles d'admission ne suit plus ; 50 en
   * 5 s ouvrent le coupe-circuit.
   */
  allowTimedOutTotal: number;
  /**
   * Demandes d'abonnement rendues `unavailable` SANS appel d'`allow` — monotone,
   * unité : une demande. Plafond `maxPendingAllowsTotal` atteint, coupe-circuit
   * ouvert, ou délai épuisé dans la file d'une connexion.
   */
  allowSaturatedTotal: number;
  /**
   * Poignées de main fermées en `1013` faute d'authentification dans
   * `authenticateTimeoutMs` — monotone, unité : une poignée de main. Le client
   * recule puis revient. `> 0` qui monte = la base ou le service qui porte les
   * identités ne répond plus.
   */
  authenticateTimedOutTotal: number;
  /**
   * Trames BINAIRES reçues et écartées faute de lecteur — monotone, unité : une trame
   * reçue. Une connexion texte dont le contrôleur ne surcharge pas `onRealtimeBinary`
   * n'a personne pour lire des octets bruts. `> 0` = un client envoie un flux que
   * personne n'attend : client mal configuré, ou lecteur oublié côté serveur.
   */
  binaryDiscardedTotal: number;
  /**
   * Trames reçues et écartées parce qu'illisibles par le codec de la connexion — JSON
   * invalide, CBOR tronqué — monotone, unité : une trame reçue. Aucune réponse n'est
   * rendue et la connexion est conservée (ADR-0022 §2). `> 0` qui monte = un client
   * défectueux, ou quelqu'un qui sonde le décodeur.
   */
  malformedDiscardedTotal: number;
  /** Connexions realtime vivantes. */
  connectionCount: number;
  /** Somme cumulée des octets envoyés, toutes connexions, fermées comprises (monotone). */
  bytesSentTotal: number;
  /** Somme cumulée des frames envoyées, toutes connexions, fermées comprises (monotone). */
  messagesSentTotal: number;
  /** Backpressure agrégée (instantanée) — risque #1. */
  backpressure: {
    /** Pire `bufferedAmount` parmi les connexions (octets). */
    maxBufferedAmount: number;
    /** Somme des `bufferedAmount` (octets en attente process-wide). */
    totalBufferedAmount: number;
    /** Connexions au-dessus du seuil d'alerte slow-consumer. */
    slowConsumers: number;
    /**
     * Cumul de frames jetées par back-pressure (drop latest-wins + close
     * slow-consumer), toutes connexions (monotone) → taux de perte dérivé côté
     * lecteur. `0` en régime sain ; croît = des clients lents sont contenus pour
     * protéger la mémoire process (sinon file `ws` non bornée → OOM).
     */
    drops: number;
  };
  /**
   * Carte d'identité du backplane effectif (driver, transport, cross-pod, canal).
   * Reflète l'état RÉEL : `local` si le hub n'a aucun backplane (mono-process ou
   * fallback fail-soft), sinon le descripteur du driver branché. Optionnel pour
   * rétrocompat des consommateurs qui construisent un probe partiel.
   */
  backplane?: IBackplaneInfo;
}

/** Snapshot enrichi de l'identité d'instance — santé per-instance d'un worker/pod. */
export interface IRealtimeHealth extends IRealtimeProbe {
  /** Identifiant de CE process/pod (per-instance). */
  instanceId: string;
  /**
   * Santé PROCESS du worker (CPU/mém/event-loop) — additif : la grille « salle des
   * machines » de la vue pod lit `instances[].process` par worker. Optionnel (absent si
   * sonde process coupée) → les consommateurs realtime existants l'ignorent (non-breaking).
   */
  process?: IProcessHealth;
  /**
   * Sonde process **riche** (GC/heap-spaces/handles/ELU active-idle/ctx-switches) —
   * présente UNIQUEMENT pendant un drill-down de CE worker (le master a envoyé
   * `nf:probe:enrich` à ce pid). Absente sinon → « on paie ce qu'on regarde » (0 surcoût
   * hors drill). Fusionnée côté front avec `process` pour la vue Supervision complète.
   */
  rich?: IProcessRich;
  /**
   * Santé ORM **lean** du worker (connecteurs/requêtes/erreurs/latence EWMA) — additif,
   * comme `process`. Présent si un driver ORM a branché sa sonde (`setOrmHealthProvider`),
   * absent sinon → les consommateurs realtime l'ignorent (non-breaking). Agrégée pod dans
   * {@link IRealtimeClusterHealth.totals}.`orm`.
   */
  orm?: IOrmLeanHealth;
  /**
   * Compteurs d'erreurs Syslog du worker (ERROR/CRITIC cumulés) — additif. Permet une
   * carte « erreurs par worker » + un taux d'erreur pod (delta côté lecteur). Absent si la
   * sonde n'a pu lire le syslog du kernel.
   */
  errors?: IInstanceErrorHealth;
  /**
   * Drivers de backplane **enregistrés dans ce process** (clés du registre ouvert :
   * natifs + ceux qu'une application a ajoutés par `registerBackplaneDriver`). Sert la
   * même question que la liste des backends côté stores : « qu'est-ce que je POURRAIS
   * brancher ? », à laquelle `backplane.driver` (l'actif) ne répond pas. Absent si le
   * registre n'est pas joignable.
   */
  backplaneDrivers?: string[];
  /**
   * Diagnostic ORM **riche** du worker (par connecteur : ping/latence/stockage/pool +
   * flux requêtes) — blob OPAQUE `{ health, flow }` produit par le driver, présent
   * UNIQUEMENT pendant un drill ORM de CE worker (facette `"orm"` : le master a envoyé
   * `nf:probe:enrich {facet:"orm"}` à ce pid). Absent sinon → « on paie ce qu'on regarde »
   * (0 ping ORM hors drill). Consommé par la page drill `/nodefony/orm/<pid>` (canal
   * `nodefony:orm:rich@<pid>`) → diagnostic riche du pid EXACT (≠ round-robin).
   */
  ormRich?: unknown;
}

/**
 * Vue **POD agrégée** de la socket (mode cluster) — la santé de TOUS les workers du pod
 * consolidée. Servie par n'importe quel worker via l'endpoint santé quand le master
 * pousse le snapshot agrégé (sinon on retombe sur {@link IRealtimeHealth} per-instance).
 *
 * `cluster: true` est le discriminant : un consommateur (Studio) distingue la vue pod de la
 * vue per-instance. `instances` garde le détail par worker (drill-down) ; `totals` somme les
 * scalaires (la backpressure `maxBufferedAmount` est un MAX, pas une somme — c'est le pire pod).
 */
export interface IRealtimeClusterHealth {
  /** Discriminant : vue agrégée multi-worker (≠ {@link IRealtimeHealth} per-instance). */
  cluster: true;
  /** Horodatage du snapshot agrégé (ms epoch). */
  ts: number;
  /** Nombre de workers présents dans l'agrégat. */
  instanceCount: number;
  /** Santé par worker (détail per-instance pour le drill-down). */
  instances: IRealtimeHealth[];
  /** Totaux pod (sommes des scalaires ; backpressure max = pire worker). */
  totals: {
    channelCount: number;
    publishTotal: number;
    fanoutTotal: number;
    inboundTotal: number;
    /** Ingress backplane refusés, tous workers (signal de sécurité pod-wide). */
    ingressRejectedTotal: number;
    /** Publications restées sur leur worker malgré le bus, tous workers. */
    localOnlyTotal: number;
    connectionCount: number;
    bytesSentTotal: number;
    messagesSentTotal: number;
    backpressure: {
      /** Pire `maxBufferedAmount` parmi les workers (octets) — pas une somme. */
      maxBufferedAmount: number;
      /** Somme des octets en attente, tous workers. */
      totalBufferedAmount: number;
      /** Total des slow-consumers du pod. */
      slowConsumers: number;
      /** Total des frames jetées par back-pressure (drop + close), tous workers. */
      drops: number;
    };
    /**
     * Santé ORM agrégée du pod (sommes ; `maxEwmaMs` = pire worker). Présent si ≥ 1 worker
     * a remonté sa sonde ORM, absent sinon.
     */
    orm?: IOrmLeanHealth;
    /** Erreurs Syslog agrégées du pod (sommes). Présent si ≥ 1 worker a remonté ses compteurs. */
    errors?: IInstanceErrorHealth;
  };
}

/**
 * Ce que publie `nodefony:socket` et ce que rend `/nodefony/realtime/api/health` : la vue
 * POD agrégée en mode cluster, sinon la santé du seul worker qui répond. Le discriminant
 * est `cluster: true`.
 */
export type RealtimeHealthReport = IRealtimeClusterHealth | IRealtimeHealth;
