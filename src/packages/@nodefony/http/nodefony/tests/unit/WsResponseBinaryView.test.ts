/// <reference types="node" />
import { describe, it, expect } from "vitest";
import WebsocketResponse from "../../src/context/websocket/Response";
import type WebsocketContext from "../../src/context/websocket/WebsocketContext";

/**
 * #617 — une vue typée n'émet QUE ses propres octets.
 *
 * `setBody` lisait `ele.buffer` sans `byteOffset` ni `byteLength` : une vue issue
 * de `subarray()`, ou un petit `Buffer` alloué dans le pool partagé de Node,
 * partait avec tout son buffer parent — des octets d'autres allocations vers le
 * client. Et une vue sur `SharedArrayBuffer` ne tombait dans aucune branche.
 */
describe("WebsocketResponse.setBody — vues typées (#617)", () => {
  const response = () =>
    new WebsocketResponse(null, {} as unknown as WebsocketContext);

  it("subarray(2, 4) → exactement ces 2 octets, pas le buffer parent", () => {
    const parent = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const body = response().setBody(parent.subarray(2, 4));
    expect([...body!]).toEqual([3, 4]);
  });

  it("petit Buffer du pool partagé → ses seuls octets", () => {
    const petit = Buffer.from("ok");
    expect(petit.buffer.byteLength).toBeGreaterThan(petit.byteLength);
    expect(response().setBody(petit)!.toString()).toBe("ok");
  });

  it("vue sur SharedArrayBuffer → prise en compte, pas ignorée", () => {
    const partage = new Uint8Array(new SharedArrayBuffer(4));
    partage.set([9, 8, 7, 6]);
    expect([...response().setBody(partage.subarray(1, 3))!]).toEqual([8, 7]);
  });
});
