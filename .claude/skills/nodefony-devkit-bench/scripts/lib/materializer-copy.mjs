/**
 * Le matérialiseur des descriptions sérialisées, rendu importable HORS du
 * paquet drizzle — et ce qui en sélectionne une partie.
 *
 * Le matérialiseur n'existe qu'UNE fois : `tests/integration/serialized-specs.ts`
 * de `@nodefony/drizzle`. Un consommateur extérieur (application isolée du banc
 * de schéma réel, décor du banc ORM du module `test`) en reçoit une COPIE dont
 * les imports relatifs sont relus vers `@nodefony/drizzle` — la réécriture est
 * CONSTATÉE, et un import relatif restant arrête tout.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Le matérialiseur, relatif à la racine du dépôt (chemin qui voyage : `/`). */
export const MATERIALIZER =
  "src/packages/@nodefony/drizzle/tests/integration/serialized-specs.ts";

const REWRITES = [
  [`from "../../nodefony/entity/colKit";`, `from "@nodefony/drizzle";`],
  [`from "../../nodefony/entity/colKit.spec";`, `from "@nodefony/drizzle";`],
];

/**
 * Rend la source du matérialiseur, imports relus vers `@nodefony/drizzle`.
 *
 * @param repo - racine du dépôt.
 * @param origin - script qui écrit la copie (nommé dans l'en-tête).
 * @returns la source, précédée d'un en-tête « ne pas éditer ».
 * @throws Quand un import attendu manque, ou qu'un import relatif reste.
 */
export function copyMaterializer(repo, origin) {
  const file = path.join(repo, ...MATERIALIZER.split("/"));
  let copied = readFileSync(file, "utf8");
  for (const [from, to] of REWRITES) {
    if (!copied.includes(from)) {
      throw new Error(
        `matérialiseur : import « ${from} » introuvable — ${MATERIALIZER} a changé, relire la réécriture`,
      );
    }
    copied = copied.split(from).join(to);
  }
  if (/from "\.\.?\//u.test(copied)) {
    throw new Error("matérialiseur : un import relatif reste après réécriture");
  }
  return `// RECOPIÉ par ${origin} depuis ${MATERIALIZER} — ne pas éditer.\n${copied}`;
}

/**
 * Les descriptions visées et toutes celles qu'elles référencent, de proche en
 * proche — sans quoi PostgreSQL et MySQL refusent le `CREATE TABLE` d'une clé
 * étrangère vers une table absente.
 *
 * @param specs - descriptions sérialisées du corpus.
 * @param roots - noms des tables visées.
 * @returns le sous-ensemble, dans l'ordre du corpus.
 * @throws Quand une table visée n'existe pas dans le corpus.
 */
export function referenceClosure(specs, roots) {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const kept = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const name = stack.pop();
    if (kept.has(name)) continue;
    const spec = byName.get(name);
    if (!spec) throw new Error(`corpus : table ${name} absente`);
    kept.add(name);
    for (const c of Object.values(spec.columns)) {
      if (c.kind === "ref" && c.target && c.target !== "self")
        stack.push(c.target);
    }
  }
  return specs.filter((s) => kept.has(s.name));
}
