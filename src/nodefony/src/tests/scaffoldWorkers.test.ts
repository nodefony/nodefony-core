/**
 * **Une application générée sait qu'elle peut lancer plusieurs processus.**
 *
 * Le framework règle le nombre de workers par trois voies — le fichier
 * `nodefony/config/cluster/cluster.config.ts`, la variable `NF_WORKERS`, puis
 * `nodefony cluster --workers <n>` — et une application fraîche n'en recevait
 * AUCUNE trace hors de l'`AGENTS.md`, destiné aux agents. Rien n'était cassé
 * (le défaut `workers: 1` est le bon défaut cloud-native), mais une capacité
 * qu'on n'atteint pas n'existe pas : celui qui déploie sur une machine dédiée
 * ne savait pas qu'il pouvait utiliser ses cœurs.
 *
 * Ces cas lisent l'application RENDUE par le moteur, pas les gabarits : c'est
 * l'écart entre les deux qui a produit le ticket.
 */
import { assert } from "chai";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import { runScaffold } from "../cli/scaffold/engine";

let app = "";
const read = (rel: string): string => readFileSync(path.join(app, rel), "utf8");

beforeAll(() => {
  app = mkdtempSync(path.join(tmpdir(), "nf-workers-"));
  runScaffold(
    { type: "app", answers: { name: "workers" }, dir: app, force: false },
    version,
  );
});

afterAll(() => {
  rmSync(app, { recursive: true, force: true });
});

describe("create app — le réglage du nombre de processus est DÉCOUVRABLE (#280)", () => {
  it("env.ts déclare NF_WORKERS, avec les trois formes acceptées et ce que chacune fait", () => {
    const env = read("env.ts");
    assert.match(env, /NF_WORKERS:\s*envString\(/u, "NF_WORKERS déclarée");
    // Les trois formes : `1`, `"auto"`, un nombre explicite.
    assert.include(env, '"auto"', "la forme auto est nommée");
    assert.match(env, /cgroup/iu, "auto = borné par le quota CPU du conteneur");
    assert.match(
      env,
      /1 process(us)? .*pod|un process(us)? par pod/iu,
      "1 = le défaut cloud-native",
    );
    // La précédence, là où l'on cherche la variable.
    assert.match(env, /--workers/u, "la voie CLI est nommée");
    assert.match(env, /cluster\.config\.ts/u, "la voie fichier est nommée");
  });

  it("README nomme les trois voies et dit laquelle l'emporte", () => {
    const readme = read("README.md");
    const section = readme.slice(readme.indexOf("## 8. Production"));
    assert.include(section, "NF_WORKERS", "la variable");
    assert.include(section, "--workers", "la ligne de commande");
    assert.include(
      section,
      "nodefony/config/cluster/cluster.config.ts",
      "le fichier",
    );
    assert.match(
      section,
      /--workers.*NF_WORKERS.*cluster\.config\.ts/su,
      "l'ordre de précédence, du plus fort au plus faible",
    );
  });

  it("le fichier cluster.config.ts n'est PAS généré, et le README dit POURQUOI", () => {
    // Décision : générer un fichier dont la valeur est déjà le défaut ajoute du
    // bruit dans chaque application ; la documentation porte la voie et son motif.
    assert.notInclude(
      readdir(path.join(app, "nodefony", "config")),
      "cluster",
      "aucun dossier cluster/ dans nodefony/config/",
    );
    assert.match(
      read("README.md"),
      /cluster\.config\.ts[^]*?pas généré[^]*?défaut/u,
      "le README dit que le fichier n'est pas généré, et pourquoi",
    );
    // #299 — rien de ce que le gabarit produit sous `nodefony/config/` ne
    // heurte la réserve de noms (`config.ts`, `*.config.ts`).
    assert.deepEqual(
      readdir(path.join(app, "nodefony", "config")).filter(
        (n) => n === "config.ts" || n.endsWith(".config.ts"),
      ),
      [],
    );
  });

  it("AGENTS.md nomme la variable à côté de la ligne de commande", () => {
    assert.match(read("AGENTS.md"), /NF_WORKERS=/u);
  });
});

function readdir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
