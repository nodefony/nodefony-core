// Les types d'un paquet du cœur se résolvent-ils DEPUIS SON TARBALL ?
//
// Le dépôt lit ses paquets du cœur en source, par la condition d'export
// `nodefony-source` que déclarent ses seuls tsconfigs. Il ne passe donc jamais
// par le chemin de l'installeur — `types` → `.d.ts` —, et un défaut sur ce
// chemin reste invisible à toutes ses suites. Vécu : six paquets ont publié des
// semaines un `types` vers une source absente du tarball (`TS7016` chez
// l'installeur), rattrapé par une réécriture au pack que rien ne contrôlait.
//
// Ce test fabrique le tarball par la MÊME commande que `pack-all.mjs` — qui ne
// réécrit plus rien : le manifeste publié est celui du dépôt —, le dépaquette
// dans un projet jetable HORS du dépôt (aucune remontée vers ses
// `node_modules`), et typecheck un `import` comme le ferait une application
// générée : `moduleResolution: Bundler`, sans `customConditions`.

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");
const HTTP = path.join(RACINE, "src", "packages", "@nodefony", "http");

/** Le lanceur de `tsgo`, exécuté par ce Node — pas de `.cmd` sous Windows. */
function lanceurTsgo() {
  const require = createRequire(path.join(RACINE, "package.json"));
  const manifeste = require.resolve("@typescript/native-preview/package.json");
  return path.join(path.dirname(manifeste), "bin", "tsgo");
}

const jetables = [];
afterAll(() => {
  for (const d of jetables) fs.rmSync(d, { recursive: true, force: true });
});

describe("types publiés — résolus depuis le tarball, comme chez l'installeur", () => {
  it("un `import` de @nodefony/http typecheck contre le tarball réel", () => {
    // Pas de saut : un vert sans `.d.ts` bâtis serait un vert sans valeur. La
    // forge bâtit avant `test:release` (release.yml, release-smoke.yml).
    const dts = path.join(HTTP, "dist", "types", "index.d.ts");
    expect(
      fs.existsSync(dts),
      `${dts} absent — lancer \`npm run build\` d'abord`,
    ).toBe(true);

    const decor = fs.mkdtempSync(path.join(os.tmpdir(), "nf-tarball-types-"));
    jetables.push(decor);

    // La commande de `pack-all.mjs`, à l'identique.
    const sortie = execSync(
      `npm pack --silent --ignore-scripts --pack-destination "${decor}"`,
      { cwd: HTTP, encoding: "utf8" },
    );
    const tgz = sortie
      .split("\n")
      .map((l) => l.trim())
      .findLast(Boolean);
    expect(tgz?.endsWith(".tgz"), `npm pack a rendu « ${tgz} »`).toBe(true);

    const app = path.join(decor, "app");
    const scope = path.join(app, "node_modules", "@nodefony");
    fs.mkdirSync(scope, { recursive: true });
    const tar = spawnSync("tar", ["-xzf", path.join(decor, tgz), "-C", scope], {
      encoding: "utf8",
    });
    expect(tar.status, tar.stderr).toBe(0);
    fs.renameSync(path.join(scope, "package"), path.join(scope, "http"));

    fs.writeFileSync(
      path.join(app, "index.ts"),
      'import { decideSend } from "@nodefony/http";\n' +
        'import type { IHttpConfig } from "@nodefony/http";\n' +
        "export const decide: typeof decideSend = decideSend;\n" +
        "export type Config = IHttpConfig;\n",
    );
    fs.writeFileSync(
      path.join(app, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2024",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            // Les `.d.ts` du paquet importent ses pairs (`nodefony`…), absents
            // de ce décor : on éprouve la résolution du paquet, pas son graphe.
            skipLibCheck: true,
            noEmit: true,
            types: [],
          },
          files: ["index.ts"],
        },
        null,
        2,
      ),
    );

    const tc = spawnSync(
      process.execPath,
      [lanceurTsgo(), "--noEmit", "-p", path.join(app, "tsconfig.json")],
      { cwd: app, encoding: "utf8" },
    );
    const journal = `${tc.stdout}${tc.stderr}`;
    expect(journal).not.toMatch(/TS7016|TS2307/u);
    expect(tc.status, journal).toBe(0);
  }, 120_000);
});
