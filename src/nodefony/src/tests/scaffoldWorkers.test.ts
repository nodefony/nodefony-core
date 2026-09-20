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
    // L'ancre est le TITRE, jamais son NUMÉRO : une section insérée en amont
    // renumérote tout le README, et un `indexOf` qui rend -1 découpe alors la
    // dernière ligne du fichier — le test accusait la variable absente là où
    // c'est la section qui n'avait pas été trouvée.
    const debut = readme.search(/^##\s*(?:\d+\.\s*)?Production\b/mu);
    assert.notStrictEqual(
      debut,
      -1,
      "section « Production » introuvable dans le README du gabarit",
    );
    const suivante = readme.slice(debut + 1).search(/^##\s/mu);
    const section =
      suivante === -1
        ? readme.slice(debut)
        : readme.slice(debut, debut + 1 + suivante);
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

  it("les instructions d'agent mènent à la variable, et la nomment", () => {
    // Depuis le découpage de la porte (#389), la matière des commandes vit dans
    // une annexe. Le contrat du découpage tient en deux temps, et le test les
    // sépare : la PORTE doit ENVOYER vers l'annexe (sans quoi rien n'y mène —
    // aucun outil ne charge ce dossier tout seul), et l'ANNEXE doit NOMMER la
    // variable. Ne contrôler que la seconde laisserait passer une page juste et
    // introuvable ; ne contrôler que la première, un renvoi vers une page vide.
    // #432 a RETIRÉ les annexes `agents/nodefony/*.md` — copiées dans chaque
    // app, figées à vie, et ouvertes une fois sur dix. La porte les remplace :
    // c'est ELLE qui doit nommer la variable, puisqu'elle est le seul document
    // qu'un agent ouvre d'office.
    assert.match(
      read("AGENTS.md"),
      /NF_WORKERS/u,
      "la porte nomme la variable du nombre de processus",
    );
  });
});

function readdir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
