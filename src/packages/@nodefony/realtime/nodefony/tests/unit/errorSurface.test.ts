import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * **Une classe d'erreur exportée que personne ne lève est un piège, pas une API.**
 *
 * Le module a vécu six semaines avec un `RealtimeError` annoncé par le README
 * comme « l'erreur de base », exporté par `index.ts`, promettant en TSDoc des
 * sous-classes (`HandshakeError`, `FrameError`…) jamais écrites — et levé par
 * zéro ligne de code. `docs/actions.md` avait fini par documenter qu'il ne
 * fallait PAS s'en servir : le signe qu'un nom mort était devenu un piège dans
 * la surface publique. L'erreur vivante du domaine est `RpcError`
 * (`JsonRpcPeer.ts`), la seule que le temps réel lève et que les bancs attrapent.
 *
 * Ce banc porte la règle pour la suite : ce qu'`index.ts` annonce comme erreur
 * doit exister au moins une fois dans un `throw`. Même doctrine que l'interdit
 * du littéral « kafka » dans `backplaneRegistry.test.ts` — pas de nom mort.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** Racine du paquet `@nodefony/realtime` (là où vit `index.ts`). */
const MODULE_ROOT = path.resolve(here, "../../..");
/** Le peer JSON-RPC partagé avec le client vit dans le cœur, pas dans le module. */
const CORE_REALTIME = path.resolve(
  here,
  "../../../../../..",
  "nodefony/src/realtime",
);

/**
 * Les identifiants en `*Error` que la surface publique ré-exporte comme VALEURS.
 *
 * `export type { … }` est volontairement ignoré : un type ne se lève pas.
 */
function exportedErrorNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s+\{([^}]*)\}/gu)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const name =
        raw
          .trim()
          .split(/\s+as\s+/u)
          .pop()
          ?.trim() ?? "";
      if (/^[A-Z][A-Za-z0-9]*Error$/u.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

/** Les `.ts` de PRODUCTION sous une racine — ni bancs, ni décors, ni build. */
function productionSources(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return (
    fs
      .readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
      .map((f) => path.join(root, f))
      // Le séparateur rendu par `readdirSync` est celui de la plateforme : filtrer
      // sur « / » seul laisserait passer `a\tests\b` sous Windows.
      .filter((f) => !/[/\\](dist|node_modules|tests|testing)[/\\]/u.test(f))
  );
}

describe("Surface d'erreurs du temps réel — pas d'erreur exportée que personne ne lève", () => {
  it("AUTO-CONTRÔLE : l'extracteur voit un `*Error` ré-exporté, et ignore un type", () => {
    // Sans ce cas, le suivant serait vert sur une liste vide sans jamais rien
    // mesurer — et le resterait le jour où l'extraction cesserait de voir.
    const temoin = [
      'export { RealtimeHub } from "./hub";',
      'export { FooError } from "./errors/FooError";',
      'export type { BarError } from "./types";',
    ].join("\n");

    expect(exportedErrorNames(temoin)).to.deep.equal(["FooError"]);
  });

  it("chaque `*Error` de la surface publique a au moins un site d'émission", () => {
    const index = fs.readFileSync(path.join(MODULE_ROOT, "index.ts"), "utf8");
    const production = [
      ...productionSources(path.join(MODULE_ROOT, "nodefony")),
      ...productionSources(CORE_REALTIME),
    ]
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");

    for (const name of exportedErrorNames(index)) {
      expect(
        production.includes(`new ${name}(`),
        `${name} est exporté par index.ts mais AUCUN code de production ne le lève. ` +
          `Une erreur qu'on ne peut pas attraper n'est pas une API : soit un site ` +
          `l'émet, soit elle sort de la surface publique.`,
      ).to.equal(true);
    }
  });
});
