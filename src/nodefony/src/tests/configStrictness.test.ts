/**
 * **Un schéma de configuration de module CHOISIT sa sévérité, il ne la subit pas.**
 *
 * Zod offre trois formes d'objet, et le DÉFAUT est le seul dont on ne veuille
 * nulle part : `z.object` RETIRE silencieusement les clés inconnues. Écrire
 * `use("@nodefony/http", { trustProxi: true })` produisait une application qui
 * démarre en IGNORANT ce que l'utilisateur avait écrit — celui qui croyait armer
 * la confiance de proxy ne l'avait pas armée, et rien ne le lui disait.
 *
 * Les deux autres formes sont des décisions, et ce contrôle exige qu'on en
 * prenne une :
 *
 * - `z.strictObject` — la section est 100 % consommée par notre code. Une clé
 *   inconnue INTERROMPT le boot en la nommant.
 * - `z.looseObject` — la section est transmise telle quelle à une bibliothèque
 *   tierce (`node:http`, `ws`, `qs`, `serve-static`…), dont on ne connaît pas
 *   toutes les options : y refuser une clé interdirait une option légitime.
 *
 * Le typage (registre `NodefonyModuleConfig`) attrape déjà la faute de frappe à
 * la COMPILATION. Ceci protège ce qui la contourne : une configuration lue d'un
 * fichier, un `as never`, un override d'environnement (`NF__HTTP__…`).
 *
 * Le périmètre couvre les modules du dépôt ET les gabarits de scaffold — c'est
 * l'écart inverse qui s'était installé : le gabarit d'un module GÉNÉRÉ était en
 * `strictObject` pendant que les dix modules du framework restaient en
 * `z.object`. Le framework était moins sévère que ce qu'il fait produire.
 *
 * ⚠️ Ce contrôle ne juge PAS laquelle des deux formes est juste : cela demande
 * de savoir où va la section. Il refuse uniquement l'ABSENCE de choix.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Dossiers dont le contenu n'est jamais du code de ce dépôt. */
const PRUNED = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);

/**
 * Collecte les fichiers de configuration de module sous une racine.
 *
 * Marche récursive plutôt qu'une liste écrite ici : une liste se périme au
 * module suivant, et c'est précisément le module suivant qu'on veut couvrir.
 *
 * @param dir - dossier à explorer.
 * @param out - accumulateur (chemins absolus).
 * @returns les chemins trouvés.
 */
function collectConfigFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (PRUNED.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      collectConfigFiles(full, out);
      continue;
    }
    // `path.sep` et non `/` : ce chemin est LU sur le disque, il s'écrit donc
    // dans la grammaire de la plateforme — un filtre en `/` ne mord pas sur
    // `a\nodefony\config\b`.
    const marker = path.join("nodefony", "config") + path.sep;
    if (
      (entry === "config.ts" || entry === "config.ts.tpl") &&
      full.includes(marker)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Repère les objets Zod dont la sévérité n'est pas choisie, dans une source.
 *
 * Deux formes, parce que les deux s'écrivent dans ce dépôt : `z.object(` et sa
 * forme chaînée `z\n  .object(` — prettier coupe la ligne dès qu'un
 * `.describe()` suit, et n'en chercher qu'une laissait passer les onze sections
 * de `@nodefony/http`.
 *
 * @param source - contenu d'un `config.ts` (ou de son gabarit).
 * @returns une entrée par ligne fautive, ligne 1-indexée.
 */
export function findImplicitObjects(
  source: string,
): { line: number; text: string }[] {
  const findings: { line: number; text: string }[] = [];
  source.split("\n").forEach((line, i) => {
    if (/\bz\s*\.\s*object\s*\(/.test(line) || /^\s*\.object\s*\(/.test(line)) {
      findings.push({ line: i + 1, text: line.trim() });
    }
  });
  return findings;
}

describe("configuration des modules — la sévérité se choisit", () => {
  const files = collectConfigFiles(path.join(REPO_ROOT, "src")).concat(
    collectConfigFiles(path.join(REPO_ROOT, ".claude")),
  );

  // 🔴 Sans matière, « 0 constat » ne se distingue pas d'un dépôt conforme. Ce
  // cas est ce qui empêche le contrôle de rendre un vert qui ne vaut rien.
  it("le balayage TROUVE la matière qu'il prétend juger", () => {
    assert.isAtLeast(
      files.length,
      10,
      "le dépôt porte plus de dix configs de module ; le balayage est aveugle",
    );
    assert.isTrue(
      files.some((f) => f.endsWith(".tpl")),
      "les gabarits de scaffold doivent être couverts, pas seulement le dépôt",
    );
  });

  it("aucun `z.object` implicite dans une config de module", () => {
    const findings: string[] = [];
    for (const file of files) {
      for (const f of findImplicitObjects(readFileSync(file, "utf8"))) {
        findings.push(`${path.relative(REPO_ROOT, file)}:${f.line}  ${f.text}`);
      }
    }
    assert.deepEqual(
      findings,
      [],
      "Remplacer par `z.strictObject` (section consommée par notre code : une " +
        "clé inconnue interrompt le boot en la nommant) ou `z.looseObject` " +
        "(section transmise telle quelle à une lib tierce : ses options non " +
        "listées doivent survivre au parse).",
    );
  });

  // Auto-contrôle de la DÉTECTION : un motif qui cesse de mordre rend « 0
  // constat » avec le même aplomb qu'un dépôt conforme, et personne ne le voit
  // — le vert est exactement ce qu'on attendait.
  describe("la détection mord (auto-contrôle)", () => {
    it("voit la forme directe", () => {
      assert.lengthOf(findImplicitObjects("const s = z.object({});"), 1);
    });

    it("voit la forme chaînée, celle que prettier produit", () => {
      const f = findImplicitObjects(
        "const s = z\n  .object({})\n  .describe();",
      );
      assert.lengthOf(f, 1);
      assert.equal(f[0].line, 2);
    });

    it("laisse passer les deux formes qui SONT un choix", () => {
      assert.isEmpty(findImplicitObjects("z.strictObject({})"));
      assert.isEmpty(findImplicitObjects("z.looseObject({})"));
      assert.isEmpty(findImplicitObjects("  .strictObject({})"));
      assert.isEmpty(findImplicitObjects("  .looseObject({})"));
    });

    it("ne confond pas un identifiant qui CONTIENT `object`", () => {
      assert.isEmpty(findImplicitObjects("const x = schema.objectify({});"));
      assert.isEmpty(findImplicitObjects("const x = buildObject({});"));
    });

    it("rend TOUTES les occurrences, avec leur ligne", () => {
      const f = findImplicitObjects(
        "z.object({})\nz.strictObject({})\nz.object({})",
      );
      assert.deepEqual(
        f.map((x) => x.line),
        [1, 3],
      );
    });
  });
});
