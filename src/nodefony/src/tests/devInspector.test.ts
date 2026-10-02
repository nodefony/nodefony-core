/*
 *   Débogueur du serveur de DÉVELOPPEMENT.
 *
 *   Un `--inspect` posé pour `node` (ou dans `NODE_OPTIONS`) est pris par le premier
 *   process node de la chaîne — `npx`, `npm run`, le superviseur —, jamais par le
 *   serveur. La commande lit donc SA propre option et le serveur ouvre l'inspecteur
 *   lui-même. Le parseur est pur ; l'ouverture est éprouvée dans un vrai process.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isLoopbackHost, parseInspectArgs } from "../service/dev/devInspector";

describe("parseInspectArgs — l'option --inspect de la commande", () => {
  it("absente → null (aucun débogueur)", () => {
    assert.strictEqual(
      parseInspectArgs(["node", "nodefony", "development"]),
      null,
    );
  });

  it("--inspect seul → 127.0.0.1:9229, sans attente", () => {
    assert.deepStrictEqual(parseInspectArgs(["development", "--inspect"]), {
      host: "127.0.0.1",
      port: 9229,
      wait: false,
    });
  });

  it("--inspect-brk → attend le débogueur", () => {
    assert.deepStrictEqual(parseInspectArgs(["development", "--inspect-brk"]), {
      host: "127.0.0.1",
      port: 9229,
      wait: true,
    });
  });

  it("--inspect=<port> garde l'interface locale", () => {
    assert.deepStrictEqual(parseInspectArgs(["--inspect=9333"]), {
      host: "127.0.0.1",
      port: 9333,
      wait: false,
    });
  });

  it("--inspect=<hôte>:<port> — l'exposition est un choix explicite", () => {
    assert.deepStrictEqual(parseInspectArgs(["--inspect-brk=0.0.0.0:9444"]), {
      host: "0.0.0.0",
      port: 9444,
      wait: true,
    });
  });

  it("valeur invalide → erreur qui nomme l'option", () => {
    for (const bad of ["--inspect=abc", "--inspect=:9229", "--inspect=70000"]) {
      assert.throws(() => parseInspectArgs([bad]), /valeur invalide/u, bad);
    }
  });

  it("un homonyme n'est pas une demande d'inspection", () => {
    assert.strictEqual(
      parseInspectArgs(["--inspector", "--inspect-port=1"]),
      null,
    );
  });
});

describe("openDevInspector — dans un vrai process", () => {
  const helper = pathToFileURL(
    path.join(import.meta.dirname, "..", "service", "dev", "devInspector.ts"),
  ).href;

  it("ouvre l'inspecteur demandé et Node l'annonce", () => {
    const script =
      `const m = await import(${JSON.stringify(helper)});` +
      `const r = m.openDevInspector(m.parseInspectArgs(["development", "--inspect=0"]));` +
      `process.stdout.write(JSON.stringify(r));` +
      `(await import("node:inspector")).close();`;
    const res = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as { supported: boolean; url?: string };
    assert.strictEqual(out.supported, true, res.stdout);
    assert.match(out.url ?? "", /^ws:\/\/127\.0\.0\.1:\d+\//u);
    assert.match(res.stderr, /Debugger listening on ws:\/\/127\.0\.0\.1:/u);
  });

  // Les échecs se CONSTATENT et se rendent — le serveur de dev démarre quand
  // même, sans débogueur ouvert là où personne ne l'a demandé.
  const attempt = (
    req: string,
  ): { supported: boolean; reason?: string; url?: string } => {
    const script =
      `const m = await import(${JSON.stringify(helper)});` +
      `const inspector = await import("node:inspector");` +
      `const r = m.openDevInspector(${req});` +
      `process.stdout.write(JSON.stringify(r));` +
      `inspector.close();`;
    const res = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    assert.strictEqual(res.status, 0, res.stderr);
    return JSON.parse(res.stdout) as {
      supported: boolean;
      reason?: string;
      url?: string;
    };
  };

  it("hôte introuvable → non ouvert, dit comme tel (Node ne lève pas)", () => {
    const r = attempt(
      `{ host: "nf-introuvable.invalid", port: 0, wait: false }`,
    );
    assert.deepStrictEqual(r, {
      supported: false,
      reason: "inspecteur non ouvert",
    });
  });

  it("port hors plage (requête non passée par le parseur) → la raison de Node, pas une exception", () => {
    const r = attempt(`{ host: "127.0.0.1", port: 70000, wait: false }`);
    assert.strictEqual(r.supported, false);
    assert.match(r.reason ?? "", /port/iu);
  });

  it("un inspecteur déjà ouvert (node --inspect direct) est conservé tel quel", () => {
    const script =
      `const inspector = await import("node:inspector");` +
      `inspector.open(0, "127.0.0.1", false);` +
      `const before = inspector.url();` +
      `const m = await import(${JSON.stringify(helper)});` +
      `const r = m.openDevInspector({ host: "0.0.0.0", port: 0, wait: false });` +
      `process.stdout.write(JSON.stringify({ before, r }));` +
      `inspector.close();`;
    const res = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    assert.strictEqual(res.status, 0, res.stderr);
    const { before, r } = JSON.parse(res.stdout) as {
      before: string;
      r: { supported: boolean; url: string };
    };
    // Pas de seconde ouverture sur 0.0.0.0 : l'URL est celle de la boucle locale.
    assert.deepStrictEqual(r, { supported: true, url: before });
  });
});

describe("--inspect — la valeur après un ESPACE (forme annoncée par l'aide)", () => {
  // L'aide déclare `--inspect [host:port]` : commander, et l'utilisateur,
  // séparent par un espace. La valeur était jetée en silence (red-team #20).
  it("`--inspect 0.0.0.0:9330` est lu, pas remplacé par le défaut", () => {
    assert.deepStrictEqual(
      parseInspectArgs(["debug", "--inspect", "0.0.0.0:9330"]),
      { host: "0.0.0.0", port: 9330, wait: false },
    );
  });

  it("`--inspect-brk 9330` : port seul", () => {
    assert.deepStrictEqual(
      parseInspectArgs(["debug", "--inspect-brk", "9330"]),
      {
        host: "127.0.0.1",
        port: 9330,
        wait: true,
      },
    );
  });

  it("une option suivante n'est pas avalée comme valeur", () => {
    assert.deepStrictEqual(
      parseInspectArgs(["development", "--inspect", "--no-watch"]),
      { host: "127.0.0.1", port: 9229, wait: false },
    );
  });

  it("une valeur invalide après l'espace lève (jamais ignorée)", () => {
    assert.throws(() => parseInspectArgs(["debug", "--inspect", "abc"]));
  });
});

describe("isLoopbackHost — un inspecteur hors boucle locale exécute le code de qui le joint", () => {
  it.each(["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"])(
    "%s est local",
    (h) => assert.strictEqual(isLoopbackHost(h), true),
  );
  it.each(["0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "example.test"])(
    "%s est EXPOSÉ",
    (h) => assert.strictEqual(isLoopbackHost(h), false),
  );
});
