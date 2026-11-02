/**
 * Le contrat de Studio tient ses deux bouts — vérifié par le COMPILATEUR (gate
 * `npm run typecheck`, qui inclut ce fichier) : la socket de la page lit la santé
 * et les réponses RPC par `StudioContract`, et le contrôleur ne compile que s'il
 * sert chaque méthode déclarée (`ContractRealtimeController` strict).
 *
 * Les fonctions ci-dessous ne s'exécutent jamais : seules leurs signatures sont
 * jugées. Le `it` d'exécution garde le fichier dans la suite vitest.
 */
import { describe, expect, it } from "vitest";
import { PLATFORM_CHANNELS, PLATFORM_METHODS } from "nodefony";
import type { RealtimeHealthReport } from "nodefony";
import type { KernelPingResult } from "nodefony/client";
import { useNodefonyChannelData } from "nodefony/react";
import type {
  StudioContract,
  StudioSocket,
} from "../../../frontend/src/realtime/studioContract";
import type { IScaffoldJobState } from "../../../frontend/src/routes/create/createModel";
import type { ContractRealtimeMethodHandlers } from "@nodefony/realtime";

/** Côté navigateur : ce que la socket typée rend. */
export function clientSide(socket: StudioSocket): void {
  // La santé se lit par le contrat, sans générique ni conversion.
  const health: RealtimeHealthReport | null = useNodefonyChannelData(
    socket,
    PLATFORM_CHANNELS.socket,
  );
  void health;

  // Chaque méthode rend la forme que le serveur s'est engagé à servir.
  const ping: Promise<{ pong: true; pid: number }> = socket.request(
    PLATFORM_METHODS.ping,
  );
  const job: Promise<{ id: string; status: IScaffoldJobState["status"] }> =
    socket.request(PLATFORM_METHODS.scaffoldRun, { type: "module" });
  const cancel: Promise<{ cancelled: boolean }> = socket.request(
    PLATFORM_METHODS.scaffoldCancel,
    { id: "x" },
  );
  void ping;
  void job;
  void cancel;

  // @ts-expect-error PARAMÈTRES FAUX : `cancel` exige l'identifiant du job
  void socket.request(PLATFORM_METHODS.scaffoldCancel, { job: "x" });
}

/** Côté serveur : la table d'actions est exigée COMPLÈTE par le contrat. */
export function serverSide(ping: () => KernelPingResult): void {
  // @ts-expect-error ACTION MANQUANTE : la table doit servir les six méthodes
  const partial: ContractRealtimeMethodHandlers<StudioContract> = {
    [PLATFORM_METHODS.ping]: ping,
  };
  void partial;
}

describe("StudioContract", () => {
  it("nomme les six méthodes de plateforme que le contrôleur sert", () => {
    const declared: Record<keyof StudioContract["serverMethods"], true> = {
      [PLATFORM_METHODS.ping]: true,
      [PLATFORM_METHODS.gc]: true,
      [PLATFORM_METHODS.scaffoldPreview]: true,
      [PLATFORM_METHODS.scaffoldRun]: true,
      [PLATFORM_METHODS.scaffoldCancel]: true,
      [PLATFORM_METHODS.throughput]: true,
    };
    expect(Object.keys(declared).sort()).toEqual(
      Object.values(PLATFORM_METHODS).sort(),
    );
  });
});
