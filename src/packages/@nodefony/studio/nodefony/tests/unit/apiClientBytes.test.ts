/// <reference types="node" />
/**
 * Unit — relecture des octets par le chemin `fetch` de l'ApiClient (#618 D9).
 *
 * Le REST du plan d'administration annonce la convention `$bytes` par l'en-tête
 * `x-nodefony-bytes` quand l'application active un codec binaire. L'ApiClient
 * relit alors les octets en `Uint8Array`, comme la socket les livre ; sans
 * l'en-tête, un objet `{"$bytes": …}` reste un objet.
 */
import { describe, it, vi, beforeEach, afterEach, expect } from "vitest";
import {
  BYTES_MARKER,
  BYTES_MARKER_HEADER,
  JSON_BYTES_FRAME_CODEC,
} from "nodefony";
import { ApiClient } from "../../../frontend/src/services/ApiClient";

const body = JSON_BYTES_FRAME_CODEC.encode({
  result: { frame: new Uint8Array([0, 255, 7]) },
});

function response(headers: Record<string, string>): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("ApiClient — octets sur le chemin fetch (#618 D9)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("en-tête annoncé : les octets reviennent en Uint8Array", async () => {
    fetchMock.mockResolvedValue(
      response({ [BYTES_MARKER_HEADER]: BYTES_MARKER }),
    );
    const out = await new ApiClient().getAbsolute<{ frame: unknown }>(
      "/nodefony/studio/api/supervision/history",
    );
    expect(out.frame).to.be.instanceOf(Uint8Array);
    expect(Array.from(out.frame as Uint8Array)).to.deep.equal([0, 255, 7]);
  });

  it('sans en-tête : JSON natif, l\'objet `{"$bytes": …}` reste un objet', async () => {
    fetchMock.mockResolvedValue(response({}));
    const out = await new ApiClient().getAbsolute<{ frame: unknown }>(
      "/nodefony/studio/api/supervision/history",
    );
    expect(out.frame).to.deep.equal({ [BYTES_MARKER]: "AP8H" });
  });
});
