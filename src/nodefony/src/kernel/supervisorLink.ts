/**
 * Lien du noyau avec le processus qui l'a lancé et avec le terminal (ADR-0013)
 * — famille « terminal & superviseur » de `Kernel.ts`, détenue par
 * COMPOSITION : le Kernel porte UNE instance (`supervisorLink`), allouée au
 * constructeur dans TOUS les modes. Sans superviseur (production, `--no-watch`,
 * lancement direct), l'objet est inerte : `supervised` est faux, {@link send}
 * rend `false` sans rien allouer, {@link listen} n'attache rien.
 *
 * C'est la SEULE sortie et la seule entrée typées {@link DevChannelMessage}
 * côté noyau — hors le relais de redimensionnement (`resize`) que la porte du
 * terminal (`runtime/isTerminal.ts`) écoute seule, avant que le noyau n'existe.
 * Le `BootReporter` émet par {@link SupervisorLink.send}, et un
 * futur lot d'historique à la demande (ADR-0013 §6) s'aiguillera dans
 * {@link SupervisorLink.listen} — un seul endroit, que le compilateur désigne
 * dès qu'un membre de l'union n'y est pas traité. La perte du canal (superviseur
 * mort) arrête le serveur : {@link SupervisorLink.stopOnSupervisorLoss}. Le verdict « lancé par le
 * superviseur » se CONSTATE ici une fois, à la construction, sur
 * `DEV_CHILD_ENV` (`service/dev/devChannelBase.ts`) : plus de lecture éparpillée de la variable.
 *
 * Ce que ce module ne porte PAS, et pourquoi :
 * - le verdict terminal `isTTY` reste un champ DIRECT du Kernel — lu à chaud
 *   par `initializeLog`, `startBoot` et plusieurs commandes, et POSÉ par des
 *   tests : un seul propriétaire, lu ici à l'appel au travers de l'hôte ;
 * - l'enveloppe IPC héritée `process:msg` (`Kernel.sendMessage`) n'est pas du
 *   canal `nf-dev` : elle parle au PRIMAIRE du cluster, par le même tube mais
 *   sous un autre discriminant (`type`, jamais `channel`). Elle vit dans
 *   `kernelCluster.ts`, avec l'écoute des messages de contrôle du primaire.
 *
 * Module FEUILLE à l'exécution : les imports de `./kernelCluster` et des types
 * du noyau sont des `import type`, effacés à la compilation.
 */
import { Nodefony } from "../Nodefony";
import { renderBrand, resolveBrandCharset } from "../cli/brand";
import { isLogColorEnabled } from "../syslog/logColor";
import { terminalSize } from "../runtime/isTerminal";
import {
  CLEAR_SCREEN,
  isDebugRequested,
  readOutputFlag,
  reloadCount,
  resolveOutputMode,
  type StartupOutputMode,
} from "../service/dev/outputMode";
import {
  DEV_CHANNEL,
  DEV_READY,
  isCommandExecuteParams,
  LIVE_RESULT_TOO_LARGE,
  listenToSupervisor,
  hasSupervisorChannel,
  MAX_LIVE_RESULT_BYTES,
  sendRpcToSupervisor,
  sendToSupervisor,
  terminateOnSupervisorLoss,
  type CommandExecuteResult,
  type DevActions,
  type DevChannelMessage,
  type DevEvents,
  type ICommandExecuteParams,
  type IDevChannelEndpoint,
  type ISupervisorLossTarget,
} from "../service/dev/devChannel";
import { JsonRpcPeer, RpcError, type IRpcCall } from "../realtime/JsonRpcPeer";
import { JsonRpcError } from "../jsonrpc/index";
import type { DefaultEventsMap } from "../realtime/RealtimeEventMap";
import {
  HeldServicesClient,
  type IHeldServicesClient,
} from "./heldServicesClient";
import type { EnvironmentType } from "../types/globals";
import type { ClusterType } from "./kernelCluster";

/** Désinscription vide, partagée : rien n'a été attaché, rien à retirer. */
const noop = (): void => {};

/**
 * Ce qui sert une commande en direct (ADR-0013 §6) : rend le résultat, ou
 * `{ live: false }` quand la commande ne se sert pas en mémoire. `call.signal`
 * est abandonné quand l'invite annule.
 */
export type LiveCommandExecutor = (
  params: ICommandExecuteParams,
  call: IRpcCall,
) => CommandExecuteResult | Promise<CommandExecuteResult>;

/** Le pair du serveur : il émet `dev.ready`, ne reçoit que des requêtes. */
type ServerDevPeer = JsonRpcPeer<DevEvents, DefaultEventsMap, DevActions>;

/**
 * Sert UNE requête `command.execute` : paramètres vérifiés (ils viennent du
 * fil), puis réponse bornée — au-delà de {@link MAX_LIVE_RESULT_BYTES}, un
 * refus nommé, jamais une réponse amputée.
 *
 * La taille se mesure sur le JSON que l'IPC enverra : une sérialisation de
 * plus, payée seulement par une commande tapée dans l'invite.
 */
async function serveLiveCommand(
  params: unknown,
  call: IRpcCall,
  execute: LiveCommandExecutor,
): Promise<CommandExecuteResult> {
  if (!isCommandExecuteParams(params)) {
    throw new RpcError("invalid params", JsonRpcError.INVALID_PARAMS);
  }
  const result = await execute(params, call);
  if (!result.live) return result;
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > MAX_LIVE_RESULT_BYTES) {
    throw new RpcError("result too large", LIVE_RESULT_TOO_LARGE, {
      bytes,
      max: MAX_LIVE_RESULT_BYTES,
    });
  }
  return result;
}

/**
 * Ce que le lien demande au noyau, et rien de plus. Tout est lu à l'APPEL,
 * jamais capturé à la construction : `isTTY` est posé par le Kernel (et parfois
 * par un test), `projectName` et `environment` par le boot, `typeCluster` par
 * la famille CLUSTER. `Kernel` satisfait cette forme structurellement.
 */
export interface ISupervisorHost {
  /** Mode moteur courant — la bannière ne se prépare qu'en `development`. */
  readonly environment: EnvironmentType;
  /** Verdict terminal du noyau — page propre et rendu `human` en dépendent. */
  readonly isTTY: boolean;
  /** Nom du projet, affiché dans la bannière. */
  readonly projectName: string;
  /** Rôle dans la topologie (`master`/`worker`), affiché dans la bannière. */
  readonly typeCluster: ClusterType;
  /** CLI attachée (vérité suffisante : la bannière n'a de sens que sous une CLI). */
  readonly cli: object | null;
}

/**
 * Le lien noyau ⇄ superviseur de développement, et l'écran de démarrage.
 *
 * Verrouillé par `tests/supervisorLink.test.ts`.
 */
export class SupervisorLink {
  /**
   * Lancé par le superviseur de développement — CONSTATÉ une fois, à la
   * construction, sur `DEV_CHILD_ENV`. Vérité unique : qui dessine
   * l'écran et ce qui part sur le canal se décident sur cette valeur.
   */
  readonly supervised: boolean;
  /**
   * Supprime les bannières serveurs « Server Listen on… » (`showBanner`) — posé
   * par le `BootReporter` animé (dev TTY non-debug) : le bloc « ✓ Prêt » liste
   * déjà les URLs, ces logs feraient doublon. Reste `false` en prod/CI/`--debug`
   * → bannières affichées (aucun changement hors écran de boot animé).
   */
  suppressBootBanners = false;
  /**
   * En dev, `BootReporter` (checklist animée) prend la main sur l'en-tête de
   * boot (splash + banner `SERVER`). Quand `true`, l'entrée dans le cluster ne
   * ré-imprime PAS le banner `logEnv()` (le reporter le place lui-même, dans le
   * bon ordre). Dev-only, boot-only — 0 impact runtime/requête.
   */
  reporterOwnsHeader = false;
  /**
   * En dev, le bandeau de démarrage est DIFFÉRÉ : une page propre suivra, et
   * c'est elle qui le pose (BootReporter). Imprimé ici ET là, il apparaissait
   * deux fois dans l'historique du terminal. Le BootReporter le pose une seule
   * fois — en haut de la page « prêt », ou au-dessus du bilan quand il n'y a
   * pas de page propre (échec, débogage) — puis remet ce drapeau à `false`.
   */
  devHeaderDeferred = false;

  private readonly host: ISupervisorHost;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly endpoint: IDevChannelEndpoint;
  /** Les clients de services portés, par propriétaire — alloué au premier. */
  #heldClients: Map<string, HeldServicesClient> | null = null;
  #heldOwnersReported = false;
  /** Le pair JSON-RPC de la voie en direct — posé par {@link serveCommands}. */
  #livePeer: ServerDevPeer | null = null;

  /**
   * @param host - le noyau, lu à chaque appel.
   * @param env - l'environnement lu par le RENDU (`NF_OUTPUT`, `APP_ENV`,
   *   `NF_ENV`, `NF_DEV_RELOAD`), injectable ; `process.env` par défaut.
   * @param endpoint - le processus porteur du canal IPC (injectable).
   */
  constructor(
    host: ISupervisorHost,
    env: Readonly<Record<string, string | undefined>> = process.env,
    endpoint: IDevChannelEndpoint = process,
  ) {
    this.host = host;
    this.env = env;
    this.endpoint = endpoint;
    // L'identité de qui a lancé CE processus se lit sur son VRAI environnement,
    // jamais sur un dictionnaire injecté — et en clair : c'est cette lecture que
    // le relevé `.ai/ENV.md` ancre (le nom, lui, est `DEV_CHILD_ENV`).
    this.supervised = process.env.NF_DEV_CHILD === "1";
  }

  /**
   * UNIQUE sortie vers le superviseur. Sans superviseur, rien ne part — ni
   * sous `--no-watch`, ni vers un parent étranger qui aurait ouvert un canal.
   *
   * @param message - le message, membre de {@link DevChannelMessage}.
   * @returns `true` s'il est parti.
   */
  send(message: DevChannelMessage): boolean {
    if (!this.supervised) return false;
    return sendToSupervisor(message, this.endpoint);
  }

  /**
   * UNIQUE entrée depuis le superviseur : seuls les messages du canal, de type
   * connu et bien formés, atteignent `handler`. Sans superviseur, rien n'est
   * attaché et la désinscription rendue ne fait rien.
   *
   * @param handler - appelé pour chaque message valide du canal.
   * @returns la désinscription.
   */
  listen(handler: (message: DevChannelMessage) => void): () => void {
    if (!this.supervised) return noop;
    return listenToSupervisor(handler, this.endpoint);
  }

  /**
   * Ouvre la voie en direct de l'invite (ADR-0013 §6) : un pair JSON-RPC sur
   * le canal, l'action `command.execute` servie par `execute`, puis la
   * notification `dev.ready` — le superviseur sait alors qu'il peut demander.
   * Appelé par le Kernel APRÈS `onPostReady` : une commande lue en direct
   * voit un noyau démarré.
   *
   * Sans crochet `beforeDispatch` : le canal n'est hérité que par l'enfant que
   * le superviseur a lancé, et {@link supervised} ferme la porte à un parent
   * étranger. Sans superviseur, sans canal, ou déjà ouverte : rien n'est posé.
   *
   * @param execute - ce qui sert une commande.
   * @param onError - reçoit l'erreur d'un producteur qui lève (le pair répond
   *   alors `-32603`, sans détail).
   * @returns la fermeture : écoute retirée, appels en cours abandonnés.
   */
  serveCommands(
    execute: LiveCommandExecutor,
    onError: (context: string, err: unknown) => void,
  ): () => void {
    if (!this.supervised || this.#livePeer !== null) return noop;
    const endpoint = this.endpoint;
    if (!hasSupervisorChannel(endpoint)) return noop;
    const peer: ServerDevPeer = new JsonRpcPeer({
      send: (frame) => sendRpcToSupervisor(frame, endpoint),
      onError,
    });
    peer.registerCall("command.execute", (params, call) =>
      serveLiveCommand(params, call, execute),
    );
    const unlisten = this.listen((message) => {
      if (message.type === "rpc") peer.receive(message.frame);
    });
    this.#livePeer = peer;
    peer.notify(DEV_READY);
    return () => {
      if (this.#livePeer !== peer) return;
      this.#livePeer = null;
      unlisten();
      peer.dispose("server stopping");
    };
  }

  /**
   * Arrête `target` quand le superviseur disparaît, même tué net : sans
   * superviseur pour le relancer ni pour lire sa sortie, un serveur qui
   * survivrait garderait ses ports pour personne (`terminateOnSupervisorLoss`).
   * Hors superviseur, ou sans canal IPC, rien n'est posé.
   *
   * @param target - ce qui s'arrête ; le noyau.
   * @returns `true` si l'écouteur est posé.
   */
  stopOnSupervisorLoss(target: ISupervisorLossTarget): boolean {
    if (!this.supervised) return false;
    return terminateOnSupervisorLoss(target, this.endpoint);
  }

  /**
   * Le client des services PORTÉS par le superviseur pour `owner`
   * (ADR-0030) — ou `null` sans superviseur : le module tient alors ses
   * services lui-même (`--no-watch`, `start`, production). C'est LE verdict
   * « mode porté », rendu ici une fois.
   *
   * L'appel vaut déclaration : `owner` figurera dans la liste que
   * {@link reportHeldOwners} envoie juste avant `onPostReady`, et ses
   * services survivront au balayage. Appelé APRÈS ce moment, le propriétaire
   * a déjà été balayé — ses services seront relancés par son plan.
   *
   * @param owner - le propriétaire (`frontend`, `ai`).
   * @returns le client, le même à chaque appel pour un propriétaire donné.
   */
  heldServices(owner: string): IHeldServicesClient | null {
    // Le canal, pas la seule variable : héritée sans canal, elle ferait choisir
    // le mode porté — le plan échouerait, et aucun Vite ne démarrerait, sans
    // repli sur le mode tenu par le serveur.
    if (!this.supervised || !hasSupervisorChannel(this.endpoint)) return null;
    this.#heldClients ??= new Map();
    let client = this.#heldClients.get(owner);
    if (client === undefined) {
      client = new HeldServicesClient(owner, this);
      this.#heldClients.set(owner, client);
    }
    return client;
  }

  /**
   * Envoie au superviseur, UNE fois par démarrage, la liste des propriétaires
   * qui ont déclaré des services portés ({@link heldServices}) — vide
   * comprise. Le superviseur arrête les services de tout autre propriétaire :
   * un module retiré de la configuration n'envoie plus de plan, et ses hôtes
   * vivraient sinon toute la session. Appelé par le Kernel juste avant
   * `onPostReady`. Sans superviseur, rien ne part.
   */
  reportHeldOwners(): void {
    if (!this.supervised || this.#heldOwnersReported) return;
    this.#heldOwnersReported = true;
    this.send({
      channel: DEV_CHANNEL,
      type: "held-owners",
      owners: this.#heldClients === null ? [] : [...this.#heldClients.keys()],
    });
  }

  /**
   * Le rendu du démarrage demandé (`--output`, `NF_OUTPUT`, sinon la capacité
   * du terminal) — lu ici pour le splash, qui part avant tout hook de commande.
   * Une valeur invalide rend `human` : c'est la commande `development` qui la
   * refuse, en la nommant ; le splash n'a pas à mourir pour elle.
   *
   * @returns le rendu.
   */
  startupOutputMode(): StartupOutputMode {
    try {
      return resolveOutputMode(
        readOutputFlag(process.argv),
        this.env,
        this.host.isTTY,
      );
    } catch {
      return "human";
    }
  }

  /**
   * Version de Nodefony — celle du paquet `nodefony` qui tourne, jamais celle
   * de l'application. La version portée par la ligne de commande ne convient
   * pas : au chargement de l'application, `setCommandVersion` la remplace par
   * celle de l'APP (le bandeau du bilan affichait « Nodefony 0.1.0 » pour une
   * application en 0.1.0).
   *
   * @returns la version du framework.
   */
  frameworkVersion(): string {
    return Nodefony.version;
  }

  /**
   * La bannière de développement (logo, version, environnement, Node, mode),
   * rendue pour la largeur ACTUELLE du terminal — le `BootReporter` la repose
   * en haut de l'écran, et la redessine quand la fenêtre change de taille.
   * Rendue par `renderBrand` (précalculée, sans figlet) ; couleurs gatées
   * comme les journaux (logColor).
   *
   * @returns la bannière, retours chariot compris.
   */
  devHeader(): string {
    const host = this.host;
    const version = this.frameworkVersion();
    // Axe DÉPLOIEMENT (APP_ENV / NF_ENV) affiché seulement s'il DIFFÈRE du
    // mode runtime — sinon redondant. Lu DIRECTEMENT depuis l'env (ambient) car le
    // header s'imprime avant que `setEnv` n'ait résolu `appEnvironment`. Cf deux axes.
    const appEnv = this.env.APP_ENV || this.env.NF_ENV;
    const env =
      appEnv && appEnv !== host.environment
        ? `${host.environment} · ${appEnv}`
        : host.environment;
    const rows = [
      { label: "app", value: `${host.projectName} · ${env}` },
      {
        label: "node",
        value: `${process.version} · ${process.platform} · pid ${process.pid}`,
      },
      // Rappel du volet TTY (découvrabilité) : interactif possible SSI interactive && tty.
      {
        label: "mode",
        value: [host.typeCluster, host.isTTY ? "tty" : "sans tty"]
          .filter(Boolean)
          .join(" · "),
      },
    ];
    return renderBrand({
      ...(version ? { version } : {}),
      rows,
      columns: terminalSize().columns || 80,
      color: isLogColorEnabled(),
      charset: resolveBrandCharset(process.platform, this.env),
    });
  }

  /** Imprime la bannière de développement ({@link devHeader}) en tête du boot. */
  printDevHeader(): void {
    process.stdout.write(this.devHeader());
  }

  /**
   * Prépare l'écran de démarrage, en TÊTE du boot (avant `SERVICE ADD`,
   * `MODULE ADD` et les events kernel) — l'ancien bloc « splash » de
   * `Kernel.startBoot`.
   *
   * Gaté pour rester un confort de DEV interactif uniquement :
   * - **PRODUCTION / CLUSTER** → JAMAIS de splash. Cloud-native = logs structurés
   *   (collecteur JSON) : un art ASCII multi-ligne est du bruit ; en cluster, N
   *   workers produiraient N splash. L'info de boot vit dans les logs
   *   (`MODULE ADD`, `Server Listen`).
   * - **DEV** → un SEUL splash, dans le process qui boote réellement le serveur
   *   (l'enfant du DevSupervisor, {@link supervised}), PAS le superviseur parent
   *   CONSOLE (sinon double splash : parent + enfant — cf 2 ASCII art observés).
   * - Ni en rendu machine (`plain`/`json`). Dans un terminal, hors --debug :
   *   page propre au PREMIER démarrage (l'historique du terminal reste intact) ;
   *   un rechargement n'écrit que ce qui a changé.
   *
   * Pose aussi {@link reporterOwnsHeader} : l'identité (version, environnement)
   * est portée par le bilan du BootReporter dans TOUS ses rendus, l'entrée dans
   * le cluster ne ré-imprime donc pas `logEnv` — ni sous le splash, ni sans lui
   * (rechargement, plain, json).
   */
  prepareDevScreen(): void {
    const host = this.host;
    const devChild = host.environment === "development" && this.supervised;
    const devSplash = devChild && this.startupOutputMode() === "human";
    // Un RECHARGEMENT ne repose ni page ni bandeau : la barre d'état porte
    // l'identité, et l'historique doit garder ce qui s'est passé. Le
    // BootReporter n'y écrit que ce qui a changé.
    if (host.cli && devSplash && reloadCount(this.env) === 0) {
      if (host.isTTY && !isDebugRequested(process.argv)) {
        // Page propre à venir : le bandeau attend le BootReporter, qui le
        // pose UNE fois — l'imprimer aussi ici le doublait dans l'historique.
        process.stdout.write(CLEAR_SCREEN);
        this.devHeaderDeferred = true;
      } else {
        // Sans page propre (débogage, hors terminal) : bannière AVANT tout
        // log de boot, ordre stable. Précalculée : plus de figlet au démarrage.
        this.printDevHeader();
      }
    }
    if (host.cli && devChild) this.reporterOwnsHeader = true;
  }
}
