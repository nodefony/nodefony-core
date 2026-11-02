/// <reference types="node" />
import { expect } from "vitest";
import {
  BYTES_MARKER,
  BYTES_MARKER_HEADER,
  Container,
  JSON_BYTES_FRAME_CODEC,
  JSON_FRAME_CODEC,
  RequestContext,
  textCodecForMarker,
} from "nodefony";
import type { IAdminEndpoint, IFrameCodec } from "nodefony";
import AdminApiController from "../../controller/AdminApiController.js";
import type { ContextType } from "@nodefony/http";

/**
 * #618 D9 — le REST du plan d'administration emprunte le codec des connexions
 * texte de la socket. Quand l'application active un codec binaire, des octets
 * rendus par un producteur se relisent à l'IDENTIQUE par `GET` et par le pont
 * `api.request` ; sans activation, le rendu historique (`renderJson`) reste.
 */

const ADMIN = "ROLE_NODEFONY_ADMIN";

/** La charge d'un producteur : des octets imbriqués, à côté de valeurs simples. */
function payload() {
  return {
    label: "carte",
    frame: new Uint8Array([0, 1, 127, 128, 255]),
    nested: { rows: [new Uint8Array([9, 8]), 3] },
  };
}

type Rendered =
  | { via: "renderJson"; body: unknown; headers: Record<string, unknown> }
  | {
      via: "renderResponse";
      text: string;
      headers: Record<string, unknown>;
    }
  | { via: "socket"; body: unknown };

async function dispatch(opts: {
  type: "http" | "websocket";
  textCodec: IFrameCodec | null;
}): Promise<Rendered> {
  const endpoint: IAdminEndpoint = {
    path: "supervision/history",
    method: "GET",
    handler: async () => payload(),
  };
  const container = new Container();
  container.set("adminBroker", {
    resolve: () => ({
      name: "admin.studio.supervision.history",
      method: "GET",
      role: ADMIN,
      endpoint,
    }),
  });
  if (opts.textCodec !== null)
    container.set("realtimeService", { textFrameCodec: opts.textCodec });
  const context = {
    container,
    notificationsCenter: false,
    scheme: "https",
    type: opts.type,
    request: { headers: {}, body: {} },
  } as unknown as ContextType;
  const ctrl = new AdminApiController(context);
  let rendered: Rendered | null = null;
  Object.defineProperty(ctrl, "route", {
    value: { name: "admin.studio.supervision.history", variables: [] },
    configurable: true,
  });
  Object.defineProperty(ctrl, "query", { value: {}, configurable: true });
  Object.defineProperty(ctrl, "setContextJson", {
    value: () => undefined,
    configurable: true,
  });
  Object.defineProperty(ctrl, "renderJson", {
    value: (body: unknown, _s: unknown, headers: Record<string, unknown>) => {
      rendered = { via: "renderJson", body, headers };
    },
    configurable: true,
  });
  Object.defineProperty(ctrl, "renderResponse", {
    value: (
      text: string,
      _e: unknown,
      _s: unknown,
      headers: Record<string, unknown>,
    ) => {
      rendered = { via: "renderResponse", text, headers };
    },
    configurable: true,
  });
  const out = await RequestContext.run(
    {
      requestId: "d9-bytes",
      context,
      user: { id: "u1", identifier: "admin", roles: [ADMIN] },
    },
    () => ctrl.dispatch(),
  );
  if (opts.type === "websocket") return { via: "socket", body: out };
  if (rendered === null) throw new Error("aucun rendu");
  return rendered;
}

/** Ce que reçoit le client REST : le corps relu selon l'en-tête annoncé. */
function readRest(r: Rendered): unknown {
  if (r.via === "renderResponse")
    return textCodecForMarker(r.headers[BYTES_MARKER_HEADER] ?? null).decode(
      r.text,
    );
  if (r.via === "renderJson")
    return textCodecForMarker(r.headers[BYTES_MARKER_HEADER] ?? null).decode(
      JSON.stringify(r.body),
    );
  throw new Error("pas un rendu REST");
}

/** Ce que reçoit le client socket resté en texte : la trame passée par le codec. */
function readSocket(r: Rendered, codec: IFrameCodec): unknown {
  if (r.via !== "socket") throw new Error("pas un rendu socket");
  const wire = codec.encode(r.body);
  return codec.decode(wire);
}

describe("Plan d'administration — octets sur le REST (#618 D9)", () => {
  it("codec binaire activé : le corps porte `$bytes` et l'en-tête l'annonce", async () => {
    const r = await dispatch({
      type: "http",
      textCodec: JSON_BYTES_FRAME_CODEC,
    });
    expect(r.via).to.equal("renderResponse");
    if (r.via !== "renderResponse") return;
    expect(r.headers[BYTES_MARKER_HEADER]).to.equal(BYTES_MARKER);
    expect(r.headers["x-nodefony-instance"]).to.be.a("string");
    expect(r.text).to.include(`"${BYTES_MARKER}"`);
  });

  it("codec binaire activé : la valeur relue par GET ≡ celle livrée par la socket", async () => {
    const rest = readRest(
      await dispatch({ type: "http", textCodec: JSON_BYTES_FRAME_CODEC }),
    );
    const socket = readSocket(
      await dispatch({ type: "websocket", textCodec: JSON_BYTES_FRAME_CODEC }),
      JSON_BYTES_FRAME_CODEC,
    );
    expect(rest).to.deep.equal(payload());
    expect(rest).to.deep.equal(socket);
    const frame = (rest as { frame: unknown }).frame;
    expect(frame).to.be.instanceOf(Uint8Array);
  });

  it("sans codec binaire : rendu historique, aucun en-tête — et REST ≡ socket, octets déformés des deux côtés", async () => {
    const r = await dispatch({ type: "http", textCodec: JSON_FRAME_CODEC });
    expect(r.via).to.equal("renderJson");
    if (r.via !== "renderJson") return;
    expect(r.headers[BYTES_MARKER_HEADER]).to.equal(undefined);
    const socket = readSocket(
      await dispatch({ type: "websocket", textCodec: JSON_FRAME_CODEC }),
      JSON_FRAME_CODEC,
    );
    expect(readRest(r)).to.deep.equal(socket);
  });

  it("realtime absent : rendu historique, aucun en-tête", async () => {
    const r = await dispatch({ type: "http", textCodec: null });
    expect(r.via).to.equal("renderJson");
    if (r.via !== "renderJson") return;
    expect(r.headers[BYTES_MARKER_HEADER]).to.equal(undefined);
  });
});
