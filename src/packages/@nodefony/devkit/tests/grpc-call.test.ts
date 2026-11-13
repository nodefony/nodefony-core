import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Ce que ces tests prouvent : le script d'appel du skill
 * `nodefony-add-grpc-service` parle le protocole Connect que sert une
 * application (POST JSON, `connect-protocol-version: 1`, message construit
 * champ par champ ou lu d'un fichier) et rend le CODE gRPC d'un refus, avec un
 * code de sortie distinct pour chaque cas.
 *
 * Le serveur est un faux, monté ici, qui répond dans la forme exacte de
 * Connect. La preuve contre une application réelle est faite à la main sur le
 * serveur de développement (appel servi, refus `unauthenticated`).
 */
const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "nodefony-add-grpc-service",
  "scripts",
  "call.mjs",
);

interface IScript {
  main(argv: string[]): Promise<number>;
}

async function charger(): Promise<IScript> {
  const mod: unknown = await import(pathToFileURL(SCRIPT).href);
  if (
    typeof mod !== "object" ||
    mod === null ||
    !("main" in mod) ||
    typeof mod.main !== "function"
  ) {
    throw new Error("call.mjs n'exporte pas main()");
  }
  const main = mod.main;
  return {
    main: async (argv) => {
      const code: unknown = await main(argv);
      if (typeof code !== "number")
        throw new Error("main() doit rendre un code");
      return code;
    },
  };
}

/** Le port d'un serveur à l'écoute. */
function portOf(srv: Server): number {
  const address = srv.address();
  if (address === null || typeof address === "string") {
    throw new Error("serveur sans port TCP");
  }
  return address.port;
}

interface IRecu {
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let base = "";
const recus: IRecu[] = [];
const dossier = mkdtempSync(path.join(tmpdir(), "nf-grpc-call-"));

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      recus.push({ url: req.url ?? "", headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      if (req.url === "/greet.v1.GreetService/Greet") {
        res.end(JSON.stringify({ greeting: "Bonjour" }));
        return;
      }
      res.statusCode = 401;
      res.end(JSON.stringify({ code: "unauthenticated", message: "refusé" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${portOf(server)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dossier, { recursive: true, force: true });
});

/** Fait taire la sortie du script et la rend. */
function capturer(): { sortie: string[]; erreur: string[] } {
  const sortie: string[] = [];
  const erreur: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((t) => {
    sortie.push(String(t));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((t) => {
    erreur.push(String(t));
    return true;
  });
  return { sortie, erreur };
}

describe("skill nodefony-add-grpc-service — script d'appel", () => {
  it("envoie un appel Connect unaire et rend le message (0)", async () => {
    const s = await charger();
    const { sortie } = capturer();
    const code = await s.main([
      "greet.v1.GreetService/Greet",
      "--field",
      "name=Ada",
      "--header",
      "authorization=Bearer a=b",
      "--url",
      base,
    ]);
    vi.restoreAllMocks();
    expect(code).toBe(0);
    expect(sortie.join("")).toContain('"greeting": "Bonjour"');
    const recu = recus.at(-1);
    expect(recu?.url).toBe("/greet.v1.GreetService/Greet");
    expect(recu?.headers["content-type"]).toBe("application/json");
    expect(recu?.headers["connect-protocol-version"]).toBe("1");
    // Coupé au PREMIER `=` : un jeton peut en contenir.
    expect(recu?.headers.authorization).toBe("Bearer a=b");
    expect(JSON.parse(recu?.body ?? "")).toEqual({ name: "Ada" });
  });

  it("lit le message dans un fichier", async () => {
    const fichier = path.join(dossier, "message.json");
    writeFileSync(fichier, JSON.stringify({ name: "Grace", tags: ["a"] }));
    const s = await charger();
    capturer();
    const code = await s.main([
      "greet.v1.GreetService/Greet",
      "--file",
      fichier,
      "--url",
      base,
    ]);
    vi.restoreAllMocks();
    expect(code).toBe(0);
    expect(JSON.parse(recus.at(-1)?.body ?? "")).toEqual({
      name: "Grace",
      tags: ["a"],
    });
  });

  it("nomme le code gRPC d'un refus (1)", async () => {
    const s = await charger();
    const { sortie } = capturer();
    const code = await s.main(["acme.v1.Vault/Open", "--url", base]);
    vi.restoreAllMocks();
    expect(code).toBe(1);
    expect(sortie.join("")).toContain("« unauthenticated » : refusé");
  });

  it("refuse une méthode mal formée, une option inconnue, --file avec --field (64)", async () => {
    const s = await charger();
    const { erreur } = capturer();
    expect(await s.main(["Greet"])).toBe(64);
    expect(await s.main(["a.v1.S/M", "--verbose"])).toBe(64);
    expect(
      await s.main(["a.v1.S/M", "--file", "x.json", "--field", "a=b"]),
    ).toBe(64);
    expect(await s.main(["a.v1.S/M", "--field", "sans-egal"])).toBe(64);
    vi.restoreAllMocks();
    expect(erreur.join("")).toContain("paquet.Service/Méthode");
  });

  it("dit comment démarrer l'application quand rien ne répond (69)", async () => {
    const s = await charger();
    const { erreur } = capturer();
    const fermee = createServer();
    await new Promise<void>((resolve) =>
      fermee.listen(0, "127.0.0.1", resolve),
    );
    const port = portOf(fermee);
    await new Promise<void>((resolve) => fermee.close(() => resolve()));
    const code = await s.main([
      "a.v1.S/M",
      "--url",
      `http://127.0.0.1:${port}`,
    ]);
    vi.restoreAllMocks();
    expect(code).toBe(69);
    expect(erreur.join("")).toContain("npx nodefony development");
  });
});
