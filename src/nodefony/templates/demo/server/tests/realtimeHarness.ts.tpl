import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import * as nodefonyCbor from "nodefony/cbor";
import { NodefonySocket, type IRealtimeContract } from "nodefony/client";
import {
  E2E_ADMIN_PASSWORD,
  startSpareApp,
  type ISpareApp,
} from "nodefony/testing";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** La base de la suite e2e de l'application (`tests/e2e.setup.ts`). */
    e2eDatabaseUrl: string | null;
  }
}

/**
 * Le décor des tests de bout en bout de la démo : un serveur RÉEL, et les
 * sockets de la page (`nodefony/client`) branchées dessus.
 *
 * Guide pour un agent :
 * - La démo est un module `policy: "dev"` : la production la retire, et le
 *   serveur que `tests/e2e.setup.ts` démarre pour l'application est un serveur
 *   de production. Chaque fichier démarre donc SON exemplaire, en
 *   développement (`startDemoServer` en `beforeAll`, `stop` en `afterAll`).
 * - Les ports sont pris LIBRES, HTTPS compris : jamais 5151/5152, ceux d'un
 *   `nodefony development` déjà ouvert sur le poste. La base est celle du
 *   décor e2e (un SQLite JETABLE, ou la base `<base>_e2e` d'un moteur
 *   serveur) : la base de développement de l'application n'est jamais
 *   touchée, et le compte `admin` y naît avec le mot de passe du décor e2e.
 * - Un test ouvre ses sockets par `openSocket`, attend ce qu'il veut voir par
 *   `waitFor` — jamais par une pause fixe —, et referme tout par `closeAll`.
 */

let server: ISpareApp | null = null;

/** Un port TCP libre, demandé au système. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === "object") {
          resolve(address.port);
        } else reject(new Error("aucun port libre rendu par le système"));
      });
    });
  });
}

/**
 * Démarre l'exemplaire de développement qui sert la démo.
 *
 * @returns l'arrêt, à appeler en `afterAll`
 */
export async function startDemoServer(): Promise<() => Promise<void>> {
  const [port, httpsPort] = [await freePort(), await freePort()];
  // La base est celle que `tests/e2e.setup.ts` a CHOISIE et remise à neuf,
  // transmise par `provide` — jamais une copie de sa règle. Un moteur
  // serveur : la même base `<base>_e2e` (une entité écrite pour un dialecte
  // refuse de démarrer sur un autre). SQLite, ou rien de transmis : un fichier
  // JETABLE par fichier de test. Les fichiers se suivent
  // (`fileParallelism: false`) : un seul exemplaire de développement à la fois
  // écrit dans une base partagée.
  const shared = inject("e2eDatabaseUrl") ?? null;
  let dir: string | null = null;
  let database: string;
  if (shared !== null && !shared.startsWith("sqlite:")) {
    database = shared;
  } else {
    dir = mkdtempSync(path.join(tmpdir(), "nf-demo-e2e-"));
    database = `sqlite:${path.join(dir, "demo.db")}`;
  }
  const cleanup = () => {
    if (dir !== null) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  };
  const spare = await startSpareApp({
    command: "development",
    port,
    httpsPort,
    timeoutMs: 120_000,
    env: {
      NF_DATABASE_URL: database,
      NF_ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
    },
  }).catch((error: unknown) => {
    cleanup();
    throw error;
  });
  server = spare;
  return async () => {
    server = null;
    await spare.stop();
    cleanup();
  };
}

/** L'adresse `http://` d'un chemin, sur l'exemplaire démarré. */
export function httpUrl(pathname: string): string {
  if (server === null) throw new Error("startDemoServer() d'abord");
  return `http://127.0.0.1:${server.port}${pathname}`;
}

/** L'adresse `ws://` d'un chemin, sur l'exemplaire démarré. */
export function socketUrl(pathname: string): string {
  return httpUrl(pathname).replace(/^http/u, "ws");
}

/** Une socket ouverte par ce décor, typée par le contrat de sa démo. */
export type ContractSocket<C extends IRealtimeContract> = ReturnType<
  typeof NodefonySocket.fromContract<C>
>;

const opened = new Set<{ disconnect(): void }>();

/**
 * Ouvre une socket NEUVE (jamais la partagée : deux joueurs sont deux
 * clients) et attend qu'elle soit connectée. La page passe une adresse
 * relative ; Node n'a pas de page, l'adresse est donc absolue.
 *
 * @param pathname - le chemin de la socket, celui que la page emploie
 * @param options - `cbor: false` pour une socket texte
 */
export async function openSocket<C extends IRealtimeContract>(
  pathname: string,
  options: { cbor?: boolean } = {},
): Promise<ContractSocket<C>> {
  const socket = NodefonySocket.fromContract<C>({
    url: socketUrl(pathname),
    // Un test qui perd sa socket doit ÉCHOUER, pas se reconnecter en silence.
    autoReconnect: false,
    ...(options.cbor === false ? {} : { codec: nodefonyCbor.CBOR_FRAME_CODEC }),
  });
  opened.add(socket);
  await socket.connect();
  return socket;
}

/** Referme toutes les sockets ouvertes par ce décor. */
export function closeAll(): void {
  for (const socket of opened) socket.disconnect();
  opened.clear();
}

/**
 * Attend qu'une condition devienne vraie, en la relisant toutes les 25 ms.
 *
 * @throws Error — avec `what` — si elle ne l'est pas avant `timeoutMs`
 */
export async function waitFor(
  what: string,
  condition: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`délai dépassé (${timeoutMs} ms) : ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
