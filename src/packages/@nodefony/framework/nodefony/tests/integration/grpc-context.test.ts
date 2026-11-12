/// <reference types="node" />
//
// ─── gRPC : contexte de requête et identité dans un flux (#695, lot 5) ──────
//
// ADR-0026 D6. Décor : serveur de dev (skill `nodefony-start-server`) —
// 5151 HTTP/1.1, 5152 HTTP/2 + TLS, 5153 h2c (développement). Méthodes
// `GuardedEchoService.Follow` (flux serveur SOURD : il ignore son signal) et
// `Relay` (bidirectionnel), sous la zone JWT `test-grpc-member` : chaque
// message relève l'identité, le `requestId` et l'exemplaire du service de
// portée `request` (`RequestProbe`) résolu À CE MESSAGE.
//
// - Critère 5 : la bulle de la requête est vue dans un flux serveur et un flux
//   bidirectionnel, pas seulement en unaire.
// - Critère 29 : la même chose au dernier message d'un flux de 2 minutes, et
//   plus aucun scope `request` ouvert ensuite.
// - Critère 31 : un jeton révoqué pendant l'abonnement termine le flux en 16,
//   au plus le message déjà en vol après — le registre du noyau appelle
//   `StreamLifecycle.revoke`, jamais une coupure du transport.
//
// Débrancher : `http-kernel.ts#HttpKernel.watchStream` → `entry.close()` au
// lieu de `entry.revoke()` (coupure : le client lit 14 ou 13, jamais 16).
//
import { expect } from "vitest";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcTransport,
} from "@connectrpc/connect-node";
import { GuardedEchoService } from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/guarded_pb.js";
import { IS_PROD_TARGET } from "../../../../http/nodefony/tests/helpers/targetEnv";
import { drainTo } from "../../../../http/nodefony/tests/helpers/scopeDrain";
import { accessToken } from "../support/accessToken";

const TLS = { rejectUnauthorized: false };
const H1 = "http://127.0.0.1:5151";
const H2_TLS = "https://127.0.0.1:5152";
const H2C = "http://127.0.0.1:5153";

interface IDecor {
  label: string;
  transport(): Transport;
  /** Flux bidirectionnel possible (HTTP/2 : Connect sur HTTP/1.1 est semi-duplex). */
  duplex: boolean;
}

const DECORS: IDecor[] = [
  {
    label: "5152 HTTP/2+TLS gRPC",
    transport: () => createGrpcTransport({ baseUrl: H2_TLS, nodeOptions: TLS }),
    duplex: true,
  },
  {
    label: "5151 HTTP/1.1 Connect",
    transport: () =>
      createConnectTransport({ baseUrl: H1, httpVersion: "1.1" }),
    duplex: false,
  },
];
if (!IS_PROD_TARGET) {
  DECORS.unshift({
    label: "5153 h2c gRPC",
    transport: () => createGrpcTransport({ baseUrl: H2C }),
    duplex: true,
  });
}

const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

/** Ce que chaque message relève dans la bulle de la requête. */
interface IWitness {
  identifier: string;
  requestId: string;
  probe: number;
}

/** Un seul relevé pour tout le flux, celui de SA requête, de SON identité. */
function expectSameBubble(
  label: string,
  messages: IWitness[],
  requestId: string | null,
): void {
  expect(messages.length, `${label} : messages reçus`).to.be.greaterThan(1);
  const first = messages[0];
  expect(first?.identifier, `${label} : identité`).to.equal("user");
  expect(first?.requestId, `${label} : requestId = X-Request-Id`).to.equal(
    requestId,
  );
  expect(first?.probe, `${label} : service request résolu`).to.be.greaterThan(
    0,
  );
  for (const m of messages) {
    expect(
      { identifier: m.identifier, requestId: m.requestId, probe: m.probe },
      `${label} : même bulle à chaque message`,
    ).to.deep.equal({
      identifier: first?.identifier,
      requestId: first?.requestId,
      probe: first?.probe,
    });
  }
}

/** Code d'une `ConnectError`, `null` si le flux a fini sans erreur. */
async function drain<T>(
  stream: AsyncIterable<T>,
  each: (message: T) => void | Promise<void>,
): Promise<Code | null> {
  try {
    for await (const message of stream) await each(message);
    return null;
  } catch (e) {
    return ConnectError.from(e).code;
  }
}

async function openScopes(): Promise<number> {
  const r = await fetch(`${H1}/nodefony/test/als-test/scopes`);
  const body: unknown = await r.json();
  return typeof body === "object" && body !== null && "requestScopes" in body
    ? Number(body.requestScopes)
    : Number.NaN;
}

/** `jti` d'un JWT (charge utile, sans vérification : c'est le nôtre). */
function jtiOf(token: string): string {
  const payload: unknown = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
  );
  const jti =
    typeof payload === "object" && payload !== null && "jti" in payload
      ? payload.jti
      : undefined;
  if (typeof jti !== "string") throw new Error("jeton sans jti");
  return jti;
}

/** Révoque le jeton, puis la passe de re-validation (route de décor). */
async function revoke(token: string): Promise<void> {
  const r = await fetch(
    `${H1}/nodefony/test/sse/revoke?jti=${encodeURIComponent(jtiOf(token))}`,
  );
  const body: unknown = await r.json();
  expect(body, "jeton révoqué par le décor").to.deep.equal({ revoked: true });
}

describe("gRPC — contexte de requête dans un flux (critère 5, ADR-0026 D6)", () => {
  for (const decor of DECORS) {
    it(`${decor.label} : flux serveur — identité, requestId et service request identiques à chaque message`, async () => {
      const token = await accessToken("user");
      const client = createClient(GuardedEchoService, decor.transport());
      const seen: { requestId: string | null } = { requestId: null };
      const messages: IWitness[] = [];
      const code = await drain(
        client.follow(
          { count: 4, intervalMs: 50 },
          {
            headers: bearer(token),
            onHeader: (h) => (seen.requestId = h.get("x-request-id")),
          },
        ),
        (m) => void messages.push(m),
      );
      expect(code).to.equal(null);
      expect(messages).to.have.length(4);
      expectSameBubble(decor.label, messages, seen.requestId);
    });

    if (!decor.duplex) continue;
    it(`${decor.label} : flux bidirectionnel — la même bulle à chaque écho`, async () => {
      const token = await accessToken("user");
      const client = createClient(GuardedEchoService, decor.transport());
      const seen: { requestId: string | null } = { requestId: null };
      async function* sentences() {
        for (const sentence of ["un", "deux", "trois"]) {
          await new Promise((r) => setTimeout(r, 30));
          yield { sentence };
        }
      }
      const messages: IWitness[] = [];
      const code = await drain(
        client.relay(sentences(), {
          headers: bearer(token),
          onHeader: (h) => (seen.requestId = h.get("x-request-id")),
        }),
        (m) => void messages.push(m),
      );
      expect(code).to.equal(null);
      expect(messages).to.have.length(3);
      expectSameBubble(decor.label, messages, seen.requestId);
    });
  }

  it("CONTRÔLE : sans jeton, le pare-feu refuse le flux — 16", async () => {
    const decor = DECORS[0];
    if (decor === undefined) throw new Error("aucun décor");
    const client = createClient(GuardedEchoService, decor.transport());
    const code = await drain(
      client.follow({ count: 1, intervalMs: 0 }),
      () => undefined,
    );
    expect(code).to.equal(Code.Unauthenticated);
  });
});

describe("gRPC — flux de 2 minutes (critère 29, ADR-0026 D6)", () => {
  const LONG_MS = 120_000;
  const STEP_MS = 10_000;

  it(
    "au DERNIER message : même identité, même requestId, même exemplaire du service request ; aucun scope ouvert ensuite",
    async () => {
      const base = await openScopes();
      const token = await accessToken("user");
      const decor = DECORS[0];
      if (decor === undefined) throw new Error("aucun décor");
      const client = createClient(GuardedEchoService, decor.transport());
      const seen: { requestId: string | null } = { requestId: null };
      const messages: IWitness[] = [];
      const code = await drain(
        client.follow(
          { count: LONG_MS / STEP_MS + 1, intervalMs: STEP_MS },
          {
            headers: bearer(token),
            onHeader: (h) => (seen.requestId = h.get("x-request-id")),
          },
        ),
        (m) => void messages.push(m),
      );
      expect(code, "flux mené à son terme").to.equal(null);
      expect(messages).to.have.length(LONG_MS / STEP_MS + 1);
      expectSameBubble(decor.label, messages, seen.requestId);
      // Le scope de la requête du flux est refermé avec lui.
      expect(await drainTo(openScopes, base, 1)).to.be.lessThan(1);
    },
    LONG_MS + 60_000,
  );
});

describe("gRPC — jeton révoqué pendant un abonnement (critère 31, ADR-0026 D6)", () => {
  for (const decor of DECORS) {
    it(`${decor.label} : fin en 16 UNAUTHENTICATED, au plus le message déjà en vol après`, async () => {
      const token = await accessToken("user");
      const client = createClient(GuardedEchoService, decor.transport());
      let received = 0;
      let afterRevocation: number | null = null;
      const code = await drain(
        // Gestionnaire SOURD, 100 messages : sans la révocation au format du
        // protocole, il irait au bout.
        client.follow(
          { count: 100, intervalMs: 50 },
          { headers: bearer(token) },
        ),
        async () => {
          received += 1;
          if (afterRevocation !== null) afterRevocation += 1;
          if (received === 3) {
            await revoke(token);
            afterRevocation = 0;
          }
        },
      );
      expect(code, `${decor.label} : statut lu par le client`).to.equal(
        Code.Unauthenticated,
      );
      expect(
        afterRevocation,
        `${decor.label} : messages reçus après la révocation`,
      ).to.be.at.most(1);
    });
  }

  it("CONTRÔLE : un jeton VIVANT garde son flux à la re-validation", async () => {
    const token = await accessToken("user");
    const other = await accessToken("user");
    const decor = DECORS[0];
    if (decor === undefined) throw new Error("aucun décor");
    const client = createClient(GuardedEchoService, decor.transport());
    let received = 0;
    const code = await drain(
      client.follow({ count: 6, intervalMs: 50 }, { headers: bearer(token) }),
      async () => {
        received += 1;
        // Un AUTRE jeton du même compte révoqué : celui du flux reste valable.
        if (received === 2) await revoke(other);
      },
    );
    expect(code).to.equal(null);
    expect(received).to.equal(6);
  });
});
