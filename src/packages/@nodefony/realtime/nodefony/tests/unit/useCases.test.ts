import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "@nodefony/framework";
import { RealtimeController } from "../../src/server/RealtimeController";
import { RealtimeChannel } from "../../decorators/realtimeDecorators";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";

/**
 * Les exemples de `docs/cas-d-usage.md` vivent une seule fois, en fichiers :
 * le serveur (`tests/fixtures/use-cases/<cas>.ts`, exécuté), le navigateur
 * (`<cas>.client.ts`, typé) et le test (`tests/unit/use-cases/<cas>.test.ts`,
 * exécuté). Ce fichier compare la page à ces fichiers, pour qu'un exemple
 * corrigé d'un côté ne diverge pas de l'autre en silence.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "fixtures", "use-cases");
const testsDir = path.join(here, "use-cases");
const pagePath = path.join(here, "..", "..", "..", "docs", "cas-d-usage.md");

let open: IRealtimeHarness<RealtimeController>[] = [];

async function connect<C extends RealtimeController>(
  make: (ctx: ConstructorParameters<typeof RealtimeController>[1]) => C,
  user: string,
): Promise<IRealtimeHarness<C>> {
  const h = createRealtimeHarness(make, {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  for (const h of open) h.close();
  open = [];
  getRealtimeHub().clear();
});

describe("#700 — un motif décoré pose la POLITIQUE, jamais la fabrique", () => {
  // Le skill livré montrait `@RealtimeChannel("room:*", { allow })` seul : la
  // politique couvre toute la famille, mais une fabrique décorée n'est trouvée
  // que par son nom EXACT — `room:42` n'en a pas. Sans `createRealtimeChannel`,
  // l'abonnement est refusé, et un test qui ne s'abonne jamais reste vert.
  class PolicyOnly extends RealtimeController {
    constructor(ctx: ConstructorParameters<typeof RealtimeController>[1]) {
      super("PolicyOnly", ctx);
    }
    @RealtimeChannel("room:*", { allow: () => true })
    room(): () => void {
      return () => {};
    }
  }
  class WithFactory extends PolicyOnly {
    override createRealtimeChannel(channel: string): (() => void) | null {
      return channel.startsWith("room:") ? () => {} : null;
    }
  }

  it("sans fabrique, `room:42` est refusé `unknown`", async () => {
    const h = await connect((ctx) => new PolicyOnly(ctx), "alice");
    await h.subscribe("room:42");
    await flush();
    expect(h.subscriptions()).to.deep.equal([]);
    expect(h.denials().map((d) => d.reason)).to.deep.equal(["unknown"]);
  });

  it("avec `createRealtimeChannel`, `room:42` est servi et `allow` tranche", async () => {
    const h = await connect((ctx) => new WithFactory(ctx), "alice");
    await h.subscribe("room:42");
    await flush();
    expect(h.subscriptions()).to.deep.equal(["room:42"]);
  });
});

/**
 * Ce qu'un import du dépôt devient dans la page : la forme qu'écrit une
 * application, qui pose le test à côté de son contrôleur.
 */
function asShown(source: string): string {
  return source
    .replaceAll('"../../../../index"', '"@nodefony/realtime"')
    .replaceAll('"../../../testing/index"', '"@nodefony/realtime/testing"')
    .replaceAll(/"\.\.\/\.\.\/fixtures\/use-cases\/([\w-]+)"/g, '"./$1"')
    .replaceAll(
      /"\.\.\/\.\.\/fixtures\/(entity|service)\/([\w-]+)"/g,
      '"../$1/$2"',
    );
}

/**
 * Une liste d'import mise sur une ligne : le chemin réécrit est plus court, et le
 * formateur replie dans la page ce qu'il déplie dans le fichier.
 */
function flatImports(source: string): string {
  return source.replaceAll(
    /import (type )?\{([^}]*)\}/g,
    (_match, kind: string | undefined, names: string) =>
      `import ${kind ?? ""}{ ${names
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n !== "")
        .join(", ")} }`,
  );
}

describe("#726 — la page montre exactement les exemples exécutés", () => {
  // Fins de ligne normalisées : un poste Windows extrait la page en CRLF.
  const lf = (text: string): string => text.replaceAll("\r\n", "\n");
  const page = lf(readFileSync(pagePath, "utf8"));
  const names: string[] = [];
  const shown = new Map<string, string>();
  // Le formateur pose une ligne vide entre le marqueur et le bloc.
  for (const m of page.matchAll(
    /<!-- example: ([\w.-]+\.ts) -->\n\n?```ts\n([\s\S]*?)```/g,
  )) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) continue;
    names.push(name);
    shown.set(name, body);
  }
  const files = new Map<string, string>();
  for (const dir of [fixturesDir, testsDir]) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      files.set(name, path.join(dir, name));
    }
  }
  const servers = [...files.keys()].filter(
    (n) => !n.endsWith(".client.ts") && !n.endsWith(".test.ts"),
  );

  it("chaque exemple figure une fois dans la page, et la page n'en montre pas d'autre", () => {
    expect(names.sort()).to.deep.equal([...files.keys()].sort());
  });

  it("chaque cas montre son serveur, son navigateur ET son test", () => {
    for (const server of servers) {
      const base = server.slice(0, -".ts".length);
      expect(files.has(`${base}.client.ts`), `${base}.client.ts`).toBe(true);
      expect(files.has(`${base}.test.ts`), `${base}.test.ts`).toBe(true);
    }
  });

  // Une socket ne sert QUE les canaux du contrôleur qui porte sa route
  // WebSocket (`RealtimeController.onHandshake` lit les décorateurs de `this`).
  // Le harnais instancie la classe sans passer par le routeur : il ne voit pas
  // un client qui ouvre la socket d'un AUTRE contrôleur — vécu, la page visait
  // `/api/live/realtime` pour les sept cas, où `room:*` n'existe pas.
  it.each(servers)(
    "%s : la socket que vise le client est servie par le contrôleur du cas",
    async (name) => {
      const servedBy = async (file: string): Promise<RegExp[]> => {
        const mod: Record<string, unknown> = await import(
          pathToFileURL(file).href
        );
        // Gardées `unknown` : une classe ABSTRAITE (`RealtimeController`) n'est
        // pas un constructeur au sens de `getRoutesForController`.
        const owners = new Set<unknown>(
          Object.values(mod).filter(
            (value) =>
              typeof value === "function" &&
              value.prototype instanceof RealtimeController,
          ),
        );
        return Router.routes
          .filter(
            (r) =>
              owners.has(r.controller) &&
              r.methodsSet?.has("WEBSOCKET") === true,
          )
          .flatMap((r) => (r.pattern ? [r.pattern] : []));
      };
      const base = name.slice(0, -".ts".length);
      const own = await servedBy(files.get(name) ?? "");
      // Sans contrôleur (`user:<id>`, fourni par toute socket) : n'importe
      // laquelle des sockets des cas fait l'affaire.
      const sockets =
        own.length > 0
          ? own
          : (
              await Promise.all(
                servers.map((s) => servedBy(files.get(s) ?? "")),
              )
            ).flat();
      expect(
        sockets.length,
        `${name} : aucune route WEBSOCKET`,
      ).toBeGreaterThan(0);
      const client = lf(
        readFileSync(files.get(`${base}.client.ts`) ?? "", "utf8"),
      );
      const urls = [...client.matchAll(/url: "([^"]+)"/g)].map(
        (m) => new URL(m[1] ?? "", "https://app.example").pathname,
      );
      expect(urls.length, `${base}.client.ts : aucune url`).toBeGreaterThan(0);
      for (const url of urls) {
        expect(
          sockets.some((p) => p.test(url)),
          `${base}.client.ts vise ${url}, qu'aucune route WEBSOCKET du cas ne sert`,
        ).toBe(true);
      }
    },
  );

  it.each([...files.keys()])(
    "%s : le bloc de la page est le fichier du dépôt",
    (name) => {
      const file = files.get(name) ?? "";
      expect(flatImports(shown.get(name) ?? "")).toBe(
        flatImports(asShown(lf(readFileSync(file, "utf8")))),
      );
    },
  );
});
