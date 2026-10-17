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
 * dès qu'un membre de l'union n'y est pas traité. Le verdict « lancé par le
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
  listenToSupervisor,
  sendToSupervisor,
  type DevChannelMessage,
  type IDevChannelEndpoint,
} from "../service/dev/devChannel";
import type { EnvironmentType } from "../types/globals";
import type { ClusterType } from "./kernelCluster";

/** Désinscription vide, partagée : rien n'a été attaché, rien à retirer. */
const noop = (): void => {};

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
