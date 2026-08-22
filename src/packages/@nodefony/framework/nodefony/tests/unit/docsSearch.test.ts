/// <reference types="node" />
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { searchModuleDocs, readSymbolDeclaration } from "../../src/docsReader";

/**
 * Ce que cette suite prouve : qu'un agent peut TROUVER une page de
 * documentation qu'aucun outil de recherche de fichiers ne voit — chez un
 * utilisateur ces `.md` vivent sous `node_modules`, que git ignore et que `rg`
 * exclut. Le décor est écrit sur disque plutôt que simulé : c'est un balayage
 * de dossiers, et un faux système de fichiers ne prouverait que lui-même.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nf-docs-search-"));
  const write = async (mod: string, slug: string, body: string) => {
    await mkdir(join(root, mod, "docs"), { recursive: true });
    await writeFile(join(root, mod, "docs", `${slug}.md`), body, "utf8");
  };
  await write(
    "http",
    "sessions",
    [
      "---",
      "title: Sessions HTTP",
      "---",
      "",
      "# Sessions",
      "",
      "Le stockage de session accepte redis comme backend.",
      "Une session expire au bout du délai configuré.",
    ].join("\n"),
  );
  await write(
    "security",
    "firewall",
    ["# Firewall", "", "La sécurité des zones repose sur le firewall."].join(
      "\n",
    ),
  );
  await write(
    "redis",
    "index",
    ["# Redis", "", "Le client redis est partagé."].join("\n"),
  );
  // Un module SANS dossier docs : il ne doit ni casser ni compter.
  await mkdir(join(root, "muet"), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Les cibles telles que le kernel les composerait. */
function targets() {
  return ["http", "security", "redis", "muet"].map((key) => ({
    key,
    path: join(root, key),
  }));
}

describe("searchModuleDocs", () => {
  it("trouve une page par un mot de son corps, et dit ce qu'elle a balayé", async () => {
    const result = await searchModuleDocs(targets(), "backend");
    expect(result.scanned).to.equal(3); // le module muet n'a rien à lire
    expect(result.matched).to.equal(1);
    expect(result.hits[0]).to.include({ module: "http", slug: "sessions" });
    expect(result.hits[0].matches[0].text).to.contain("redis");
  });

  it("exige TOUS les termes — un OU rendrait le corpus entier", async () => {
    const et = await searchModuleDocs(targets(), "session redis");
    expect(et.hits.map((h) => h.slug)).to.deep.equal(["sessions"]);
    // Chacun pris seul ramène davantage : c'est bien le cumul qui a filtré.
    const seul = await searchModuleDocs(targets(), "redis");
    expect(seul.matched).to.be.greaterThan(et.matched);
  });

  it("ignore les accents et la casse", async () => {
    const result = await searchModuleDocs(targets(), "SECURITE");
    expect(result.hits.map((h) => h.slug)).to.deep.equal(["firewall"]);
  });

  it("retient une page dont seul le TITRE porte le terme", async () => {
    // « HTTP » n'apparaît que dans le frontmatter `title`.
    const result = await searchModuleDocs(targets(), "http sessions");
    expect(result.hits.map((h) => h.slug)).to.deep.equal(["sessions"]);
  });

  it("classe par pertinence — un titre porteur passe devant", async () => {
    const result = await searchModuleDocs(targets(), "redis");
    expect(result.hits[0].slug).to.equal("index"); // page « Redis »
    expect(result.hits[0].score).to.be.greaterThan(result.hits[1].score);
  });

  it("compte TOUTES les occurrences, même quand les extraits sont bornés", async () => {
    const result = await searchModuleDocs(targets(), "session", { perDoc: 1 });
    const hit = result.hits[0];
    expect(hit.matches).to.have.length(1);
    expect(hit.occurrences).to.be.greaterThan(1);
  });

  it("borne le nombre de pages rendues sans mentir sur le total", async () => {
    const result = await searchModuleDocs(targets(), "e", { limit: 1 });
    expect(result.hits).to.have.length(1);
    expect(result.matched).to.be.greaterThan(1);
  });

  it("rend un résultat vide sur une requête vide, sans rien balayer", async () => {
    const result = await searchModuleDocs(targets(), "   ");
    expect(result).to.deep.equal({
      terms: [],
      scanned: 0,
      matched: 0,
      hits: [],
    });
  });
});

/**
 * Ce que cette suite prouve : qu'un agent obtient la SIGNATURE d'un symbole du
 * framework. Le graphe symbolique dit qu'il existe et ce qu'il étend, jamais ce
 * qu'il prend en argument — cela vit dans les `.d.ts`, sous `node_modules`, que
 * git ignore et que les outils de recherche excluent.
 */
describe("readSymbolDeclaration", () => {
  let paquet: string;

  beforeAll(async () => {
    paquet = join(root, "paquet");
    await mkdir(join(paquet, "dist", "types"), { recursive: true });
    await writeFile(
      join(paquet, "dist", "types", "index.d.ts"),
      [
        'import { Service } from "nodefony";',
        "/**",
        " * Service CRUD générique.",
        " */",
        "export declare abstract class AbstractCrudService<T> extends Service {",
        "    constructor(name: string, repository: T);",
        "    find(criteria?: object): Promise<T[]>;",
        "}",
        "/** Un contrat. */",
        "export interface IThing {",
        "    id: string;",
        "}",
        "export type Handle = (input: string) => void;",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  it("rend la déclaration d'une classe, TSDoc compris", async () => {
    const found = await readSymbolDeclaration(paquet, "AbstractCrudService");
    expect(found?.declaration).to.contain("Service CRUD générique");
    expect(found?.declaration).to.contain(
      "constructor(name: string, repository: T)",
    );
    // Elle s'arrête à sa propre accolade — la déclaration suivante n'y est pas.
    expect(found?.declaration).to.not.contain("interface IThing");
    expect(found?.truncated).to.equal(false);
  });

  it("rend un chemin RELATIF au module — jamais l'arborescence du serveur", async () => {
    const found = await readSymbolDeclaration(paquet, "IThing");
    expect(found?.declarationFile).to.equal(
      join("dist", "types", "index.d.ts"),
    );
    expect(found?.declarationFile.startsWith("/")).to.equal(false);
  });

  it("gère une déclaration sans accolade, terminée par un point-virgule", async () => {
    const found = await readSymbolDeclaration(paquet, "Handle");
    expect(found?.declaration).to.contain("type Handle = (input: string)");
    expect(found?.declaration).to.not.contain("interface IThing");
  });

  it("rend null sur un symbole absent", async () => {
    expect(await readSymbolDeclaration(paquet, "Inexistant")).to.equal(null);
  });

  it("ne rend rien sur un nom qui n'est pas un identifiant", async () => {
    // ⚠️ Ce test constate, il ne GARDE pas : débrancher la garde de forme ne le
    // fait pas tomber, parce que le pré-filtre `raw.includes(symbolName)` écarte
    // déjà ces noms — aucun fichier ne contient la chaîne « Absent|IThing » ni
    // « ../../etc/passwd ». La garde reste en tête de fonction comme défense en
    // profondeur, et parce qu'elle DIT ce que la fonction accepte ; prétendre
    // ici qu'elle est éprouvée serait un faux vert.
    expect(await readSymbolDeclaration(paquet, "Absent|IThing")).to.equal(null);
    expect(await readSymbolDeclaration(paquet, "../../etc/passwd")).to.equal(
      null,
    );
  });
});
