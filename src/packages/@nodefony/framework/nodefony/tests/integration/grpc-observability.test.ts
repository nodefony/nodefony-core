/// <reference types="node" />
//
// ─── gRPC : ce que voient la ligne d'accès et le traçage (#695, ADR-0026 D10) ─
//
// Décor : serveur de dev (skill `nodefony-start-server`). La preuve est lue sur
// l'abonné RÉEL du canal `nodefony.http.request`, dans le process du serveur
// (`/nodefony/test/trace-channel`, `TraceChannelController`) : le message
// `asyncEnd` de chaque appel, retrouvé par son `X-Request-Id`.
//
// Critères 36, 37 et 40 : système, méthode, code et nom de l'appel, lus au
// `close` ; `statusCode` reste le statut HTTP — celui que l'adaptateur a écrit
// en protocole Connect (critère 38). Les cas de l'essai `d10-wire.mjs` :
// unaire (succès, exception banale, `ConnectError`, échéance du client,
// abandon du client) sur les trois protocoles, HTTP/1.1 et HTTP/2 ; flux (fin
// normale, abandon) sur HTTP/2.
//
// Piège assumé (ADR-0026 D10 point 2) : quand l'échéance du client expire, sa
// coupure et le minuteur du serveur se croisent — le serveur journalise 4 ou
// 1, en HTTP/1.1 comme en HTTP/2 (connect-node coupe en RST INTERNAL_ERROR,
// lu « client parti »). Ce cas n'exige pas 4.
//
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { Code, createClient, type Transport } from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcTransport,
  createGrpcWebTransport,
} from "@connectrpc/connect-node";
import { EchoService } from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/echo_pb.js";
import { IS_PROD_TARGET } from "../../../../http/nodefony/tests/helpers/targetEnv";

const TLS = { rejectUnauthorized: false };
const H1 = "http://127.0.0.1:5151";
/** h2c sur l'app de dev ; TLS quand la cible est une production. */
const H2 = IS_PROD_TARGET ? "https://127.0.0.1:5152" : "http://127.0.0.1:5153";
const H2_OPTIONS = IS_PROD_TARGET ? { nodeOptions: TLS } : {};
const PROBE = `${H1}/nodefony/test/trace-channel`;
const SAY = "nodefony.test.v1.EchoService/Say";

type Protocol = "grpc" | "grpc-web" | "connect";
interface ICase {
  label: string;
  protocol: Protocol;
  h2: boolean;
  transport: () => Transport;
}

const CASES: ICase[] = [
  {
    label: "HTTP/2 gRPC",
    protocol: "grpc",
    h2: true,
    transport: () => createGrpcTransport({ baseUrl: H2, ...H2_OPTIONS }),
  },
  {
    label: "HTTP/2 gRPC-Web",
    protocol: "grpc-web",
    h2: true,
    transport: () =>
      createGrpcWebTransport({
        baseUrl: H2,
        httpVersion: "2",
        ...H2_OPTIONS,
      }),
  },
  {
    label: "HTTP/2 Connect",
    protocol: "connect",
    h2: true,
    transport: () =>
      createConnectTransport({
        baseUrl: H2,
        httpVersion: "2",
        ...H2_OPTIONS,
      }),
  },
  {
    label: "5151 gRPC-Web",
    protocol: "grpc-web",
    h2: false,
    transport: () =>
      createGrpcWebTransport({ baseUrl: H1, httpVersion: "1.1" }),
  },
  {
    label: "5151 Connect",
    protocol: "connect",
    h2: false,
    transport: () =>
      createConnectTransport({ baseUrl: H1, httpVersion: "1.1" }),
  },
];

/** Ce que la sonde a copié du message `asyncEnd`. */
interface ISeen {
  statusCode: number | null;
  error: string | null;
  rpc: {
    system: string;
    method: string;
    code: number | null;
    codeName: string | null;
  } | null;
}

function isSeen(value: unknown): value is ISeen & { event: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    "rpc" in value &&
    "statusCode" in value
  );
}

/**
 * Attend le message `asyncEnd` de la requête `id` — un FAIT : la fin est
 * publiée au `close`, qui peut suivre de peu la réponse lue par le client.
 */
async function traceOf(id: string): Promise<ISeen> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = await fetch(`${PROBE}/events`);
    const events: unknown = await r.json();
    if (typeof events === "object" && events !== null) {
      const list: unknown = Reflect.get(events, id);
      if (Array.isArray(list)) {
        const end: unknown = list.find(
          (e: unknown) => isSeen(e) && e.event === "asyncEnd",
        );
        if (isSeen(end)) return end;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`aucune fin publiée pour ${id}`);
}

/** Un appel qui porte un `X-Request-Id` connu ; son issue est ignorée. */
async function traced(
  call: (headers: Record<string, string>) => Promise<unknown>,
  extra: Record<string, string> = {},
): Promise<ISeen> {
  const id = randomUUID();
  await call({ "x-request-id": id, ...extra }).catch(() => undefined);
  return traceOf(id);
}

/** Le statut HTTP d'un appel en erreur : 200 en gRPC, celui de Connect sinon. */
function httpStatus(c: ICase, connectStatus: number): number {
  return c.protocol === "connect" ? connectStatus : 200;
}

beforeAll(async () => {
  const r = await fetch(`${PROBE}/arm`);
  expect(r.status).to.equal(200);
});

afterAll(async () => {
  await fetch(`${PROBE}/disarm`);
});

describe("gRPC — ligne d'accès et traçage d'un appel (critères 36 à 40, ADR-0026 D10)", () => {
  for (const c of CASES) {
    it(`${c.label} : succès → 0 OK, système du fil, méthode de la route, statut 200`, async () => {
      const client = createClient(EchoService, c.transport());
      const seen = await traced((headers) =>
        client.say({ sentence: "x" }, { headers }),
      );
      expect(seen.rpc).to.deep.equal({
        system: c.protocol,
        method: SAY,
        code: 0,
        codeName: "OK",
      });
      expect(seen.statusCode).to.equal(200);
      expect(seen.error).to.equal(null);
    });

    it(`${c.label} : exception banale → 13 INTERNAL, la cause portée (une erreur), statut HTTP du fil`, async () => {
      const client = createClient(EchoService, c.transport());
      const seen = await traced(
        (headers) => client.say({ sentence: "x" }, { headers }),
        { "x-fail": "plain" },
      );
      expect(seen.rpc?.code).to.equal(Code.Internal);
      expect(seen.rpc?.codeName).to.equal("INTERNAL");
      expect(seen.error).to.equal("panne voulue (x-fail)");
      expect(seen.statusCode).to.equal(httpStatus(c, 500));
    });

    it(`${c.label} : ConnectError voulue → son code, aucune cause`, async () => {
      const client = createClient(EchoService, c.transport());
      const seen = await traced((headers) => client.fail({}, { headers }));
      expect(seen.rpc?.code).to.equal(Code.FailedPrecondition);
      expect(seen.rpc?.codeName).to.equal("FAILED_PRECONDITION");
      expect(seen.error).to.equal(null);
      expect(seen.statusCode).to.equal(httpStatus(c, 400));
    });

    it(`${c.label} : le client abandonne → 1 CANCELLED`, async () => {
      const client = createClient(EchoService, c.transport());
      const seen = await traced((headers) => {
        const abort = new AbortController();
        setTimeout(() => abort.abort(), 150);
        return client.stall(
          { block: true, witness: randomUUID() },
          { headers, signal: abort.signal },
        );
      });
      expect(seen.rpc?.code).to.equal(Code.Canceled);
      expect(seen.rpc?.codeName).to.equal("CANCELLED");
    });

    it(`${c.label} : échéance du client → 4 ou 1 (course), jamais 13`, async () => {
      const client = createClient(EchoService, c.transport());
      const seen = await traced((headers) =>
        client.stall(
          { block: true, witness: randomUUID() },
          { headers, timeoutMs: 200 },
        ),
      );
      // Course (ADR-0026 D10 point 2) : le client coupe au même instant que
      // l'échéance du serveur. Coupure d'abord : le client est parti (1),
      // quel que soit le code de son RST_STREAM (connect-node : INTERNAL_ERROR).
      expect(seen.rpc?.code).to.be.oneOf([
        Code.DeadlineExceeded,
        Code.Canceled,
      ]);
    });

    if (!c.h2) continue;

    it(`${c.label} : flux bidirectionnel fini normalement → 0`, async () => {
      const client = createClient(EchoService, c.transport());
      const seen = await traced(async (headers) => {
        const replies = client.converse(
          (async function* () {
            yield { sentence: "un" };
            yield { sentence: "deux" };
          })(),
          { headers },
        );
        for await (const _ of replies) {
          // tout lire
        }
      });
      expect(seen.rpc?.method).to.equal(
        "nodefony.test.v1.EchoService/Converse",
      );
      expect(seen.rpc?.code).to.equal(0);
    });

    it(`${c.label} : flux serveur abandonné par le client → 1`, async () => {
      const client = createClient(EchoService, c.transport());
      const seen = await traced(async (headers) => {
        const abort = new AbortController();
        let n = 0;
        for await (const _ of client.watch(
          { burst: 0, bytes: 8, follow: true, witness: "" },
          { headers, signal: abort.signal },
        )) {
          if (++n === 3) abort.abort();
        }
      });
      expect(seen.rpc?.code).to.equal(Code.Canceled);
    });
  }

  it("hors RPC : `rpc` vaut null sur une route HTTP", async () => {
    const id = randomUUID();
    await fetch(`${PROBE}/ok`, { headers: { "x-request-id": id } });
    const seen = await traceOf(id);
    expect(seen.rpc).to.equal(null);
  });
});
