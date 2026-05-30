/// <reference types="node" />
import { expect } from "chai";
import type { Data } from "../../service/http-kernel.js";
import {
  buildMetaData,
  type IMetaDataSource,
} from "../../src/context/metaData.js";

// Enveloppe `metaData` per-requête (builder monomorphe pur). Tests DURCIS :
// la sémantique risquée est le merge de l'override `{ nodefony: { websocket } }`
// (un Object.assign(target, override) naïf écraserait toute l'enveloppe) et
// l'isolation per-requête du snapshot `route` (régression du bleed inter-requêtes
// quand `variablesMap` vivait sur l'instance Route partagée).

const freshTarget = (): Data => ({ nodefony: {}, result: null });

const baseSrc = (over: Partial<IMetaDataSource> = {}): IMetaDataSource => ({
  kernel: {
    projectName: "app",
    version: "10.0.0",
    environment: "production",
    debug: false,
  },
  request: { url: new URL("https://localhost:5152/ws/routes/alpha") },
  scheme: "https",
  requestId: "rid-1",
  resolver: null,
  ...over,
});

const routeResolver = (params: Record<string, unknown>) => ({
  route: { name: "Ctrl::action", path: "/ws/routes/{ele}" },
  getMatchedParams: () => params,
});

describe("buildMetaData — enveloppe metaData (builder monomorphe)", () => {
  it("base HTTP (sans resolver) : enveloppe complète, route undefined, result préservé", () => {
    const t = freshTarget();
    const r = buildMetaData(t, baseSrc());
    expect(r).to.equal(t); // in-place → même référence (comme l'ancien extend)
    expect(t.nodefony.name).to.equal("app");
    expect(t.nodefony.version).to.equal("10.0.0");
    expect(t.nodefony.scheme).to.equal("https");
    expect(t.nodefony.requestId).to.equal("rid-1");
    expect(t.nodefony.environment).to.equal("production");
    expect(t.nodefony.debug).to.equal(false);
    expect(t.nodefony.route).to.equal(undefined);
    expect(t.result).to.equal(null);
  });

  it("avec resolver+route : route = snapshot { name, path, variablesMap }", () => {
    const t = freshTarget();
    buildMetaData(t, baseSrc({ resolver: routeResolver({ ele: "alpha" }) }));
    expect(t.nodefony.route?.name).to.equal("Ctrl::action");
    expect(t.nodefony.route?.path).to.equal("/ws/routes/{ele}");
    expect(t.nodefony.route?.variablesMap).to.deep.equal({ ele: "alpha" });
  });

  it("resolver présent mais route null → route undefined", () => {
    const t = freshTarget();
    buildMetaData(
      t,
      baseSrc({ resolver: { route: null, getMatchedParams: () => ({}) } }),
    );
    expect(t.nodefony.route).to.equal(undefined);
  });

  it("snapshot route découplé de la source (jamais l'instance partagée)", () => {
    const t = freshTarget();
    const resolver = routeResolver({ ele: "alpha" });
    buildMetaData(t, baseSrc({ resolver }));
    // objet neuf, pas la réf de la route source (qui serait partagée/statique)
    expect(t.nodefony.route).to.not.equal(resolver.route);
  });

  // CRITIQUE — un Object.assign(target, override) naïf écraserait `nodefony`.
  it("override WS { nodefony: { websocket } } fusionne SANS écraser l'enveloppe", () => {
    const t = freshTarget();
    buildMetaData(t, baseSrc({ resolver: routeResolver({ ele: "alpha" }) }), {
      nodefony: {
        websocket: { state: "connected", protocol: "echo-protocol" },
      },
    });
    // enveloppe intacte
    expect(t.nodefony.name).to.equal("app");
    expect(t.nodefony.route?.variablesMap).to.deep.equal({ ele: "alpha" });
    // + websocket ajouté
    expect(t.nodefony.websocket).to.deep.equal({
      state: "connected",
      protocol: "echo-protocol",
    });
  });

  it("accumulation : base puis override WS sur le même target (cycle réel)", () => {
    const t = freshTarget();
    const src = baseSrc({ resolver: routeResolver({ ele: "alpha" }) });
    buildMetaData(t, src); // 1er appel (onRequest)
    buildMetaData(t, src, {
      nodefony: { websocket: { state: "message", protocol: "echo" } },
    });
    expect(t.nodefony.name).to.equal("app");
    expect(t.nodefony.route?.variablesMap).to.deep.equal({ ele: "alpha" });
    expect(t.nodefony.websocket?.state).to.equal("message");
  });

  it("clé top-level d'override (hors nodefony) préservée", () => {
    const t = freshTarget();
    buildMetaData(t, baseSrc(), { result: { ok: true } });
    expect(t.result).to.deep.equal({ ok: true });
    expect(t.nodefony.name).to.equal("app"); // enveloppe intacte
  });

  // Durci — pendant de l'intégration WS : deux requêtes ne se bleedent pas.
  it("isolation : deux targets/sources distincts gardent leur propre variablesMap", () => {
    const tA = freshTarget();
    const tB = freshTarget();
    buildMetaData(tA, baseSrc({ resolver: routeResolver({ ele: "alpha" }) }));
    buildMetaData(tB, baseSrc({ resolver: routeResolver({ ele: "beta" }) }));
    expect(tA.nodefony.route?.variablesMap).to.deep.equal({ ele: "alpha" });
    expect(tB.nodefony.route?.variablesMap).to.deep.equal({ ele: "beta" });
  });

  it("getMatchedParams appelé exactement une fois par build (pas de fuite)", () => {
    const t = freshTarget();
    let calls = 0;
    buildMetaData(
      t,
      baseSrc({
        resolver: {
          route: { name: "C", path: "/" },
          getMatchedParams: () => {
            calls++;
            return {};
          },
        },
      }),
    );
    expect(calls).to.equal(1);
  });
});
