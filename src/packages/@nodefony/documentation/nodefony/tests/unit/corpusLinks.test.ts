import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { rewriteInternalLinks } from "../../src/linkResolver";
import { pathToSlug, type DocSource } from "../../src/slug";

/**
 * Banc de NAVIGATION sur le corpus RÉEL.
 *
 * Les tests unitaires du résolveur travaillent sur un index fabriqué ; celui-ci
 * exerce les vraies pages du dépôt. Il attrape ce qu'aucun mock ne peut voir :
 * un lien relatif mal compté (`../` en trop), une page renommée, un lien vers un
 * fichier supprimé — autant de liens morts dans le portail.
 */

const REPO = resolve(__dirname, "../../../../../../..");

/** Toutes les pages `.md` scannées comme le fait le service (racine + modules). */
function collectCorpus(): { abs: string; repoRel: string; slug: string }[] {
  const out: { abs: string; repoRel: string; slug: string }[] = [];

  // Aligné sur le scan RÉEL du portail (`DocumentationService` → `scan.exclude`,
  // défaut de `config.ts`) : le check de navigation ne doit juger QUE les pages
  // réellement servies. Sinon il tombe sur des fichiers jamais indexés (retex
  // archivés) et fabrique des liens « morts » que personne ne peut cliquer.
  const EXCLUDED_DIRS = new Set(["node_modules", "session-retros", "dist"]);

  const walk = (dir: string, base: string, source: DocSource): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Un symlink (ex. `docs/MIGRATION_STATUS.md` → `../MIGRATION_STATUS.md`)
      // porte ses liens relatifs à sa VRAIE localisation (la racine), pas au
      // point de montage : le portail le sert comme contenu brut, pas comme page
      // navigable → hors check de liens (le juger casserait la version racine).
      if (entry.isSymbolicLink()) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || EXCLUDED_DIRS.has(entry.name))
          continue;
        walk(abs, base, source);
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        const rel = relative(base, abs).replace(/\\/g, "/");
        out.push({
          abs,
          repoRel: relative(REPO, abs).replace(/\\/g, "/"),
          slug: pathToSlug(source, rel),
        });
      }
    }
  };

  walk(join(REPO, "docs"), join(REPO, "docs"), { kind: "root" });

  const pkgRoot = join(REPO, "src/packages/@nodefony");
  for (const mod of readdirSync(pkgRoot)) {
    const docsDir = join(pkgRoot, mod, "docs");
    walk(docsDir, docsDir, { kind: "module", module: mod });
  }
  const coreDocs = join(REPO, "src/nodefony/docs");
  walk(coreDocs, coreDocs, { kind: "module", module: "core" });

  return out;
}

const corpus = collectCorpus();
const byPath = new Map(corpus.map((d) => [d.repoRel, d.slug]));
const toSlug = (p: string): string | undefined => byPath.get(p);

/** Résout un href relatif contre le dossier de la page (chemin repo POSIX). */
function resolveTarget(fromDir: string, href: string): string {
  const out = fromDir.split("/").filter(Boolean);
  for (const seg of href.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Analyse les liens `.md` restés relatifs après traduction. Deux natures :
 *
 * - **`broken`** — la cible n'existe même pas sur le disque : le lien est FAUX
 *   (typiquement un `../` mal compté). C'est une erreur, ici comme sur GitHub.
 * - **`outside`** — la cible existe mais n'est pas une page de doc (`CLAUDE.md`,
 *   `MEMORY.md`…) : rien à traduire, mais elle restera inerte dans le portail.
 */
/**
 * Neutralise le CODE (fences et code inline) en préservant le nombre de lignes.
 *
 * Une page qui ENSEIGNE la syntaxe des liens était punie pour ses exemples :
 * un `[Service](../../x.md)` cité en modèle comptait comme une navigation, donc
 * comme un lien mort. Ce n'en est pas une — un exemple n'est ni cliquable ni
 * promis au lecteur. `doc-lint` applique déjà cette règle ; ce banc ne l'avait
 * jamais reçue, et c'est la leçon écrite dans `RETEX.md` qui l'a fait tomber.
 *
 * Scan ligne à ligne (pas une regex globale) pour tenir les fences à quatre
 * backticks, qui encadrent des blocs contenant eux-mêmes des ```.
 */
function stripCode(src: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*(`{3,})(.*)$/);
    if (fence !== null) {
      out.push("");
      if (m && m[1].length >= fence.length && !m[2].trim()) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      out.push("");
      continue;
    }
    out.push(line.replace(/`[^`\n]*`/g, "``"));
  }
  return out.join("\n");
}

function analyze(page: { abs: string; repoRel: string }): {
  broken: string[];
  outside: string[];
} {
  const raw = stripCode(readFileSync(page.abs, "utf8"));
  const fromDir = dirname(page.repoRel);
  const rewritten = rewriteInternalLinks(raw, { fromDir, toSlug });
  const broken: string[] = [];
  const outside: string[] = [];
  for (const m of rewritten.matchAll(
    /\]\((?!https?:|mailto:|#)([^)\s]+?\.md)(?:#[^)\s]*)?\)/g,
  )) {
    const href = m[1];
    // Après traduction, une cible légitime est un slug (ni `/` ni `..`).
    if (!href.includes("/") && !href.includes("..")) continue;
    const target = resolveTarget(fromDir, href);
    if (existsSync(join(REPO, target))) outside.push(href);
    else broken.push(href);
  }
  return { broken, outside };
}

/**
 * Pages pas encore passées au standard de rédaction, qui portent des liens
 * relatifs faux hérités. CLIQUET : cette liste ne doit que RÉTRÉCIR — chaque
 * vague de reprise en retire ses pages. Aucun ajout sans réécriture de la page.
 */
const LEGACY_BROKEN_LINKS: readonly string[] = [];

describe("corpus — navigation interne", () => {
  it("trouve un corpus non vide (sinon le test ne prouve rien)", () => {
    expect(corpus.length).toBeGreaterThan(20);
  });

  // La neutralisation du code ne doit pas devenir une amnistie générale : un
  // lien de PROSE reste vérifié, sinon ce banc ne prouverait plus rien.
  it("neutralise le code SANS aveugler la prose", () => {
    const src = [
      "Voir [la page](../vraie/page.md).",
      "Exemple : `[Service](../../faux.md)` (illustration).",
      "```markdown",
      "[Autre](../../aussi-faux.md)",
      "```",
    ].join("\n");
    const stripped = stripCode(src);
    expect(stripped).toContain("](../vraie/page.md)");
    expect(stripped).not.toContain("faux.md");
    expect(stripped.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("traduit les liens internes en slugs navigables (hors dette connue)", () => {
    const broken: Record<string, string[]> = {};
    for (const page of corpus) {
      if (LEGACY_BROKEN_LINKS.includes(page.repoRel)) continue;
      const { broken: bad } = analyze(page);
      if (bad.length) broken[page.repoRel] = bad;
    }
    expect(broken).toEqual({});
  });

  it("le cliquet ne se desserre pas : toute page listée est encore fautive", () => {
    // Une page réparée doit SORTIR de la liste — sinon le cliquet se relâche
    // en silence et une régression future passerait inaperçue.
    const healed = LEGACY_BROKEN_LINKS.filter((rel) => {
      const page = corpus.find((c) => c.repoRel === rel);
      return page && analyze(page).broken.length === 0;
    });
    expect(healed).toEqual([]);
  });

  it("donne un slug unique à chaque page (aucune collision)", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const d of corpus) {
      const prev = seen.get(d.slug);
      if (prev) collisions.push(`${d.slug}: ${prev} ⟷ ${d.repoRel}`);
      else seen.set(d.slug, d.repoRel);
    }
    expect(collisions).toEqual([]);
  });

  it("expose un hub atteignable pour la racine et pour la sécurité", () => {
    expect(byPath.get("docs/index.md")).toBe("root~index");
    expect(byPath.get("src/packages/@nodefony/security/docs/index.md")).toBe(
      "mod~security~index",
    );
  });
});
