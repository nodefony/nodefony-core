/**
 * `observeSse` — le socle des quatre liaisons SSE, éprouvé UNE fois.
 *
 * Les règles (forme de l'état, rappel par événement, types écoutés, refus du
 * serveur, fermeture idempotente) vivent ici ; les fichiers de chaque front ne
 * prouvent que la traduction — montage, réactivité, et surtout FERMETURE au
 * démontage.
 */
import { describe, it, expect } from "vitest";
import { observeSse, type SseSnapshot } from "../client/sse/observe";
import type { ISseEvent } from "../client/sse/SseParser";
import { sseFetchBench, settle } from "./fixtures/sseFetch";

const URL_FLUX = "http://127.0.0.1/flux";

describe("observeSse — le socle des liaisons SSE", () => {
  it("rend CONNECTING tout de suite, OPEN à la réponse, puis chaque événement", async () => {
    const banc = sseFetchBench();
    const etats: SseSnapshot[] = [];
    const stop = observeSse(URL_FLUX, (s) => etats.push(s), {
      fetch: banc.fetch,
    });
    expect(etats).toHaveLength(1);
    expect(etats[0]).toMatchObject({ readyState: 0, lastEvent: null });
    await settle();
    expect(etats.at(-1)).toMatchObject({ readyState: 1, error: false });

    banc.calls[0]!.push("data: un\n\n");
    await settle();
    expect(etats.at(-1)!.lastEvent).toEqual({
      type: "message",
      data: "un",
      lastEventId: "",
    });
    stop();
  });

  it("appelle onEvent pour CHAQUE événement, même arrivés dans le même morceau", async () => {
    const banc = sseFetchBench();
    const recus: ISseEvent[] = [];
    const stop = observeSse(URL_FLUX, () => undefined, {
      fetch: banc.fetch,
      onEvent: (e) => recus.push(e),
    });
    await settle();
    banc.calls[0]!.push("data: a\n\ndata: b\n\ndata: c\n\n");
    await settle();
    expect(recus.map((e) => e.data)).toEqual(["a", "b", "c"]);
    stop();
  });

  it("n'entend que les types listés dans `events`", async () => {
    const banc = sseFetchBench();
    const recus: string[] = [];
    const stop = observeSse(URL_FLUX, () => undefined, {
      fetch: banc.fetch,
      events: ["log"],
      onEvent: (e) => recus.push(`${e.type}:${e.data}`),
    });
    await settle();
    banc.calls[0]!.push("data: muet\n\nevent: log\ndata: entendu\n\n");
    await settle();
    expect(recus).toEqual(["log:entendu"]);
    stop();
  });

  it("refus du serveur (401) : CLOSED avec erreur, et aucune reconnexion", async () => {
    const banc = sseFetchBench(401);
    const etats: SseSnapshot[] = [];
    const stop = observeSse(URL_FLUX, (s) => etats.push(s), {
      fetch: banc.fetch,
    });
    await settle();
    expect(etats.at(-1)).toMatchObject({ readyState: 2, error: true });
    await settle();
    expect(banc.calls).toHaveLength(1);
    stop();
  });

  it("🔴 la libération FERME la requête, et se rejoue sans effet", async () => {
    const banc = sseFetchBench();
    const etats: SseSnapshot[] = [];
    const stop = observeSse(URL_FLUX, (s) => etats.push(s), {
      fetch: banc.fetch,
    });
    await settle();
    expect(banc.open()).toBe(1);
    stop();
    expect(banc.open()).toBe(0);
    const avant = etats.length;
    stop();
    banc.calls[0]!.push("data: trop tard\n\n");
    await settle();
    // Plus rien n'est délivré après la libération.
    expect(etats).toHaveLength(avant);
  });

  it("une adresse null n'ouvre RIEN : état CLOSED sans erreur", () => {
    const banc = sseFetchBench();
    const etats: SseSnapshot[] = [];
    observeSse(null, (s) => etats.push(s), { fetch: banc.fetch })();
    expect(banc.calls).toHaveLength(0);
    expect(etats).toEqual([{ readyState: 2, lastEvent: null, error: false }]);
  });
});
