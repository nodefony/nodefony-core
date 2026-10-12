import type { z } from "zod";
import { realtimeConfigSchema, type IRealtimeSchemaConfig } from "./config";
import { configJsonSchema } from "./configSchema";
import type { IBackplane } from "../interfaces/IBackplane";
import { parseModuleConfig } from "nodefony";

/**
 * Builder type-safe de la configuration de `@nodefony/realtime`.
 *
 * ⭐ TL;DR : MACHINERIE DE BOOT — on n'édite (presque) jamais ce fichier. Même
 * pattern que `nodefony.config.ts` ↔ `defineConfig()` du core : `config.ts` PORTE
 * la config (schéma + défauts), `define<X>Config()` la VALIDE au boot (parse +
 * env + freeze) et publie le JSON Schema Studio.
 *
 * Principes (alignés sur `defineSecurityConfig`) :
 * - **Source unique** : `./config.ts` (Zod). Le builder VALIDE + GÈLE, ne dévie pas.
 * - **Auto-documenté + introspectable** : chaque champ Zod porte `.describe()` →
 *   {@link realtimeConfigJsonSchema} produit un JSON Schema qu'un formulaire
 *   Studio (futur) consommera pour générer son UI d'édition.
 * - **Backplane custom** : instance `IBackplane` userland (NATS, Pulsar…) passée
 *   via le 2ᵉ argument — **hors** schéma sérialisable (les classes n'ont rien à
 *   faire dans un JSON Schema Studio). L'instance, si fournie, prend précédence
 *   sur `driver` côté service ; ce dernier reste source d'introspection/UI.
 *
 * **Variables d'environnement** : `NF_REALTIME_DRIVER`,
 * `NF_REALTIME_BACKPLANE_SECRET` et `NF_REALTIME_BACKPLANE_NAMESPACE` ne se
 * lisent PAS ici. Chacune est déclarée sur son champ dans `config.ts`
 * (`.meta({ env })`) et posée par le Kernel AVANT la validation : le schéma
 * les valide comme une valeur de l'application (un secret de moins de 32
 * caractères arrête le démarrage). Un appel direct de ce builder, hors Kernel,
 * ne les voit donc pas.
 *
 * @param config - configuration brute (sections omises = défauts sûrs).
 * @param options.backplane - instance `IBackplane` custom (override le driver à
 *   l'init du `RealtimeService`). Non sérialisable → exclue du JSON Schema.
 * @returns config gelée prête pour `RealtimeService`.
 * @throws ZodError si invalide.
 */
export function defineRealtimeConfig(
  config: IRealtimeConfigInput = {},
  options: { backplane?: IBackplane } = {},
): IRealtimeConfig {
  return buildRealtimeConfig(config, options);
}

/**
 * Le builder pour une entrée NON typée — la config reçue par le module au
 * démarrage, dont le schéma décide seul de la forme. Interne au paquet : une
 * application passe par {@link defineRealtimeConfig}, qui type ce qu'elle écrit.
 *
 * @param config - configuration brute, validée par le schéma
 * @param options.backplane - instance `IBackplane` custom
 * @returns config gelée prête pour `RealtimeService`.
 * @throws BootConfigurationError si invalide.
 */
export function buildRealtimeConfig(
  config: unknown = {},
  options: { backplane?: IBackplane } = {},
): IRealtimeConfig {
  const parsed = parseModuleConfig(
    realtimeConfigSchema,
    config,
    "@nodefony/realtime",
  );
  const out: IRealtimeConfig = {
    ...parsed,
    backplane: {
      ...parsed.backplane,
      instance: options.backplane,
    },
  };
  const frozen = Object.freeze(out);
  built.add(frozen);
  return frozen;
}

/**
 * Configs produites par ce builder. Marquer la sortie plutôt que d'en vérifier
 * la forme : une seule appartenance (`has`) prouve que l'objet a traversé le
 * schéma, ce qu'aucune inspection de champs ne dit.
 */
const built = new WeakSet<object>();

/**
 * Vrai si la valeur est une config produite par {@link buildRealtimeConfig}
 * (donc validée par le schéma). Lu une fois, à l'init du service.
 *
 * @param value - la config lue sur le module
 * @returns `true` si elle sort du builder
 */
export function isRealtimeConfig(value: unknown): value is IRealtimeConfig {
  return typeof value === "object" && value !== null && built.has(value);
}

/**
 * JSON Schema introspectable de la config realtime — destiné au formulaire
 * d'édition Studio (futur). N'inclut PAS `backplane.instance` (non sérialisable).
 */
export function realtimeConfigJsonSchema(): unknown {
  return configJsonSchema();
}

/** Entrée du builder (champs avec défaut optionnels). */
export type IRealtimeConfigInput = z.input<typeof realtimeConfigSchema>;

/** Config normalisée et gelée (sortie du builder, lue par `RealtimeService`). */
export type IRealtimeConfig = IRealtimeSchemaConfig & {
  backplane: IRealtimeSchemaConfig["backplane"] & {
    instance?: IBackplane | undefined;
  };
};
