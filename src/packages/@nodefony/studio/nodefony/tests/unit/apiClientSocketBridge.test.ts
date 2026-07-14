/// <reference types="node" />
/**
 * Unit — pont « API souveraine » de l'ApiClient Studio (Ph.3 front).
 *
 * L'ApiClient route les GET via la Socket Nodefony (`socket.request("/path")`)
 * ET les mutations (`socket.mutate`, P6.8) quand elle est connectée, fallback
 * fetch sinon — même URL, même shape, mêmes erreurs (`ApiError`). Logique pure
 * (pas de React, pas de serveur) → socket + fetch mockés.
 *
 * Invariants verrouillés :
 *  - GET + socket connectée → socket, AUCUN fetch ; unwrap `{result}` identique ;
 *  - mutation (POST) + socket connectée → `socket.mutate` AVEC idempotency-key ;
 *  - mutation : échec socket → fallback fetch portant la MÊME idempotency-key
 *    (dédup cross-transport, anti double-effet) ;
 *  - GET = jamais d'idempotency-key ; mutation HTTP directe = clé posée ;
 *  - socket absente / déconnectée / kill switch OFF / abort signal → fetch ;
 *  - la socket ne sert que les SUCCÈS : TOUTE erreur du pont → fallback fetch
 *    (la réponse d'erreur de référence vient du HTTP — un 405/404 du pont
 *    peut différer de la réponse REST, vécu /stats /health /auth/me) ;
 *  - mémorisations : `-32601` → pont désactivé session ; 405 → couple
 *    méthode+route HTTP-only session (le GET d'une route reste pontable même si
 *    son POST a répondu 405 — scope par méthode).
 */
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import {
  ApiClient,
  ApiError,
  type ApiSocketLike,
} from "../../../frontend/src/services/ApiClient";

/** Réponse fetch JSON minimale. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** RpcError structurel (duck-typing du core — name/code/data). */
function rpcError(
  code: number,
  data?: { status?: number; body?: unknown },
): Error {
  const e = new Error(`rpc ${code}`) as Error & {
    code: number;
    data?: unknown;
  };
  Object.defineProperty(e, "name", { value: "RpcError" });
  e.code = code;
  if (data !== undefined) e.data = data;
  return e;
}

interface MutateCall {
  path: string;
  method: string;
  body?: unknown;
  idempotencyKey: string;
}

function fakeSocket(opts: {
  state?: string;
  result?: unknown;
  reject?: unknown;
}): ApiSocketLike & { calls: string[]; mutateCalls: MutateCall[] } {
  const calls: string[] = [];
  const mutateCalls: MutateCall[] = [];
  return {
    state: opts.state ?? "connected",
    calls,
    mutateCalls,
    request<T>(path: `/${string}`): Promise<T> {
      calls.push(path);
      if (opts.reject !== undefined)
        return Promise.reject(opts.reject as Error);
      return Promise.resolve(opts.result as T);
    },
    mutate<T>(
      path: `/${string}`,
      init: {
        method: "POST" | "PUT" | "PATCH" | "DELETE";
        body?: unknown;
        idempotencyKey: string;
        timeoutMs?: number;
      },
    ): Promise<T> {
      mutateCalls.push({
        path,
        method: init.method,
        body: init.body,
        idempotencyKey: init.idempotencyKey,
      });
      if (opts.reject !== undefined)
        return Promise.reject(opts.reject as Error);
      return Promise.resolve(opts.result as T);
    },
  };
}

/** En-tête `Idempotency-Key` d'un appel fetch mocké (ou null si absent). */
function idemHeaderOf(
  call: Parameters<typeof fetch> | undefined,
): string | null {
  const init = call?.[1];
  return new Headers(init?.headers).get("Idempotency-Key");
}

describe("ApiClient — pont API souveraine (socket)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET + socket connectée → socket, zéro fetch, snapshot rendu tel quel", async () => {
    const socket = fakeSocket({ result: [{ id: "b1" }] });
    const api = new ApiClient({ socket });
    const out = await api.getAbsolute("/poc/r-books");
    expect(out).to.deep.equal([{ id: "b1" }]);
    expect(socket.calls).to.deep.equal(["/poc/r-books"]);
    expect(fetchMock.mock.calls.length).to.equal(0);
  });

  it("unwrap `{result}` identique au chemin fetch (même shape)", async () => {
    const socket = fakeSocket({ result: { result: { ok: true } } });
    const api = new ApiClient({ socket });
    const out = await api.getAbsolute("/nodefony/kernel/api/info");
    expect(out).to.deep.equal({ ok: true });
  });

  it("mutation (POST) + socket connectée → socket.mutate avec idempotency-key, zéro fetch", async () => {
    const socket = fakeSocket({ result: { saved: true } });
    const api = new ApiClient({ socket });
    const out = await api.postAbsolute("/nodefony/x/api/save", { a: 1 });
    expect(out).to.deep.equal({ saved: true });
    expect(socket.mutateCalls.length).to.equal(1);
    expect(socket.mutateCalls[0].method).to.equal("POST");
    expect(socket.mutateCalls[0].body).to.deep.equal({ a: 1 });
    expect(socket.mutateCalls[0].idempotencyKey).to.be.a("string").and.not
      .empty;
    expect(fetchMock.mock.calls.length).to.equal(0);
  });

  it("mutation : échec socket → fallback fetch AVEC la MÊME Idempotency-Key (anti double-effet)", async () => {
    const socket = fakeSocket({
      reject: new Error("RPC timeout: api.request"),
    });
    fetchMock.mockResolvedValue(jsonResponse({ saved: true }));
    const api = new ApiClient({ socket });
    const out = await api.postAbsolute("/nodefony/x/api/save", { a: 1 });
    expect(out).to.deep.equal({ saved: true });
    expect(socket.mutateCalls.length).to.equal(1);
    expect(fetchMock.mock.calls.length).to.equal(1);
    // Le repli HTTP porte EXACTEMENT la clé de la tentative socket → le serveur
    // dédoublonne si la mutation avait abouti côté serveur avant la coupure.
    expect(idemHeaderOf(fetchMock.mock.calls[0])).to.equal(
      socket.mutateCalls[0].idempotencyKey,
    );
  });

  it("mutation HTTP directe (socket absente) → fetch avec une Idempotency-Key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ saved: true }));
    const api = new ApiClient({}); // pas de socket
    await api.postAbsolute("/nodefony/x/api/save", { a: 1 });
    expect(idemHeaderOf(fetchMock.mock.calls[0])).to.be.a("string").and.not
      .empty;
  });

  it("GET (fetch direct) → AUCUNE Idempotency-Key (lecture, pas une mutation)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: 1 }));
    const api = new ApiClient({}); // pas de socket → GET en fetch
    await api.getAbsolute("/nodefony/kernel/api/modules");
    expect(idemHeaderOf(fetchMock.mock.calls[0])).to.equal(null);
  });

  it("405 sur un POST → couple POST+route mémorisé HTTP-only, le GET de la route reste pontable", async () => {
    const socket = fakeSocket({
      reject: rpcError(-32000, { status: 405, body: {} }),
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ ok: 1 })),
    );
    const api = new ApiClient({ socket });
    // POST → 405 → fallback fetch ; le couple POST+route devient HTTP-only.
    await api.postAbsolute("/nodefony/x/api/thing", { a: 1 });
    expect(socket.mutateCalls.length).to.equal(1);
    // 2ᵉ POST même route → plus AUCUNE tentative socket.
    await api.postAbsolute("/nodefony/x/api/thing", { a: 2 });
    expect(socket.mutateCalls.length).to.equal(1);
    // MAIS un GET sur la MÊME route reste éligible au pont (scope par méthode).
    await api.getAbsolute("/nodefony/x/api/thing").catch(() => {});
    expect(socket.calls.length).to.equal(1);
  });

  it("socket déconnectée → fetch", async () => {
    const socket = fakeSocket({ state: "reconnecting", result: {} });
    fetchMock.mockResolvedValue(jsonResponse({ via: "http" }));
    const api = new ApiClient({ socket });
    const out = await api.getAbsolute("/nodefony/kernel/api/modules");
    expect(out).to.deep.equal({ via: "http" });
    expect(socket.calls.length).to.equal(0);
  });

  it("kill switch OFF (socketEnabled → false) → fetch", async () => {
    const socket = fakeSocket({ result: { via: "ws" } });
    fetchMock.mockResolvedValue(jsonResponse({ via: "http" }));
    const api = new ApiClient({ socket, socketEnabled: () => false });
    const out = await api.getAbsolute("/nodefony/kernel/api/modules");
    expect(out).to.deep.equal({ via: "http" });
    expect(socket.calls.length).to.equal(0);
  });

  it("AbortSignal fourni → fetch (la socket ne sait pas annuler)", async () => {
    const socket = fakeSocket({ result: { via: "ws" } });
    fetchMock.mockResolvedValue(jsonResponse({ via: "http" }));
    const api = new ApiClient({ socket });
    const ctrl = new AbortController();
    const out = await api.getAbsolute("/nodefony/kernel/api/modules", {
      signal: ctrl.signal,
    });
    expect(out).to.deep.equal({ via: "http" });
    expect(socket.calls.length).to.equal(0);
  });

  it("erreur applicative du pont (404) → fallback fetch = réponse de RÉFÉRENCE (ApiError du HTTP)", async () => {
    const socket = fakeSocket({
      reject: rpcError(-32000, {
        status: 404,
        body: { error: { message: "module zzz-nope introuvable" } },
      }),
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { error: { message: "module zzz-nope introuvable" } },
          404,
        ),
      ),
    );
    const onError = vi.fn();
    const api = new ApiClient({ socket, onError });
    try {
      await api.getAbsolute("/nodefony/kernel/api/module/zzz-nope");
      expect.fail("aurait dû rejeter");
    } catch (e) {
      expect(e).to.be.instanceOf(ApiError);
      expect((e as ApiError).status).to.equal(404);
    }
    // L'erreur servie vient du chemin HTTP (1 fetch), pas d'un mapping socket.
    expect(fetchMock.mock.calls.length).to.equal(1);
    expect(onError.mock.calls[0][0].status).to.equal(404);
  });

  it("405 du pont (route GET-only, ex /stats) → fallback fetch 200 + route mémorisée HTTP-only", async () => {
    const socket = fakeSocket({
      reject: rpcError(-32000, { status: 405, body: {} }),
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ cpu: 1 })),
    );
    const api = new ApiClient({ socket });
    // 1ᵉʳ appel : socket tentée → 405 → fetch sert le snapshot (régression vécue
    // au 1ᵉʳ déploiement : /stats, /health, /auth/me cassés en 405).
    const out = await api.getAbsolute("/nodefony/studio/api/stats?x=1");
    expect(out).to.deep.equal({ cpu: 1 });
    expect(socket.calls.length).to.equal(1);
    // 2ᵉ appel (même route, autre query) : plus AUCUNE tentative socket.
    await api.getAbsolute("/nodefony/studio/api/stats?x=2");
    expect(socket.calls.length).to.equal(1);
    expect(fetchMock.mock.calls.length).to.equal(2);
    // Une AUTRE route reste éligible au pont.
    await api.getAbsolute("/nodefony/kernel/api/modules").catch(() => {});
    expect(socket.calls.length).to.equal(2);
  });

  it("RpcError -32601 (pont absent) → fallback fetch + pont désactivé pour la session", async () => {
    const socket = fakeSocket({ reject: rpcError(-32601) });
    // Response NEUVE par appel (un body fetch ne se lit qu'une fois).
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ via: "http" })),
    );
    const api = new ApiClient({ socket });
    const first = await api.getAbsolute("/nodefony/kernel/api/modules");
    expect(first).to.deep.equal({ via: "http" });
    expect(socket.calls.length).to.equal(1);
    // 2ᵉ appel : la socket n'est PLUS tentée (bridge down mémorisé).
    await api.getAbsolute("/nodefony/kernel/api/modules");
    expect(socket.calls.length).to.equal(1);
    expect(fetchMock.mock.calls.length).to.equal(2);
  });

  it("erreur transport (timeout, pas un RpcError) → fallback fetch, pont conservé", async () => {
    const socket = fakeSocket({
      reject: new Error("RPC timeout: api.request"),
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ via: "http" })),
    );
    const api = new ApiClient({ socket });
    const out = await api.getAbsolute("/nodefony/kernel/api/modules");
    expect(out).to.deep.equal({ via: "http" });
    // Le pont reste actif (panne ponctuelle ≠ pont absent).
    await api.getAbsolute("/nodefony/kernel/api/modules");
    expect(socket.calls.length).to.equal(2);
  });
});
