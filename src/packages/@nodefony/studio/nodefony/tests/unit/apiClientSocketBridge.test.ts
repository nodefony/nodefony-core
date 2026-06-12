/// <reference types="node" />
/**
 * Unit — pont « API souveraine » de l'ApiClient Studio (Ph.3 front).
 *
 * L'ApiClient route les GET via la Socket Nodefony (`socket.request("/path")`,
 * méthode RPC `api.request`) quand elle est connectée, fallback fetch sinon —
 * même URL, même shape, mêmes erreurs (`ApiError`). Logique pure (pas de React,
 * pas de serveur) → socket + fetch mockés.
 *
 * Invariants verrouillés :
 *  - GET + socket connectée → socket, AUCUN fetch ; unwrap `{result}` identique ;
 *  - mutations (POST) → toujours fetch (HTTP-only Ph.3) ;
 *  - socket absente / déconnectée / kill switch OFF / abort signal → fetch ;
 *  - RpcError avec `data.status` = vraie réponse → ApiError propagé, PAS de
 *    re-tentative HTTP (sinon double requête) ; 401 → onUnauthorized ;
 *  - RpcError `-32601` (pont non exposé) → fallback fetch + pont désactivé
 *    pour la session ; erreur transport (timeout) → fallback fetch.
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

function fakeSocket(opts: {
  state?: string;
  result?: unknown;
  reject?: unknown;
}): ApiSocketLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    state: opts.state ?? "connected",
    calls,
    request<T>(path: `/${string}`): Promise<T> {
      calls.push(path);
      if (opts.reject !== undefined)
        return Promise.reject(opts.reject as Error);
      return Promise.resolve(opts.result as T);
    },
  };
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

  it("mutation (POST) → toujours fetch, jamais la socket", async () => {
    const socket = fakeSocket({ result: { nope: true } });
    fetchMock.mockResolvedValue(jsonResponse({ saved: true }));
    const api = new ApiClient({ socket });
    const out = await api.postAbsolute("/nodefony/x/api/save", { a: 1 });
    expect(out).to.deep.equal({ saved: true });
    expect(socket.calls.length).to.equal(0);
    expect(fetchMock.mock.calls.length).to.equal(1);
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

  it("RpcError data.status=404 → ApiError(404) propagé, PAS de fallback fetch", async () => {
    const socket = fakeSocket({
      reject: rpcError(-32000, {
        status: 404,
        body: { error: { message: "module zzz-nope introuvable" } },
      }),
    });
    const onError = vi.fn();
    const api = new ApiClient({ socket, onError });
    try {
      await api.getAbsolute("/nodefony/kernel/api/module/zzz-nope");
      expect.fail("aurait dû rejeter");
    } catch (e) {
      expect(e).to.be.instanceOf(ApiError);
      expect((e as ApiError).status).to.equal(404);
    }
    expect(fetchMock.mock.calls.length).to.equal(0);
    expect(onError.mock.calls[0][0].status).to.equal(404);
    expect(onError.mock.calls[0][0].message).to.equal(
      "module zzz-nope introuvable",
    );
  });

  it("RpcError data.status=401 → onUnauthorized (même flow logout qu'en HTTP)", async () => {
    const socket = fakeSocket({
      reject: rpcError(-32000, { status: 401, body: {} }),
    });
    const onUnauthorized = vi.fn();
    const api = new ApiClient({ socket, onUnauthorized });
    try {
      await api.getAbsolute("/nodefony/kernel/api/info");
    } catch {
      /* ApiError attendu */
    }
    expect(onUnauthorized.mock.calls.length).to.equal(1);
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
