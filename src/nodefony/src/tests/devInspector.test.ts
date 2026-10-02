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
import { parseInspectArgs } from "../service/dev/devInspector";

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
});
