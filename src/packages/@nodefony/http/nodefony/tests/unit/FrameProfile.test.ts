/// <reference types="node" />
import { expect } from "chai";
import { FrameProfile } from "../../src/profiler/FrameProfile";
import { Profiler } from "../../src/profiler/Profiler";

/**
 * `FrameProfile` = l'unité profilée de la porte SOCKET : une invocation du pont
 * RPC, pas la connexion qui la porte. Ces tests verrouillent les deux propriétés
 * qui ont motivé son existence — une timeline PAR FRAME (le contexte WS, lui,
 * vit pour toute la connexion) et la collecte par le Profiler sans que celui-ci
 * connaisse le transport (duck-typing du contexte).
 */
function newFrame(
  id = "conn-uuid.1",
  opts: { timing?: boolean; queries?: boolean } = {},
): FrameProfile {
  return new FrameProfile({
    requestId: id,
    type: "websocket",
    scheme: "ws",
    method: "GET",
    url: "/nodefony/kernel/api/modules",
    remoteAddress: "127.0.0.1",
    traceparent: null,
    security: null,
    securityTrace: null,
    timing: opts.timing ?? true,
    queries: opts.queries ?? true,
  });
}

describe("FrameProfile — le profil d'UNE invocation du pont", () => {
  describe("phases", () => {
    it("chaque frame porte ses propres phases (deux frames ne se mélangent jamais)", () => {
      const f1 = newFrame("c.1");
      const f2 = newFrame("c.2");
      f1.phaseStart("action");
      f2.phaseStart("action");
      f2.phaseEnd("action");
      f1.phaseEnd("action");
      expect(f1.phases).to.have.length(1);
      expect(f2.phases).to.have.length(1);
      expect(f1.phases[0].durationMs).to.be.a("number");
    });

    it("une phase ré-entrante (même nom, 2 occurrences) est fermée dans le bon ordre", () => {
      const f = newFrame();
      f.phaseStart("action");
      f.phaseStart("action"); // imbriquée (action qui en déclenche une autre)
      f.phaseEnd("action"); // ferme la PLUS RÉCENTE ouverte
      expect(f.phases[1].durationMs).to.be.a("number");
      expect(f.phases[0].endMs).to.equal(undefined);
      f.phaseEnd("action");
      expect(f.phases[0].durationMs).to.be.a("number");
    });

    it("timing éteint → aucune phase enregistrée (0 allocation, 0 performance.now)", () => {
      const f = newFrame("c.1", { timing: false });
      f.phaseStart("action");
      f.phaseEnd("action");
      expect(f.phases).to.have.length(0);
    });

    it("phaseEnd d'une phase jamais ouverte → no-op (jamais de throw)", () => {
      const f = newFrame();
      f.phaseEnd("render");
      expect(f.phases).to.have.length(0);
    });
  });

  describe("buffer ORM", () => {
    it("profiling actif → buffer alloué (le SQL de la frame se place dans SON waterfall)", () => {
      expect(newFrame("c.1", { queries: true }).profilerQueries).to.deep.equal(
        [],
      );
    });

    it("hors profiling → aucun buffer (le signal « ne pas profiler » des adapters ORM)", () => {
      expect(newFrame("c.1", { queries: false }).profilerQueries).to.equal(
        null,
      );
    });
  });

  describe("collecte par le Profiler (sans qu'il connaisse le transport)", () => {
    it("un profil de frame se collecte comme une requête → kind ws, indexé par son id", () => {
      const profiler = new Profiler();
      const f = newFrame("conn-uuid.7");
      f.phaseStart("resolve");
      f.phaseEnd("resolve");
      f.resolver = {
        route: { name: "modules" },
        controller: { name: "KernelAdminApi" },
        actionName: "list",
      };
      f.profilerQueries?.push({ sql: "select 1", durationMs: 0.4 });
      f.finish(200);
      profiler.collect(f);

      const entry = profiler.get("conn-uuid.7");
      expect(entry?.kind).to.equal("ws");
      expect(entry?.status).to.equal(200);
      expect(entry?.method).to.equal("GET");
      expect(entry?.url).to.equal("/nodefony/kernel/api/modules");
      expect(entry?.route).to.equal("modules");
      expect(entry?.action).to.equal("list");
      expect(entry?.phases).to.have.length(1);
      expect(entry?.queries).to.have.length(1);
      expect(entry?.durationMs).to.be.a("number");
    });

    it("un refus est profilé avec son statut et son message (le 403 devient lisible)", () => {
      const profiler = new Profiler();
      const f = newFrame("conn-uuid.8");
      f.finish(403, new Error("Access denied"));
      profiler.collect(f);
      const entry = profiler.get("conn-uuid.8");
      expect(entry?.status).to.equal(403);
      expect(entry?.error).to.equal("Access denied");
    });

    it("les invocations d'une même connexion sont des profils DISTINCTS", () => {
      const profiler = new Profiler();
      for (const id of ["conn.1", "conn.2", "conn.3"]) {
        const f = newFrame(id);
        f.finish(200);
        profiler.collect(f);
      }
      expect(profiler.size).to.equal(3);
      expect(profiler.get("conn.2")?.requestId).to.equal("conn.2");
    });
  });
});
