import type { IFrontPreset } from "./IFrontPreset";

/**
 * Déclaration frontend portée par un module consommateur dans son `config.ts` :
 *
 * ```ts
 * { frontend: { type: "react19", entry: "./frontend/src/main.tsx" } }
 * ```
 */
export interface IFrontendModuleDeclaration {
  /** Type de preset (résolu vers un IFrontPreset). */
  readonly type: IFrontPreset["type"];
  /** Entrée source relative à la racine du module (ex: "./frontend/src/main.tsx"). */
  readonly entry: string;
  /** Dossier de sortie de la prod build (relatif au module, défaut "./public/dist"). */
  readonly outDir?: string;
  /** Racine front (contient index.html), défaut "./frontend". */
  readonly root?: string;
  /** Nom logique de l'entrée multi-bundle (défaut = nom du module). */
  readonly name?: string;
  /**
   * Préfixe public sous lequel les assets buildés sont servis en prod
   * (par le serveur statique `Statics` de @nodefony/http, ou par un proxy
   * frontal en cloud-native). Défaut `/_assets/<name>/`. Sert de `base` Vite
   * au build ET de mount prefix au serveur statique → les deux restent alignés.
   */
  readonly publicPath?: string;
  /**
   * Préfixes de paths à proxifier depuis Vite vers Nodefony (dev only).
   * Sans ça, un `fetch("/poc/api/data")` depuis l'app React servie par Vite
   * tape Vite (qui retourne son index.html SPA-fallback) au lieu du backend.
   * Exemple : `["/poc/api", "/nodefony"]`.
   */
  readonly apiProxyPaths?: ReadonlyArray<string>;
}

/**
 * Description résolue d'une entrée front, prête à être passée au superviseur Vite.
 */
export interface IResolvedFrontendEntry {
  readonly moduleName: string;
  readonly entryName: string;
  readonly type: IFrontPreset["type"];
  readonly root: string;
  readonly entryFile: string;
  readonly outDir: string;
  /**
   * Préfixe public normalisé (leading + trailing `/`, ex `/_assets/studio/`)
   * — `base` Vite en prod + mount prefix du serveur statique.
   */
  readonly publicPath: string;
  /** Préfixes à proxifier vers Nodefony (résolus depuis la déclaration). */
  readonly apiProxyPaths: ReadonlyArray<string>;
}

/**
 * Builder responsable de construire la config Vite finale à partir
 * des déclarations modules + des presets.
 */
export interface IFrontBuilder {
  /** Liste tous les presets enregistrés. */
  listPresets(): ReadonlyArray<IFrontPreset>;
  /** Récupère un preset par type. */
  getPreset(type: IFrontPreset["type"]): IFrontPreset | undefined;
  /** Enregistre / remplace un preset. */
  registerPreset(preset: IFrontPreset): void;
  /**
   * Construit la config Vite (objet brut) pour une liste d'entrées résolues.
   * Le builder lui-même n'instancie pas Vite — il fournit la config.
   */
  buildViteConfig(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    mode: "development" | "production",
  ): Promise<Record<string, unknown>>;
}
