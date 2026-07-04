/**
 * Modèle de la **page config agrégée** (`/nodefony/config`) — PUR (0 JSX).
 *
 * Transforme la réponse du data plane `/nodefony/kernel/api/config` (config de
 * TOUS les modules + app) en un modèle « compréhensible d'un coup d'œil » :
 *  - **sections par module** (réutilise `jsonSchemaToSections`) avec la **recette
 *    d'override `NF__<SEG>__<CHEMIN>` injectée par champ** (12-factor, ADR-0006) ;
 *  - liste des **overrides actifs** (valeurs ≠ défaut = l'identité du déploiement) ;
 *  - **statistiques globales** (provenance, secrets, mutabilité) pour le bandeau.
 *
 * Types miroir LOCAUX du contrat serveur (frontière isomorphe : 0 import runtime
 * serveur ; le seul pont = le JSON du data plane, secrets redactés côté serveur).
 */
import type { ConfigField, ConfigSection } from "../../components/ui";
import { jsonSchemaToSections } from "./jsonSchemaToSections";

/** Entrée config d'un module (miroir de `IConfigEntry` serveur). */
export interface ConfigEntry {
  /** Clé Studio (`http`, `security`, clé de l'app…). */
  key: string;
  /** Nom de package (`@nodefony/http`, nom de l'app…). */
  name: string;
  /** Config de l'APPLICATION (vs un module) ? */
  isApp: boolean;
  /** Segment d'adressage des overrides (`NF__<SEG>__…`) : `app` ou le basename. */
  seg: string;
  /** Config effective résolue (secrets REDACTÉS côté serveur). */
  config: Record<string, unknown>;
  /** JSON Schema du module (si migré Zod), sinon `null`. */
  configSchema: unknown;
  /** Origine par champ (`default`/`app`/`env`), ou `null` (pas de schéma). */
  provenance: Record<string, string> | null;
  /** Chemin pointé (minuscule) → VRAIE variable d'env qui surcharge (« qui/où »). */
  envKeys: Record<string, string>;
  /**
   * Chemin pointé → SOURCE réelle d'un champ **app**-surchargé : un module
   * (`@nodefony/test` qui reconfigure celui-ci via `module-<seg>`) ou
   * `nodefony.config.ts` (config app directe). Le vrai « qui surcharge ».
   */
  overriddenBy: Record<string, string>;
}

/** Réponse de `GET /nodefony/kernel/api/config`. */
export interface ConfigOverviewResponse {
  modules: ConfigEntry[];
}

/**
 * Clé d'override `NF__<SEG>__<CHEMIN>` d'un champ (ADR-0006). Chemin pointé →
 * double underscore, MAJUSCULES (la résolution serveur est casse-insensible).
 *
 * @example overrideKeyFor("security", "jwt.accessTtlS") // NF__SECURITY__JWT__ACCESSTTLS
 */
export function overrideKeyFor(seg: string, fieldKey: string): string {
  return `NF__${seg.toUpperCase()}__${fieldKey.replace(/\./g, "__").toUpperCase()}`;
}

/** Un module agrégé : son entrée + ses sections (recette d'override injectée). */
export interface ModuleConfig {
  entry: ConfigEntry;
  sections: ConfigSection[];
  schemaStatus: "zod" | "none";
}

/** Un override ACTIF (valeur ≠ défaut) — « ce qui n'est pas par défaut ». */
export interface ActiveOverride {
  module: string;
  moduleKey: string;
  field: string;
  source: "app" | "env";
  secret: boolean;
  /** Recette d'override `NF__…` (comment surcharger ce champ). */
  overrideKey: string;
  /** QUI/OÙ surcharge, proprement : la VRAIE var d'env, ou `nodefony.config.ts`. */
  where: string;
}

/**
 * Source PRÉCISE d'un champ surchargé — le VRAI « qui surcharge, où » :
 * - `env` → la **vraie variable** d'env posée (`entry.envKeys`), sinon la recette ;
 * - `app` → la **source attribuée** par le serveur (`entry.overriddenBy`) : un MODULE
 *   (`@nodefony/test` via `module-<seg>`) ou `nodefony.config.ts` (config app directe).
 */
export function whereOf(
  entry: ConfigEntry,
  fieldKey: string,
  source: "app" | "env",
): string {
  if (source === "env") {
    return (
      entry.envKeys[fieldKey.toLowerCase()] ??
      overrideKeyFor(entry.seg, fieldKey)
    );
  }
  return entry.overriddenBy[fieldKey] ?? "nodefony.config.ts";
}

/** Provenance d'une valeur surchargée (≠ défaut/module). */
export type OverrideSource = "app" | "env" | "runtime";

/** Un champ surchargé, scopé à UN module (sans le contexte cross-module). */
export interface FieldOverride {
  /** Chemin pointé du réglage (`session.store`, `securityHeaders.frameOptions`). */
  field: string;
  /** D'où vient la valeur gagnante. */
  source: OverrideSource;
  /** Donnée sensible (valeur masquée). */
  secret: boolean;
  /** Recette d'override `NF__…` (comment piloter ce champ en 12-factor). */
  overrideKey: string;
  /** « Qui/où » surcharge, lisible (vraie var d'env, fichier app, ou « runtime »). */
  where: string;
}

/** Résout le « qui/où » précis d'un champ surchargé (cross-module, page globale). */
export type WhereResolver = (field: string, source: "app" | "env") => string;

/**
 * Collecte les **champs surchargés** (provenance ≠ défaut/module) d'un jeu de
 * sections — la version « scopée module » de ce que `buildConfigModel` calcule en
 * agrégé. Partagée entre la page globale et l'onglet Config d'un module (cohérence
 * « mener par les écarts »). Sans `where`, le « qui/où » retombe sur la recette
 * d'override (l'onglet module n'a pas le détail cross-module `envKeys`/`overriddenBy`).
 *
 * @param sections - sections déjà enrichies (`jsonSchemaToSections` + `withOverrideKeys`).
 * @param seg - segment d'adressage du module (`NF__<SEG>__…`).
 * @param where - résolveur optionnel du « surchargé par » précis.
 * @returns les champs surchargés, dans l'ordre des sections.
 */
export function collectFieldOverrides(
  sections: ConfigSection[],
  seg: string,
  where?: WhereResolver,
): FieldOverride[] {
  const out: FieldOverride[] = [];
  for (const sec of sections) {
    for (const f of sec.fields) {
      const src = f.source;
      if (src !== "app" && src !== "env" && src !== "runtime") continue;
      const overrideKey = overrideKeyFor(seg, f.key);
      out.push({
        field: f.key,
        source: src,
        secret: Boolean(f.secret),
        overrideKey,
        where:
          src === "runtime"
            ? "édité à chaud (runtime)"
            : where
              ? where(f.key, src)
              : overrideKey,
      });
    }
  }
  return out;
}

/** Statistiques globales pour le bandeau instantané. */
export interface ConfigStats {
  moduleCount: number;
  fieldCount: number;
  byProvenance: { default: number; app: number; env: number };
  secrets: number;
  live: number;
}

/** Modèle complet consommé par la page. */
export interface ConfigModel {
  modules: ModuleConfig[];
  overrides: ActiveOverride[];
  stats: ConfigStats;
}

/**
 * Injecte la **recette d'override** `NF__<SEG>__<CHEMIN>` (12-factor) sur chaque
 * champ NON réservé → `ConfigLayout` rend la colonne « Recette » + bouton copier.
 * Exporté : la page module (`ModuleDetail`) l'applique aussi pour rester cohérente
 * avec la page globale.
 */
export function withOverrideKeys(
  sections: ConfigSection[],
  seg: string,
): ConfigSection[] {
  return sections.map((s) => ({
    ...s,
    fields: s.fields.map((f): ConfigField =>
      f.reserved ? f : { ...f, recipe: f.recipe ?? overrideKeyFor(seg, f.key) },
    ),
  }));
}

/**
 * Construit le modèle de la page à partir des entrées du data plane. Tri : l'app
 * d'abord (le plus structurant), puis les modules par nom. N'inclut que les
 * modules dont la config produit au moins une section.
 *
 * @param entries - entrées renvoyées par `/nodefony/kernel/api/config`.
 * @returns le modèle (modules + overrides + stats).
 */
export function buildConfigModel(entries: ConfigEntry[]): ConfigModel {
  const modules: ModuleConfig[] = [];
  const overrides: ActiveOverride[] = [];
  const stats: ConfigStats = {
    moduleCount: 0,
    fieldCount: 0,
    byProvenance: { default: 0, app: 0, env: 0 },
    secrets: 0,
    live: 0,
  };

  const sorted = [...entries].sort((a, b) =>
    a.isApp === b.isApp ? a.name.localeCompare(b.name) : a.isApp ? -1 : 1,
  );

  for (const entry of sorted) {
    const raw = jsonSchemaToSections(
      entry.configSchema,
      entry.config,
      entry.provenance,
    );
    if (raw.length === 0) continue;
    const sections = withOverrideKeys(raw, entry.seg);
    modules.push({
      entry,
      sections,
      schemaStatus: entry.configSchema ? "zod" : "none",
    });

    for (const sec of sections) {
      for (const f of sec.fields) {
        stats.fieldCount++;
        const src = f.source ?? "default";
        if (src === "app") stats.byProvenance.app++;
        else if (src === "env") stats.byProvenance.env++;
        else stats.byProvenance.default++;
        if (f.secret) stats.secrets++;
        if (f.mutability === "live") stats.live++;
        if (src === "app" || src === "env") {
          overrides.push({
            module: entry.name,
            moduleKey: entry.key,
            field: f.key,
            source: src,
            secret: Boolean(f.secret),
            overrideKey: overrideKeyFor(entry.seg, f.key),
            where: whereOf(entry, f.key, src),
          });
        }
      }
    }
  }
  stats.moduleCount = modules.length;
  return { modules, overrides, stats };
}
