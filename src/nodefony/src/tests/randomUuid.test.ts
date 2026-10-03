/*
 *   `randomUuid()` — UUID v4 qui tient HORS contexte sécurisé.
 *
 *   `crypto.randomUUID()` n'existe que sous HTTPS ou sur la boucle locale : une
 *   page ouverte en `http://<IP de LAN>` (téléphone, TV, tablette) n'en dispose
 *   pas. Mesuré : `getPageId()` y levait « randomUUID is not a function » — même
 *   sur un Chromium récent. On simule ce contexte en retirant `randomUUID` du
 *   `crypto` global, et l'on vérifie la forme v4 ET les deux appelants du client.
 */

import { webcrypto } from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUuid } from "../runtime/randomUuid";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Le `crypto` d'une page servie hors contexte sécurisé : sans `randomUUID`. */
const insecureCrypto = {
  getRandomValues: (array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> =>
    webcrypto.getRandomValues(array),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("randomUuid", () => {
  it("rend un UUID v4 quand randomUUID existe", () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });

  it("rend un UUID v4 hors contexte sécurisé (repli getRandomValues)", () => {
    vi.stubGlobal("crypto", insecureCrypto);
    const ids = new Set(Array.from({ length: 200 }, () => randomUuid()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("getPageId() et generateId() tiennent hors contexte sécurisé", async () => {
    vi.stubGlobal("crypto", insecureCrypto);
    const { getPageId } = await import("../client/syslog/context");
    const { generateId } = await import("../client/index");
    expect(getPageId()).toMatch(UUID_V4);
    expect(generateId()).toMatch(UUID_V4);
  });
});
