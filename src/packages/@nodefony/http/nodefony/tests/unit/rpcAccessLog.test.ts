/// <reference types="node" />
//
// ─── Ligne d'accès, audit et traçage d'un appel RPC (#695, ADR-0026 D10) ──────
//
// Critères 38 à 40 : le statut HTTP natif recopié seulement si la réponse est
// finie ; la gravité suit le CODE de l'appel (convention OpenTelemetry du
// serveur gRPC) ; la ligne garde le statut HTTP et ajoute `RPC : <méthode>
// <NOM>` ; l'audit JSON et le canal publient une COPIE des quatre champs.
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `severityOfHttp` → `severityFromStatus(status)` ;
//   - `RPC_SERVER_ERRORS` : retirer un code ;
//   - `rpcFailed` dans `shouldSample` ;
//   - `rpcOutcomeOf` → rendre la fiche elle-même ;
//   - `HttpContext.logRequest` : la garde `this.rpc !== null`.
//
import { expect } from "vitest";
import diagnosticsChannel from "node:diagnostics_channel";
import type { IRequestTrace } from "../../interfaces/IRequestTrace";
import JsonAuditLogger, {
  severityFromRpcCode,
} from "../../service/audit-logger.js";
import DefaultRequestLogger from "../../service/request-logger.js";
import PrettyRequestLogger from "../../service/pretty-request-logger.js";
import HttpContext from "../../src/context/http/HttpContext";
import {
  REQUEST_TRACE_CHANNEL,
  closeRequestTrace,
  openRequestTrace,
} from "../../src/context/requestTrace";
import type { IRpcOutcome } from "../../interfaces/IRpcCall";

function isTrace(message: unknown): message is IRequestTrace {
  return (
    typeof message === "object" &&
    message !== null &&
    "requestId" in message &&
    "rpc" in message
  );
}

/** Abonne `fn` à la fin des requêtes (`asyncEnd`) ; rend le désabonnement. */
function diagnosticsChannelSubscribe(
  fn: (message: IRequestTrace) => void,
): () => void {
  const channel = diagnosticsChannel.channel(
    `tracing:${REQUEST_TRACE_CHANNEL}:asyncEnd`,
  );
  const listener = (message: unknown): void => {
    if (isTrace(message)) fn(message);
  };
  channel.subscribe(listener);
  return () => channel.unsubscribe(listener);
}

const noColor = (s: string): string => s.replace(/\x1b\[\d+(;\d+)?m/g, "");

/** Une fiche d'appel : les quatre champs publiés, plus de quoi trahir une fuite. */
function rpcCall(code: number | null, codeName: string | null) {
  return {
    system: "grpc",
    method: "nodefony.test.v1.EchoService/Say",
    code,
    codeName,
    // Ce que la vraie fiche porte aussi, et qui ne doit JAMAIS être publié.
    target: { secret: "contrôleur" },
    settle: () => null,
  };
}

function fakeHttpContext(
  opts: {
    status?: number;
    error?: Error | null;
    rpc?: ReturnType<typeof rpcCall> | null;
  } = {},
): unknown {
  return {
    url: "/nodefony.test.v1.EchoService/Say",
    remoteAddress: "127.0.0.1",
    originUrl: { host: "localhost:5152" },
    requestId: "rpc-req-id",
    userIdentifier: null,
    method: "POST",
    type: "http",
    serverType: "https",
    scheme: "https",
    response: { statusCode: opts.status ?? 200 },
    request: { headers: {} },
    kernel: { environment: "development" },
    error: opts.error ?? null,
    rpc: opts.rpc ?? null,
    phases: [],
    stopClock: () => 1.5,
    getHost: () => "127.0.0.1:5152",
    getUserAgent: () => "grpc-node",
  };
}

describe("severityFromRpcCode — convention OpenTelemetry du serveur gRPC (critère 39)", () => {
  it("0 → INFO ; 2, 4, 12, 13, 14, 15 → ERROR ; tous les autres → WARNING", () => {
    const errors = new Set([2, 4, 12, 13, 14, 15]);
    for (let code = 0; code <= 16; code++) {
      const expected =
        code === 0 ? "INFO" : errors.has(code) ? "ERROR" : "WARNING";
      expect(severityFromRpcCode(code), `code ${code}`).to.equal(expected);
    }
  });

  it("un code hors de la plage n'est pas pris pour une erreur serveur (aucun repli du décalage)", () => {
    // 34 = 2 modulo 32 : un masque décalé sans garde le lirait comme UNKNOWN.
    expect(severityFromRpcCode(34)).to.equal("WARNING");
  });
});

describe("DefaultRequestLogger — appel RPC (critère 39)", () => {
  const logger = new DefaultRequestLogger();

  it("succès : `RPC : <méthode> OK`, INFO, statut HTTP gardé dans le msgid", () => {
    const e = logger.renderHttp(
      fakeHttpContext({ rpc: rpcCall(0, "OK") }) as never,
    );
    expect(noColor(e.text)).to.contain(
      "RPC : nodefony.test.v1.EchoService/Say OK",
    );
    expect(e.severity).to.equal("INFO");
    expect(noColor(e.msgid)).to.contain("200");
  });

  it("échec sans exception sous HTTP 200 (5) : WARNING, plus INFO", () => {
    const e = logger.renderHttp(
      fakeHttpContext({ rpc: rpcCall(5, "NOT_FOUND") }) as never,
    );
    expect(noColor(e.text)).to.contain("NOT_FOUND");
    expect(e.severity).to.equal("WARNING");
  });

  it("exception (13) : UNE ligne, la cause et le code — ERROR", () => {
    const e = logger.renderHttp(
      fakeHttpContext({
        rpc: rpcCall(13, "INTERNAL"),
        error: new Error("base injoignable"),
      }) as never,
    );
    expect(noColor(e.text)).to.contain("INTERNAL");
    expect(e.text).to.contain("base injoignable");
    expect(e.severity).to.equal("ERROR");
  });

  it("refus métier avec cause (HttpError 404 → 5) : WARNING, pas ERROR", () => {
    const e = logger.renderHttp(
      fakeHttpContext({
        rpc: rpcCall(5, "NOT_FOUND"),
        error: new Error("entité introuvable"),
      }) as never,
    );
    expect(e.severity).to.equal("WARNING");
  });

  it("hors RPC : aucun segment, gravité inchangée", () => {
    const e = logger.renderHttp(fakeHttpContext() as never);
    expect(noColor(e.text)).not.to.contain("RPC");
    expect(e.severity).to.equal("INFO");
  });

  it("appel jamais commencé (code null) : la méthode seule, gravité du statut", () => {
    const e = logger.renderHttp(
      fakeHttpContext({ rpc: rpcCall(null, null) }) as never,
    );
    expect(noColor(e.text)).to.match(
      /RPC : nodefony\.test\.v1\.EchoService\/Say$/,
    );
    expect(e.severity).to.equal("INFO");
  });
});

describe("PrettyRequestLogger — appel RPC (critère 39)", () => {
  const logger = new PrettyRequestLogger();

  it("le statut HTTP 200 reste affiché, la gravité suit le code (14 → ERROR)", () => {
    const e = logger.renderHttp(
      fakeHttpContext({ rpc: rpcCall(14, "UNAVAILABLE") }) as never,
    );
    const text = noColor(e.text);
    expect(text).to.contain(" 200 ");
    expect(text).to.contain(
      "RPC : nodefony.test.v1.EchoService/Say UNAVAILABLE",
    );
    expect(e.severity).to.equal("ERROR");
  });
});

describe("JsonAuditLogger — appel RPC (critère 39)", () => {
  it("champ `rpc` : COPIE des quatre champs, jamais la fiche entière", () => {
    const logger = new JsonAuditLogger();
    const e = logger.renderHttp(
      fakeHttpContext({ rpc: rpcCall(4, "DEADLINE_EXCEEDED") }) as never,
    );
    const entry: unknown = JSON.parse(e.text);
    expect(entry).to.have.property("rpc").that.deep.equals({
      system: "grpc",
      method: "nodefony.test.v1.EchoService/Say",
      code: 4,
      codeName: "DEADLINE_EXCEEDED",
    });
    expect(e.text).not.to.contain("contrôleur");
    expect(e.severity).to.equal("ERROR");
  });

  it("hors RPC : `rpc: null` (forme stable)", () => {
    const e = new JsonAuditLogger().renderHttp(fakeHttpContext() as never);
    expect(JSON.parse(e.text)).to.have.property("rpc", null);
  });

  it("audit nominal coupé : un appel en échec sous HTTP 200 est TOUJOURS écrit, un succès non", () => {
    const logger = new JsonAuditLogger({ nominal: false });
    expect(
      logger.shouldSample(
        fakeHttpContext({ rpc: rpcCall(14, "UNAVAILABLE") }) as never,
      ),
    ).to.equal(true);
    expect(
      logger.shouldSample(fakeHttpContext({ rpc: rpcCall(0, "OK") }) as never),
    ).to.equal(false);
  });

  it("échantillonnage 1/N : un appel en échec n'est jamais écarté", () => {
    const logger = new JsonAuditLogger({ sampleRate: 1000 });
    for (let i = 0; i < 5; i++) {
      expect(
        logger.shouldSample(
          fakeHttpContext({ rpc: rpcCall(13, "INTERNAL") }) as never,
        ),
      ).to.equal(true);
    }
  });
});

describe("HttpContext.logRequest — statut natif d'un appel RPC (critère 38)", () => {
  function makeCtx(nativeStatus: number, ended: boolean, contextStatus = 200) {
    const ctx = Object.create(HttpContext.prototype) as HttpContext;
    const logged: number[] = [];
    Object.assign(ctx, {
      relayAccessLog: null,
      rpc: rpcCall(0, "OK"),
      response: {
        statusCode: contextStatus,
        response: { statusCode: nativeStatus, writableEnded: ended },
      },
      error: null,
      httpKernel: {
        getRequestLogger: () => ({
          renderHttp: (c: { response: { statusCode: number } }) => {
            logged.push(c.response.statusCode);
            return { text: "x", severity: "INFO", msgid: "req" };
          },
          renderWebsocket: () => ({ text: "", severity: "INFO", msgid: "req" }),
        }),
      },
      log: () => undefined,
    });
    return { ctx, logged };
  }

  it("protocole Connect : le 404 natif écrit par l'adaptateur est celui de la ligne", () => {
    const { ctx, logged } = makeCtx(404, true);
    ctx.logRequest();
    expect(logged).to.deep.equal([404]);
  });

  it("client parti : le 499 du contexte n'est PAS écrasé par le 200 natif", () => {
    const { ctx, logged } = makeCtx(200, false, 499);
    ctx.logRequest();
    expect(logged).to.deep.equal([499]);
  });
});

describe("Canal `nodefony.http.request` — champ `rpc` (critère 40)", () => {
  function traced(rpc: ReturnType<typeof rpcCall> | null) {
    const context = {
      requestId: `trace-${String(rpc?.code)}`,
      method: "POST",
      scheme: "https",
      url: "/nodefony.test.v1.EchoService/Say",
      requestTrace: null,
      resolver: null,
      logModule: null,
      stopClock: () => 2,
    };
    openRequestTrace(context as never, "http");
    return context;
  }

  it("ouvert à `null` (forme fixe), fermé avec une COPIE des quatre champs ; `statusCode` reste HTTP", () => {
    const seen: { rpc: IRpcOutcome | null; statusCode: number | null }[] = [];
    const stop = diagnosticsChannelSubscribe((message) => {
      seen.push({ rpc: message.rpc, statusCode: message.statusCode });
    });
    try {
      const context = traced(null);
      expect((context.requestTrace as { rpc: unknown } | null)?.rpc).to.equal(
        null,
      );
      const call = rpcCall(14, "UNAVAILABLE");
      closeRequestTrace(context as never, 200, null, call);
      expect(seen).to.have.length(1);
      expect(seen[0]?.statusCode).to.equal(200);
      expect(seen[0]?.rpc).to.deep.equal({
        system: "grpc",
        method: "nodefony.test.v1.EchoService/Say",
        code: 14,
        codeName: "UNAVAILABLE",
      });
      expect(seen[0]?.rpc).not.to.equal(call);
    } finally {
      stop();
    }
  });

  it("hors RPC : `rpc` reste `null`", () => {
    const seen: (IRpcOutcome | null)[] = [];
    const stop = diagnosticsChannelSubscribe((message) => {
      seen.push(message.rpc);
    });
    try {
      closeRequestTrace(traced(null) as never, 200, null);
      expect(seen).to.deep.equal([null]);
    } finally {
      stop();
    }
  });
});
