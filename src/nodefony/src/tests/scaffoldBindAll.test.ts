/**
 * **Une application générée s'ouvre depuis le réseau local quand on le demande.**
 *
 * En développement, l'application écoute sur la seule boucle locale : un
 * téléphone ou un autre poste du réseau n'obtient qu'une connexion refusée.
 * Or c'est précisément le cas que sert Vite derrière Nodefony (#528) — page,
 * scripts et rechargement à chaud sur UNE origine HTTPS, donc `getUserMedia`,
 * Service Workers et WebAuthn disponibles hors de `localhost`. Sans
 * interrupteur, l'utilisateur devait réécrire `domain` dans sa configuration.
 *
 * Ces cas ÉVALUENT l'expression `domain:` de la configuration RENDUE dans
 * trois décors, plutôt que d'y chercher une chaîne : c'est le comportement qui
 * compte, pas l'orthographe de la ligne.
 */
import { assert } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { version } from "../../package.json";
import { runScaffold } from "../cli/scaffold/engine";

let app = "";
const read = (rel: string): string => readFileSync(path.join(app, rel), "utf8");

interface IFauxCtx {
  isProd: boolean;
  env: { NF_BIND_ALL?: boolean };
}

/**
 * Isole l'expression `domain: …,` du descripteur rendu et l'évalue contre un
 * `ctx` minimal — la seule partie du descripteur que ce test interroge.
 */
function domaineRendu(ctx: IFauxCtx): unknown {
  const m = /^\s*domain:\s*(.+),\s*$/mu.exec(read("nodefony.config.ts"));
  assert.isNotNull(m, "la configuration rendue déclare `domain:`");
  return runInNewContext(m?.[1] ?? "", { ctx });
}

beforeAll(() => {
  app = mkdtempSync(path.join(tmpdir(), "nf-bindall-"));
  runScaffold(
    { type: "app", answers: { name: "bindall" }, dir: app, force: false },
    version,
  );
});

afterAll(() => {
  rmSync(app, { recursive: true, force: true });
});

describe("create app — écoute sur le réseau local en développement (#528)", () => {
  it("par défaut, le développement reste sur la boucle locale", () => {
    assert.strictEqual(domaineRendu({ isProd: false, env: {} }), "127.0.0.1");
  });

  it("NF_BIND_ALL ouvre toutes les interfaces en développement", () => {
    assert.strictEqual(
      domaineRendu({ isProd: false, env: { NF_BIND_ALL: true } }),
      "0.0.0.0",
    );
  });

  it("la production écoute sur toutes les interfaces, interrupteur ou non", () => {
    assert.strictEqual(domaineRendu({ isProd: true, env: {} }), "0.0.0.0");
  });

  it("env.ts déclare l'interrupteur, booléen, désactivé par défaut", () => {
    assert.match(
      read("env.ts"),
      /NF_BIND_ALL:\s*envBoolean\(\{\s*default:\s*false/u,
    );
  });

  it("le catalogue .env le montre, commenté, avec son usage", () => {
    const catalogue = read(".env");
    assert.match(catalogue, /^# NF_BIND_ALL=true$/mu);
    assert.match(catalogue, /réseau local/u);
  });
});
