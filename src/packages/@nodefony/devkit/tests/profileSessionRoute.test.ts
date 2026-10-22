/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import DevkitService from "../nodefony/service/DevkitService";
import {
  PROFILE_SESSION_FACTOR,
  PROFILE_SESSION_PATH,
} from "../nodefony/src/profileSession";

// La mécanique (ticket, localité, ouverture, verdict) vit dans `@nodefony/ai`
// et s'y éprouve (`ticketSession.attack.test.ts`). Ici : ce que devkit DÉCLARE
// — son facteur, son chemin, et que l'outil et la route partagent UNE porte.

function service(container: Container): DevkitService {
  return new DevkitService({
    container,
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
}

describe("la porte de session du profilage", () => {
  it("le facteur journalisé nomme le devkit, pas « federated »", () => {
    expect(PROFILE_SESSION_FACTOR).toBe("devkit");
    const gate = service(new Container()).profileSessionGate();
    expect(gate.settings).toEqual({ factor: "devkit", localOnly: true });
  });

  it("l'outil émet dans la porte que la route sert : une seule, définie une fois", () => {
    const svc = service(new Container());
    const gate = svc.profileSessionGate();
    expect(svc.profileSessionGate()).toBe(gate);
    expect(gate.pending).toBe(0);
    svc.mcpToolDeps().profileRoute?.issueTicket?.("alice");
    expect(gate.pending).toBe(1);
  });

  it("la fermeture détruit la session au nom du facteur du devkit", async () => {
    const container = new Container();
    const destroyed: [string, string | null | undefined][] = [];
    container.set("sessions", {
      sessionRef: (id: string) => `ref_${id}`,
      destroyByRef: async (ref: string, actor?: string | null) => {
        destroyed.push([ref, actor]);
        return true;
      },
    });
    const closed = await service(container)
      .mcpToolDeps()
      .profileRoute?.closeSession?.("sess_abc");
    expect(closed).toBe(true);
    expect(destroyed).toEqual([["sess_abc", "devkit"]]);
  });
});

describe("le chemin de la route, une seule vérité", () => {
  it("le contrôleur sert EXACTEMENT le chemin que l'outil appelle", () => {
    const source = readFileSync(
      new URL(
        "../nodefony/controllers/ProfileSessionController.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const prefix = /@controller\("([^"]+)"\)/u.exec(source)?.[1];
    const route = /path: "([^"]+)"/u.exec(source)?.[1];
    expect(`${prefix}${route}`).toBe(PROFILE_SESSION_PATH);
  });

  it("hors de la zone d'administration, qui exigerait une session déjà ouverte", () => {
    expect(/^\/nodefony\/[^/]+\/api(\/|$)/u.test(PROFILE_SESSION_PATH)).toBe(
      false,
    );
  });
});
