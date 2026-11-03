/// <reference types="node" />
/**
 * Bloc d'en-têtes ENTIER des réponses types, sur serveur réel, en HTTP/1.1
 * (5151) ET en HTTP/2 (5152) — #727.
 *
 * Les en-têtes d'une réponse partent en un seul `writeHead` depuis la réserve de
 * `HttpResponse` ; le transport (`Server`, nosniff, frame, HSTS sur TLS) n'est
 * plus posé à l'entrée mais en tête de cette réserve, et le repli statique la
 * recopie à la première écriture de `serve-static`. Chaque chemin d'émission
 * (route, erreur, redirection, flux, fichier statique, sonde de santé) a donc
 * sa propre façon de porter ces en-têtes : ce banc les éprouve tous, et lit les
 * en-têtes BRUTS (`rawHeaders`) — un doublon que Node fusionnerait côté client
 * reste visible.
 */
import { expect } from "vitest";
import http from "node:http";
import http2 from "node:http2";

const HOST = "localhost";

type Kind = "route" | "static" | "health";
interface ICase {
  label: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  status: number;
  kind: Kind;
}

const CASES: ICase[] = [
  { label: "page HTML", path: "/", status: 200, kind: "route" },
  {
    label: "JSON",
    path: "/nodefony/test/als-test/scopes",
    status: 200,
    kind: "route",
  },
  {
    label: "404 sans route",
    path: "/api/nope-404",
    status: 404,
    kind: "route",
  },
  {
    label: "401 de zone",
    path: "/nodefony/kernel/api/config",
    status: 401,
    kind: "route",
  },
  {
    label: "redirection",
    path: "/nodefony/test/html/redirect",
    status: 302,
    kind: "route",
  },
  {
    label: "erreur après redirection (Location retiré)",
    path: "/nodefony/test/crash/after-redirect/async",
    status: 500,
    kind: "route",
  },
  {
    label: "fichier en flux",
    path: "/nodefony/test/html/stream",
    status: 200,
    kind: "route",
  },
  {
    label: "média par plage",
    path: "/nodefony/test/html/media",
    headers: { range: "bytes=0-9" },
    status: 206,
    kind: "route",
  },
  { label: "HEAD page", path: "/", method: "HEAD", status: 200, kind: "route" },
  {
    label: "fichier statique",
    path: "/favicon.ico",
    status: 200,
    kind: "static",
  },
  { label: "sonde liveness", path: "/livez", status: 200, kind: "health" },
];

const TRANSPORT = ["server", "x-content-type-options", "x-frame-options"];
const SECURITY = [
  "content-security-policy",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
];
const TRACE = ["x-request-id", "traceparent"];

/** Noms attendus selon le chemin d'émission. */
function expected(kind: Kind, tls: boolean): string[] {
  const names = [...TRANSPORT, "content-type"];
  if (tls) names.push("strict-transport-security");
  if (kind !== "health") names.push(...SECURITY);
  if (kind === "route") names.push(...TRACE);
  return names;
}

interface IReply {
  status: number;
  /** Noms en minuscules, dans l'ordre reçu, doublons compris. */
  names: string[];
  value: (name: string) => string | undefined;
}

function fromRaw(status: number, raw: string[]): IReply {
  const names: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const rawName = raw[i];
    const rawValue = raw[i + 1];
    if (rawName === undefined || rawValue === undefined) continue;
    const name = rawName.toLowerCase();
    if (name.startsWith(":")) continue;
    names.push(name);
    if (!values.has(name)) values.set(name, rawValue);
  }
  return { status, names, value: (n) => values.get(n) };
}

function h1(c: ICase): Promise<IReply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: 5151,
        method: c.method ?? "GET",
        path: c.path,
        headers: c.headers,
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve(fromRaw(res.statusCode ?? 0, res.rawHeaders)),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

let session: http2.ClientHttp2Session | null = null;
function h2(c: ICase): Promise<IReply> {
  session ??= http2.connect(`https://${HOST}:5152`, {
    rejectUnauthorized: false,
  });
  const s = session;
  return new Promise((resolve, reject) => {
    const req = s.request({
      ":method": c.method ?? "GET",
      ":path": c.path,
      ...c.headers,
    });
    let reply: IReply | null = null;
    req.on("response", (headers, _flags, raw) => {
      const list: string[] = raw ?? [];
      reply = fromRaw(Number(headers[":status"]), list);
    });
    req.on("data", () => {});
    req.on("end", () =>
      reply ? resolve(reply) : reject(new Error("aucune réponse")),
    );
    req.on("error", reject);
    req.end();
  });
}

afterAll(() => {
  session?.close();
  session = null;
});

for (const [proto, send, tls] of [
  ["HTTP/1.1", h1, false],
  ["HTTP/2", h2, true],
] as const) {
  describe(`Bloc d'en-têtes des réponses types — ${proto} (#727)`, () => {
    for (const c of CASES) {
      it(`${c.label} : statut, transport, sécurité, traçage — sans doublon`, async () => {
        const r = await send(c);
        expect(r.status, c.path).to.equal(c.status);
        for (const name of expected(c.kind, tls)) {
          expect(r.names, `${name} absent de ${c.path}`).to.include(name);
        }
        const repeated = r.names.filter(
          (n, i) => n !== "set-cookie" && r.names.indexOf(n) !== i,
        );
        expect(repeated, `doublons sur ${c.path}`).to.deep.equal([]);
      });
    }

    it("la valeur du transport est celle de la configuration (pas réécrite)", async () => {
      const r = await send(CASES[0] as ICase);
      expect(r.value("x-content-type-options")).to.equal("nosniff");
      expect(r.value("x-frame-options")).to.match(/^(SAMEORIGIN|DENY)$/);
    });

    it("erreur après redirection : plus de Location (#581)", async () => {
      const r = await send(CASES[5] as ICase);
      expect(r.names).to.not.include("location");
    });

    it("redirection : Location présent, une fois", async () => {
      const r = await send(CASES[4] as ICase);
      expect(r.names.filter((n) => n === "location")).to.have.length(1);
    });
  });
}
