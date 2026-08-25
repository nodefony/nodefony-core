import { describe, it, expect } from "vitest";
import {
  builtinMcpTools,
  collectMcpTools,
  BUILTIN_MCP_TOOL_KEYS,
} from "nodefony";
import { defineDevkitConfig } from "../nodefony/config/defineModuleConfig";

/**
 * Ce que cette suite prouve, et ce qu'elle NE prouve plus.
 *
 * Le protocole MCP, ses gardes et la collecte des outils vivent AU CŒUR
 * (`nodefony`), avec leur propre suite — un serveur MCP n'est pas une
 * particularité de ce module, et un futur module qui ouvrirait la même porte en
 * production hériterait sinon d'un protocole éprouvé ailleurs, une seule fois,
 * pour quelqu'un d'autre.
 *
 * Ce qui reste ici est ce que ce module possède réellement : sa configuration,
 * et le fait que ses défauts désignent des outils qui existent pour de vrai.
 */

/** Politique par défaut du module (défauts du schéma, non retapés ici). */
const defaults = defineDevkitConfig({}).mcp;

/** Dépendances minimales des outils intégrés — aucun n'est appelé ici. */
const deps = {
  broker: undefined,
  getCard: () => ({}),
  projectRoot: process.cwd(),
};

describe("devkit — la configuration du serveur MCP", () => {
  it("pose ses défauts, malgré le piège Zod 4", () => {
    // Un `.default({})` plat n'aurait ré-appliqué aucun sous-défaut : ce test
    // garde le pattern `default(() => schema.parse({}))`.
    expect(defaults.enabled).toBe(true);
    expect(defaults.allowedOrigins).toEqual([]);
    expect(defaults.allowRemote).toBe(false);
  });

  it("🔴 l'allowlist par défaut est DÉRIVÉE du catalogue, pas recopiée", () => {
    // Écrite à la main, cette liste taisait chaque outil ajouté au cœur :
    // déclaré dans le code, absent de la porte, sans le moindre message. La
    // comparer au catalogue est le seul contrôle qui le voie — et il ne peut
    // pas être satisfait par une copie qui aurait dérivé.
    expect(defaults.tools).toEqual([...BUILTIN_MCP_TOOL_KEYS]);
  });

  it("🔴 chaque outil nommé par défaut EXISTE dans le catalogue du cœur", () => {
    // Le vrai risque de cette liste : elle est écrite dans ce module, le
    // catalogue vit dans un autre. Une clé renommée au cœur ne casserait rien
    // ici — elle rendrait juste un outil de moins, sans un mot, jusqu'au
    // premier agent qui le cherche.
    const catalogue = builtinMcpTools(deps);
    for (const key of defaults.tools) {
      expect(Object.hasOwn(catalogue, key), `outil « ${key} » inconnu`).toBe(
        true,
      );
    }
    // ⚠️ L'appelant est celui qui satisfait TOUT — sinon cette assertion
    // mesurerait l'autorisation en croyant mesurer l'existence : les intégrés
    // protégés (le plan d'administration) sont retenus à la collecte pour un
    // anonyme, et une clé disparue au cœur deviendrait indiscernable d'un
    // outil simplement hors de portée.
    const toutPermis = {
      authenticated: true,
      roles: [],
      scopes: [
        ...new Set(
          Object.values(catalogue).flatMap((tool) => tool.scopes ?? []),
        ),
      ],
    };
    expect(
      collectMcpTools({ builtins: defaults.tools, deps, caller: toutPermis }),
    ).toHaveLength(defaults.tools.length);
  });

  it("🔴 les intégrés PROTÉGÉS ne sortent pas pour un appelant anonyme", () => {
    // Le corollaire du test précédent, et la raison d'être du filtrage à la
    // collecte : ce qu'un anonyme ne peut pas appeler, il ne doit pas même
    // apprendre l'existence — un outil retenu est « inconnu » pour le
    // protocole, indistinguable d'un outil qui n'existe pas.
    const catalogue = builtinMcpTools(deps);
    const proteges = Object.values(catalogue).filter(
      (tool) => tool.requiresAuth === true || (tool.scopes?.length ?? 0) > 0,
    );
    expect(proteges.length).toBeGreaterThan(0);
    const anonyme = collectMcpTools({ builtins: defaults.tools, deps }).map(
      (tool) => tool.name,
    );
    for (const tool of proteges) {
      expect(anonyme, `« ${tool.name} » ne doit rien révéler`).not.toContain(
        tool.name,
      );
    }
  });

  it("refuse une valeur mal typée au boot, en nommant le champ", () => {
    expect(() =>
      defineDevkitConfig({ mcp: { allowRemote: "oui" } } as never),
    ).toThrow(/allowRemote/u);
  });
});
