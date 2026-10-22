import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { JsonRpcError, jsonRpcFailure } from "./protocol";
import type { IMcpGate, IMcpGateRuntime } from "./gate";
import type { IMcpEventSink } from "./stream";

/**
 * Le transport stdio de MCP : le client lance le serveur et lui parle par
 * l'entrée et la sortie standard, un message JSON-RPC par ligne.
 *
 * Toute la règle vit dans la porte ({@link IMcpGate.respondStdio}) : ce
 * fichier n'apporte que la lecture ligne à ligne et l'écriture des réponses.
 */

/** Ce que sert une boucle stdio. */
export interface IMcpStdioOptions {
  /** L'entrée du protocole — `process.stdin` en pratique. */
  input: Readable;
  /**
   * Écrit UNE ligne sur la sortie du protocole, saut de ligne compris. La
   * sortie standard EST le protocole : rien d'autre ne doit y écrire.
   */
  write: (line: string) => void;
  /** Modules, identité, journal — transmis à la porte. */
  runtime?: IMcpGateRuntime | undefined;
}

/** Un puits stdio : chaque envoi devient une ligne, dans l'ordre d'appel. */
function lineSink(write: (line: string) => void): IMcpEventSink {
  return {
    closed: false,
    send(data) {
      write(JSON.stringify(data));
      return undefined;
    },
  };
}

/**
 * Sert une porte MCP sur un flux de lignes, jusqu'à la fin de l'entrée.
 *
 * Chaque ligne est servie SANS attendre la précédente : une
 * `notifications/cancelled` doit pouvoir arriver pendant l'appel qu'elle
 * vise. Les réponses partent donc dans l'ordre où elles se terminent — chacune
 * porte son identifiant, c'est ce que JSON-RPC prévoit. Une ligne vide est
 * ignorée ; une ligne illisible rend `-32700` sans arrêter la boucle.
 *
 * L'entrée fermée, le client est parti : les appels encore en cours sont
 * abattus (leur signal), puis la promesse se résout quand tous ont rendu.
 *
 * @param gate - la porte à servir.
 * @param options - entrée, écriture d'une ligne, environnement de la porte.
 * @returns une promesse résolue à la fin de l'entrée, appels en cours clos.
 */
export function serveMcpStdio(
  gate: IMcpGate,
  options: IMcpStdioOptions,
): Promise<void> {
  const { input, runtime } = options;
  const write = (text: string): void => options.write(`${text}\n`);
  const departure = new AbortController();
  const pending = new Set<Promise<void>>();

  const serve = async (line: string): Promise<void> => {
    try {
      const response = await gate.respondStdio(
        {
          line,
          signal: departure.signal,
          openStream: () => lineSink(write),
        },
        runtime,
      );
      // `stream` : le puits a déjà reçu la réponse finale. `empty` : une
      // notification, à laquelle rien ne se répond.
      if (response.kind === "json") write(JSON.stringify(response.body));
    } catch (error) {
      // La porte ne lève que sur un défaut du framework : l'agent reçoit un
      // message générique, le détail part au journal.
      runtime?.log?.(
        `MCP stdio — message non servi : ${
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        }`,
        "ERROR",
      );
      write(
        JSON.stringify(
          jsonRpcFailure(null, JsonRpcError.INTERNAL_ERROR, "erreur interne"),
        ),
      );
    }
  };

  return new Promise<void>((resolve) => {
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (line.trim() === "") return;
      const task = serve(line);
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
    lines.once("close", () => {
      departure.abort();
      void Promise.allSettled(pending).then(() => resolve());
    });
  });
}
