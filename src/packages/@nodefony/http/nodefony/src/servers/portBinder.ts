/**
 * **portBinder** — écoute sur le port désiré, ou sur le prochain port libre.
 *
 * Pourquoi ce fichier existe : lancer deux apps Nodefony côte à côte (le repo et
 * une app générée, deux projets, un banc et une démo…) faisait mourir la seconde
 * en `EADDRINUSE`. Le port désiré est une PRÉFÉRENCE en développement ; il reste
 * un CONTRAT en production.
 *
 * ## Pourquoi retenter au `listen()` plutôt que sonder d'abord
 *
 * La tentation est d'appeler « le port 5151 est-il libre ? » puis de binder. C'est
 * une **course** (TOCTOU) : entre la réponse et le bind, un autre process peut
 * prendre le port — et on échoue quand même, après avoir cru le contraire. Le
 * `listen()` est, lui, **atomique** : soit il réussit, soit le noyau dit
 * `EADDRINUSE`. On retente donc sur l'échec réel, jamais sur une prédiction.
 *
 * ## Pourquoi une SONDE malgré cela
 *
 * Le `listen()` est atomique, mais il ne dit pas tout : un port peut être **déjà
 * servi** et le noyau l'accorder quand même. Lier `0.0.0.0:P` alors qu'un autre
 * processus tient `127.0.0.1:P` **réussit** sur macOS et les BSD — ce sont deux
 * liaisons distinctes, et les connexions locales partent à la PLUS SPÉCIFIQUE.
 * Entre familles d'adresses (`::1` tenu, `0.0.0.0` demandé), même linux
 * l'accorde. L'application annonce alors `READY`, publie ses ports… et ne reçoit
 * rien : une panne muette, et un banc qui interroge le serveur du VOISIN.
 *
 * On constate donc, AVANT de binder, qu'aucun serveur ne répond déjà là où notre
 * liaison va recevoir (`isPortListening` — une connexion en boucle locale, aucun
 * outil système, même verdict sur les trois plateformes). Ce n'est pas la sonde
 * « ce port est-il libre ? » écartée plus haut : elle ne remplace pas le repli
 * atomique, qui reste le seul à trancher la course — elle ajoute le seul conflit
 * que le noyau n'exprime JAMAIS. La course résiduelle (un tiers prend le port
 * entre la sonde et le bind) retombe donc sur `EADDRINUSE`, inchangé.
 *
 * ## Pourquoi sauter les ports réservés
 *
 * HTTP veut 5151, HTTPS veut 5152. Si 5151 est pris, incrémenter naïvement ferait
 * voler 5152 à HTTPS — qui se décalerait à son tour, en cascade. Les ports que les
 * AUTRES serveurs convoitent sont donc sautés d'emblée.
 *
 * ## Fail-loud
 *
 * Un décalage est TOUJOURS annoncé (`onShift`) : une app qui écoute ailleurs que
 * là où on l'attend sans le dire est une dégradation silencieuse.
 */
import type { AddressInfo } from "node:net";
import { isPortListening } from "nodefony";

/** Serveur écoutable (surface minimale commune `http`/`https`/`http2`). */
export interface Listenable {
  listen(port: number, host?: string): unknown;
  address(): AddressInfo | string | null;
  once(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

/** Que faire si le port désiré est occupé. */
export type PortPolicy = "auto" | "strict";

/** Nombre de ports essayés après le désiré, en `auto`. */
export const DEFAULT_PORT_RETRY_ATTEMPTS = 20;

export interface BindPlan {
  /** Port voulu (config). `0` = le noyau choisit (aucun repli nécessaire). */
  desired: number;
  /** Ports convoités par les AUTRES serveurs — jamais volés. */
  reserved: readonly number[];
  /** Essais après le désiré. `0` ⇒ comportement strict. */
  attempts: number;
}

export interface BindResult {
  /** Adresse réellement obtenue (le port peut différer du désiré). */
  address: AddressInfo;
  /** Port désiré si l'écoute a dû être décalée, `null` si on l'a obtenu. */
  shiftedFrom: number | null;
}

/**
 * Politique de port effective.
 *
 * Le défaut dépend de l'environnement, et ce n'est pas de la coquetterie :
 * - **production** → `strict`. Le port y est un contrat (service k8s, ingress,
 *   sonde de santé). Un bind silencieux ailleurs donnerait un pod déclaré sain
 *   que personne n'atteint : une panne invisible, le pire des deux mondes.
 * - **test** → `strict`. Un port occupé veut dire « un serveur est resté debout » ;
 *   le banc doit s'arrêter, pas viser à côté (il taperait le serveur du voisin).
 * - **développement** → `auto`. Ici un port pris n'est qu'une nuisance.
 *
 * @param environment - `kernel.environment` (normalisé `development`/`production`/`test`).
 * @param explicit - `servers.portPolicy` s'il est configuré (il gagne toujours).
 */
export function resolvePortPolicy(
  environment: string | undefined,
  explicit?: PortPolicy,
): PortPolicy {
  if (explicit === "auto" || explicit === "strict") return explicit;
  return environment === "development" ? "auto" : "strict";
}

/** Forme lue de `kernel.options.servers` (lecture structurelle, pas d'import core). */
export interface ServersPortConfig {
  http?: { port?: number } | false;
  https?: { port?: number } | false;
  portPolicy?: PortPolicy;
  portRetryAttempts?: number;
}

/** Port configuré d'un serveur, ou `0` (désactivé / non précisé → choix noyau). */
function configuredPort(entry: { port?: number } | false | undefined): number {
  if (!entry) return 0;
  return entry.port ?? 0;
}

/**
 * Compose le plan de bind d'un serveur depuis la config du kernel — source UNIQUE
 * (les deux serveurs l'appellent ; la politique n'est décidée qu'ici).
 *
 * @param which - le serveur qu'on borne.
 * @param servers - `kernel.options.servers`.
 * @param environment - `kernel.environment` (arbitre le défaut de la politique).
 */
export function buildBindPlan(
  which: "http" | "https",
  servers: ServersPortConfig | undefined,
  environment: string | undefined,
): BindPlan {
  const desired = configuredPort(servers?.[which]);
  // L'AUTRE serveur convoite son port : ne jamais le lui prendre au passage.
  const other = configuredPort(servers?.[which === "http" ? "https" : "http"]);
  const policy = resolvePortPolicy(environment, servers?.portPolicy);
  return {
    desired,
    reserved: other > 0 && other !== desired ? [other] : [],
    attempts:
      policy === "auto"
        ? (servers?.portRetryAttempts ?? DEFAULT_PORT_RETRY_ATTEMPTS)
        : 0,
  };
}

/**
 * Sonde « un serveur répond-il déjà ici ? ».
 *
 * Injectable pour que le banc éprouve la DÉCISION sans dépendre d'un décor
 * réseau ; le défaut est `isPortListening`, exposé par le cœur pour ne pas être
 * recopié de paquet en paquet.
 */
export type PortListeningProbe = (
  port: number,
  host: string,
) => Promise<boolean>;

/** Adresses qui désignent « toutes les interfaces » — rien ne s'y connecte. */
const WILDCARD_HOSTS = new Set(["", "*", "0.0.0.0", "::", "[::]"]);

/** Adresses de la boucle locale, toutes familles — c'est aussi ce qu'on REND. */
const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "::1"];

/** Les mêmes, plus le nom qui les désigne — DÉRIVÉ, jamais recopié. */
const LOOPBACK_ALIASES = new Set([...LOOPBACK_HOSTS, "localhost"]);

/**
 * Adresses à interroger pour savoir si notre future liaison chevauche déjà un
 * serveur vivant.
 *
 * La règle est celle du TRAFIC, pas celle du noyau : on sonde ce que notre
 * liaison va RECEVOIR.
 * - Écouter sur **toutes les interfaces** recouvre la boucle locale : on sonde
 *   ses deux adresses (`127.0.0.1` et `::1`). Un wildcard n'est pas une
 *   destination, on ne peut pas s'y connecter.
 * - Écouter sur la **boucle locale** (`localhost` résout `::1` ici, `127.0.0.1`
 *   ailleurs — et les clients ne choisissent pas) : les deux, là encore.
 * - Écouter sur une **adresse d'interface précise** : elle seule. Une connexion
 *   vers elle atteint le tiers qu'il ait lié cette adresse ou le wildcard, donc
 *   une cible suffit — et sonder la boucle locale ferait refuser un pod à cause
 *   d'un voisin de conteneur qui n'a jamais été en conflit.
 *
 * Fonction PURE : le banc l'éprouve sans ouvrir un socket.
 *
 * @param host - hôte passé à `listen` (`kernel.domain`).
 * @returns les adresses à interroger, dans l'ordre.
 */
export function conflictProbeTargets(
  host: string | undefined,
): readonly string[] {
  const value = (host ?? "").trim().toLowerCase();
  if (WILDCARD_HOSTS.has(value) || LOOPBACK_ALIASES.has(value)) {
    return LOOPBACK_HOSTS;
  }
  return [value];
}

/**
 * Première adresse où un serveur répond DÉJÀ sur ce port, `null` si la voie est
 * libre.
 *
 * @param port - port candidat.
 * @param host - hôte que `listen` recevra (décide des adresses interrogées).
 * @param probe - sonde de présence (injectée par le banc).
 */
export async function detectPortConflict(
  port: number,
  host: string | undefined,
  probe: PortListeningProbe,
): Promise<string | null> {
  for (const target of conflictProbeTargets(host)) {
    if (await probe(port, target)) return target;
  }
  return null;
}

/**
 * Erreur d'un conflit que le noyau aurait laissé passer.
 *
 * Porte `EADDRINUSE` : pour l'appelant c'est le même fait — le port n'est pas
 * prenable — et une seule branche le traite. Le message, lui, doit dire ce que
 * le code d'erreur seul ferait chercher au mauvais endroit : ici `listen` aurait
 * RÉUSSI, et c'est la liaison d'une AUTRE adresse qui capte le trafic.
 */
function portConflictError(
  port: number,
  host: string,
): Error & { code: string } {
  const error = new Error(
    `Port ${port} déjà servi par un autre processus sur ${host} — le noyau ` +
      `l'aurait pourtant accordé (deux adresses distinctes coexistent sur le ` +
      `même port), et cette application aurait écouté sans rien recevoir. ` +
      `Libérer le port (nodefony status · nodefony stop), en figer un autre ` +
      `(servers.http.port / servers.https.port), ou autoriser le repli ` +
      `(servers.portPolicy = "auto", défaut en développement).`,
  ) as Error & { code: string };
  error.code = "EADDRINUSE";
  return error;
}

/** Prochain candidat : incrémente, en sautant ce que les autres serveurs veulent. */
function nextCandidate(from: number, reserved: readonly number[]): number {
  let port = from + 1;
  while (reserved.includes(port)) port += 1;
  return port;
}

/**
 * Vrai si ce code d'erreur signifie « ce port-ci n'est pas prenable ».
 *
 * `EADDRINUSE` est le cas de tous les systèmes. Windows en ajoute un second, et
 * il n'est pas anecdotique : Hyper-V, WSL et WinNAT **réservent des plages
 * entières** de ports éphémères (`netsh interface ipv4 show excludedportrange`),
 * qu'un `listen` refuse en **`EACCES`** — pas en `EADDRINUSE`. Une application
 * qui glisse de port en port finit statistiquement dans l'une de ces plages et
 * meurt là où linux et macOS auraient continué. C'est le PRODUIT que l'utilisateur
 * Windows subit, pas une singularité de banc.
 *
 * La borne est le port privilégié : sous 1024, `EACCES` veut dire « pas les
 * droits », et se replier en silence sur 81 quand l'exploitant demande 80 serait
 * une dégradation muette — exactement ce que ce fichier refuse.
 *
 * @param code - code d'erreur rendu par `listen`.
 * @param port - le port qui vient d'être refusé.
 * @returns `true` s'il faut essayer le port suivant plutôt qu'échouer.
 */
function isPortUnavailable(code: string | undefined, port: number): boolean {
  if (code === "EADDRINUSE") return true;
  return code === "EACCES" && port >= 1024;
}

/**
 * Écoute sur `plan.desired`, ou sur le prochain port libre si `attempts > 0`.
 *
 * Aucun `error` permanent ne doit être attaché au serveur pendant l'appel : cette
 * fonction pose ses propres écouteurs le temps du bind et les retire toujours (le
 * handler d'erreur durable s'installe APRÈS, sur le serveur qui écoute — sinon il
 * verrait passer les `EADDRINUSE` de repli et croirait à une panne).
 *
 * @returns l'adresse obtenue + le port désiré si un décalage a eu lieu.
 * @throws l'erreur de `listen` : soit un code qui ne dit pas « ce port est pris »
 *   (`ENOTFOUND`, `EACCES` sous 1024 — cf `isPortUnavailable`), soit un port
 *   indisponible après épuisement des essais (le fallback n'est PAS infini).
 */
export async function bindWithFallback(
  server: Listenable,
  host: string,
  plan: BindPlan,
  probe: PortListeningProbe = isPortListening,
): Promise<BindResult> {
  let candidate = plan.desired;
  let used = 0;

  /**
   * Une tentative d'écoute. L'erreur est RENDUE, jamais levée depuis le
   * callback : les deux écouteurs se retirent dans les deux cas, et la boucle
   * ci-dessous reste le seul endroit qui décide.
   */
  const listenOnce = (port: number): Promise<NodeJS.ErrnoException | null> =>
    new Promise((settle) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener("listening", onListening as never);
        settle(error);
      };
      const onListening = (): void => {
        server.removeListener("error", onError as never);
        settle(null);
      };
      server.once("error", onError as never);
      server.once("listening", onListening as never);
      server.listen(port, host);
    });

  for (;;) {
    // Le conflit que le noyau n'exprime JAMAIS (cf en-tête) : constaté avant le
    // bind, puis traité comme un `EADDRINUSE`. Rien à constater sur le port 0,
    // où aucune adresse n'est revendiquée.
    const conflict =
      plan.desired === 0
        ? null
        : await detectPortConflict(candidate, host, probe);
    const failure: (Error & { code?: string }) | null = conflict
      ? portConflictError(candidate, conflict)
      : await listenOnce(candidate);

    if (failure === null) {
      return {
        address: server.address() as AddressInfo,
        shiftedFrom: candidate === plan.desired ? null : plan.desired,
      };
    }
    // Un code qui ne dit pas « ce port-ci est pris » n'est pas rattrapable ; le
    // conflit sondé, lui, l'est par construction.
    if (!conflict && !isPortUnavailable(failure.code, candidate)) throw failure;
    // Port 0 = le noyau alloue : il ne peut pas être « déjà pris ».
    if (plan.desired === 0 || used >= plan.attempts) throw failure;
    used += 1;
    candidate = nextCandidate(candidate, plan.reserved);
  }
}
