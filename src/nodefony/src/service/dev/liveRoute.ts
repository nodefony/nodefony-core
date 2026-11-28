/**
 * La voie EN DIRECT des commandes de l'invite, côté superviseur (ADR-0013 §6,
 * amendement #538 lot 3) : une commande tapée part d'abord vers le serveur
 * vivant (`command.execute`), et ne retombe en sous-processus que si le
 * serveur répond « pas en direct », ne répond pas, ou n'est pas là.
 *
 * Le superviseur ne fait qu'y BRANCHER ses faits — un pair par enfant
 * ({@link LiveCommandRoute.connect}), le crash ({@link LiveCommandRoute.crashed})
 * — et envelopper son lanceur ({@link LiveCommandRoute.launcher}) : la règle
 * de repli par phase vit ici, à un seul endroit.
 */
import { RpcError, RpcTimeoutError } from "../../realtime/JsonRpcPeer";
import { redactSecrets } from "../../runtime/redact";
import {
  isCommandExecuteParams,
  LIVE_COMMAND_TIMEOUT_MS,
  LIVE_RESULT_TOO_LARGE,
} from "./devChannel";
import type { IPromptIO, PromptCommandLauncher } from "./promptAction";
import { PROMPT_INTERRUPTED_CODE } from "./promptLaunch";
import { ServerPeer, type IServerPeerChild } from "./serverPeer";

/**
 * Attente maximale de `dev.ready` quand une commande arrive pendant un
 * démarrage ou un rechargement ; passé ce délai, le sous-processus.
 */
export const LIVE_READY_WAIT_MS = 10_000;

/** Code rendu quand la réponse en direct est refusée pour sa taille. */
const LIVE_REFUSED_CODE = 1;

/**
 * Route les commandes de l'invite vers le serveur vivant, et décide du repli.
 *
 * | État du serveur              | Voie                                                  |
 * | ---------------------------- | ----------------------------------------------------- |
 * | démarrage, rechargement      | attente de `dev.ready` (10 s, Ctrl+C) puis direct     |
 * | prêt                         | direct ; `live: false` → sous-processus               |
 * | meurt pendant la requête     | sous-processus (une lecture se rejoue sans risque)    |
 * | `crashed`                    | sous-processus, sans attendre                         |
 * | délai de 5 s expiré          | dit « pas de réponse », puis sous-processus           |
 * | réponse trop grande          | refus qui nomme la ligne à taper ; jamais amputée     |
 *
 * Verrouillé par `tests/devLiveRoute.test.ts`.
 */
export class LiveCommandRoute {
  #peer: ServerPeer | null = null;
  #crashed = false;
  /** Les commandes qui attendent `dev.ready` — alloué à la première. */
  #waiters: Set<() => void> | null = null;

  /**
   * Ouvre le pair d'un serveur enfant qui vient d'être lancé : il devient le
   * seul à qui l'on parle, et lève l'état « crashed ».
   *
   * @param child - le processus serveur.
   * @param onError - erreur interne du pair (journal du superviseur).
   * @returns le pair, auquel l'aiguillage remet les trames `rpc`.
   */
  connect(
    child: IServerPeerChild,
    onError: (context: string, err: unknown) => void,
  ): ServerPeer {
    const peer = new ServerPeer(child, onError, () => {
      if (this.#peer === peer) this.#wake();
    });
    this.#peer = peer;
    this.#crashed = false;
    return peer;
  }

  /** Le serveur est tombé : plus personne n'attend `dev.ready`, tout part en sous-processus. */
  crashed(): void {
    this.#crashed = true;
    this.#wake();
  }

  /**
   * Enveloppe le lanceur en sous-processus : la voie en direct d'abord.
   *
   * @param fallback - le lanceur en sous-processus (le repli universel).
   * @returns le lanceur que reçoit l'action `/nodefony` de l'invite.
   */
  launcher(fallback: PromptCommandLauncher): PromptCommandLauncher {
    return async (argv, io, signal) => {
      const code = await this.#tryLive(argv, io, signal);
      return code ?? fallback(argv, io, signal);
    };
  }

  /** @returns le code de la commande servie en direct, ou `null` : sous-processus. */
  async #tryLive(
    argv: readonly string[],
    io: IPromptIO,
    signal: AbortSignal,
  ): Promise<number | null> {
    const command = argv[0];
    if (command === undefined || this.#crashed) return null;
    const params = {
      command,
      arguments: argv.slice(1),
      columns: io.columns,
    };
    // Une saisie hors des bornes du canal part en sous-processus : le garde
    // du serveur la refuserait, autant ne pas l'émettre.
    if (!isCommandExecuteParams(params)) return null;
    if (this.#peer?.ready !== true) {
      io.write("attend que le serveur soit prêt…\n");
      await this.#awaitReady(signal);
      if (signal.aborted) return PROMPT_INTERRUPTED_CODE;
    }
    const peer = this.#peer;
    if (peer === null || !peer.ready) return null;
    try {
      const result = await peer.execute(params, signal);
      if (!result.live) return null;
      for (const part of result.parts) {
        if ("text" in part) io.write(part.text);
      }
      return result.code;
    } catch (err) {
      if (signal.aborted) return PROMPT_INTERRUPTED_CODE;
      return this.#onLiveError(err, argv, io);
    }
  }

  /** @returns le code d'un refus, ou `null` : la commande part en sous-processus. */
  #onLiveError(
    err: unknown,
    argv: readonly string[],
    io: IPromptIO,
  ): number | null {
    if (err instanceof RpcTimeoutError) {
      io.write(
        `le serveur n'a pas répondu en ${LIVE_COMMAND_TIMEOUT_MS / 1000} s — la commande part en sous-processus\n`,
        "err",
      );
      return null;
    }
    if (err instanceof RpcError && err.code === LIVE_RESULT_TOO_LARGE) {
      // Jamais une réponse amputée : la ligne entière, dans un autre terminal.
      io.write(
        `réponse trop grande pour l'invite — dans un autre terminal : npx nodefony ${redactSecrets(argv.join(" "))}\n`,
        "err",
      );
      return LIVE_REFUSED_CODE;
    }
    if (err instanceof RpcError) {
      io.write(
        `le serveur a refusé la commande (${err.message}) — elle part en sous-processus\n`,
        "err",
      );
    }
    // Serveur parti pendant la requête : le repli, sans un mot de plus — le
    // rechargement se lit déjà dans la barre.
    return null;
  }

  /** Attend que le pair courant soit prêt, au plus {@link LIVE_READY_WAIT_MS}. */
  #awaitReady(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = (this.#waiters ??= new Set());
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, LIVE_READY_WAIT_MS);
      signal.addEventListener("abort", done, { once: true });
      waiters.add(done);
    });
  }

  /** Réveille les commandes en attente (prêt, ou crash). */
  #wake(): void {
    const waiters = this.#waiters;
    if (waiters === null) return;
    this.#waiters = null;
    for (const done of waiters) done();
  }
}
