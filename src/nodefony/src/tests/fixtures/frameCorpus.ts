import {
  JSON_BYTES_FRAME_CODEC,
  JSON_FRAME_CODEC,
} from "../../realtime/jsonFrameCodec";
import { CBOR_FRAME_CODEC } from "../../realtime/codec/frameCodec";
import type { IFrameCodec } from "../../realtime/IFrameCodec";

/**
 * Le corpus des frames que le protocole émet réellement — un seul exemplaire,
 * lu par l'aller-retour (`frameCodecCorpus.test.ts`) ET par les octets de
 * référence (`frameGolden.test.ts`) : deux corpus divergeraient en silence.
 */

const welcome = {
  jsonrpc: "2.0",
  method: "realtime:welcome",
  params: {
    ts: 1770000000000,
    protocol: "jsonrpc-2.0",
    channels: ["chat:room-42"],
    methods: ["chat:history"],
    subscriptionAcks: true,
    identity: {
      type: "anonymous",
      authenticated: false,
      userIdentifier: "anonymous",
      roles: ["ROLE_ANONYMOUS"],
      scopes: [],
    },
    codec: "nodefony.jsonrpc.cbor.v1",
  },
};
const request = {
  jsonrpc: "2.0",
  id: 0,
  method: "chat:history",
  params: { room: "room-42", limit: 50 },
};
const requestStringId = {
  jsonrpc: "2.0",
  id: "c7.12",
  method: "chat:history",
  params: [1, -2.5, null, true],
};
const result = {
  jsonrpc: "2.0",
  id: 1,
  result: { messages: ["salut", "é ✓ 漢"] },
  meta: { requestId: "c7.12" },
};
const error = {
  jsonrpc: "2.0",
  id: 2,
  error: { code: -32000, message: "refusé", data: { status: 409 } },
};
const notification = {
  jsonrpc: "2.0",
  method: "chat:room-42",
  params: { text: "salut", n: 0, neg: -1, big: 2 ** 53 - 1 },
};
const bare = { jsonrpc: "2.0", method: "build:done" };

/** Frames sans octets : portées par tous les codecs. */
export const TEXT_CORPUS: Record<string, unknown> = {
  welcome,
  request,
  requestStringId,
  result,
  error,
  notification,
  bare,
};

/** Frames avec octets : seuls les codecs qui les portent (CBOR natif, JSON à convention). */
export const BYTES_CORPUS: Record<string, unknown> = {
  ...TEXT_CORPUS,
  bytesPayload: {
    jsonrpc: "2.0",
    method: "capteur:raw",
    params: new Uint8Array([0, 1, 127, 128, 255]),
  },
  nestedBytes: {
    jsonrpc: "2.0",
    method: "doc:42",
    params: {
      seq: 7,
      update: new Uint8Array([9, 8, 7]),
      list: [new Uint8Array(0)],
    },
  },
  bytesInResult: {
    jsonrpc: "2.0",
    id: 3,
    result: { echoed: { data: new Uint8Array([4, 2]) } },
  },
  bytesInErrorData: {
    jsonrpc: "2.0",
    id: 4,
    error: {
      code: -32000,
      message: "refusé",
      data: { raw: new Uint8Array([1]) },
    },
  },
};

/** Un codec livré, son corpus, et le nom de son fichier d'octets de référence. */
export interface IShippedCodec {
  readonly name: string;
  readonly codec: IFrameCodec;
  readonly corpus: Record<string, unknown>;
  /** Fichier sous `fixtures/golden/` — stable : il entre dans l'historique. */
  readonly golden: string;
}

/** Tous les codecs livrés. Un codec neuf s'ajoute ICI, et entre dans les deux tests. */
export const SHIPPED_CODECS: readonly IShippedCodec[] = [
  {
    name: "JSON natif",
    codec: JSON_FRAME_CODEC,
    corpus: TEXT_CORPUS,
    golden: "json.golden.txt",
  },
  {
    name: "JSON à convention d'octets",
    codec: JSON_BYTES_FRAME_CODEC,
    corpus: BYTES_CORPUS,
    golden: "json-bytes.golden.txt",
  },
  {
    name: "CBOR",
    codec: CBOR_FRAME_CODEC,
    corpus: BYTES_CORPUS,
    golden: "cbor.golden.txt",
  },
];
