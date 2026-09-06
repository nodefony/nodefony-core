/**
 * @nodefony/documentation — Data plane de documentation transverse de Nodefony.
 *
 * Module **headless** (back pur) : il indexe la documentation co-localisée
 * (`docs/` racine transverse + `<module>/docs/*.md`, ADR-0001), résout les
 * variables dynamiques `{{ }}` côté serveur, et expose le tout sous
 * `/nodefony/documentation/api/*`. Il ne rend AUCUN HTML — le front Studio (et,
 * demain, un générateur de site statique ou le RAG P12) consomme ce data plane.
 *
 * Pourquoi un module dédié (et pas un simple controller Studio) : la doc porte
 * de l'**état** (index scanné, cache TTL, registre de providers `{{ }}`) → un
 * cycle de vie propre, hors hot path request (tout lazy). Cf
 * [[project_doc_portal_faisabilite]].
 *
 * Voir aussi : CLAUDE.md (décisions figées), MEMORY.md (internals IA),
 * README.md (usage humain), docs/ (doc vulgarisée surfacée dans Studio).
 */
import { GitService, Kernel, Module, services } from "nodefony";
import { controllers } from "@nodefony/framework";
import config from "./nodefony/config/config";
import {
  defineDocumentationConfig,
  documentationConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
import type {
  DocumentationConfig,
  DocumentationConfigInput,
} from "./nodefony/config/config";
import DocumentationService from "./nodefony/service/DocumentationService";
import DocumentationController from "./nodefony/controller/DocumentationController";

// Augmente le registre de config des modules → `use("@nodefony/documentation", { … })`
// propose les clés typées en complétion, et REFUSE une clé inconnue. Sans cette
// déclaration, `use()` retombe sur `Record<string, unknown>` : une clé mal
// orthographiée est retirée par Zod au boot, sans un mot.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/documentation": DocumentationConfigInput;
  }
}

@services([DocumentationService])
@controllers([DocumentationController])
class Documentation extends Module<DocumentationConfig> {
  /** Module optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("documentation", kernel, import.meta.url, config);
  }

  /** JSON Schema de la config documentation → data plane admin (config riche Studio). */
  override configSchema(): unknown {
    return documentationConfigJsonSchema();
  }

  /**
   * Phase `onRegister` : valide la config (défauts + override `module-documentation`
   * + env) via `defineDocumentationConfig`, puis la ré-assigne à `this.options`
   * AVANT l'instanciation du `@services` (phase `onBoot`). Plante propre avec
   * messages clairs si la config est invalide (convention Zod figée 2026-05-28).
   */
  override async onKernelRegister(): Promise<this> {
    // Aucun `try`/`catch` : `parseModuleConfig` (cœur) lève déjà une
    // `BootConfigurationError` nommant le module et la clé fautive. Le bloc qui
    // se trouvait ici la RE-EMBALLAIT en `Error` ordinaire, que le kernel absorbe
    // en développement (fail-soft) — le refus disparaissait précisément là où la
    // faute vient d'être écrite.
    this.options = defineDocumentationConfig(this.options);
    return this;
  }

  /**
   * Phase `onReady` : enregistre les fournisseurs de variables `{{ }}` built-in
   * sur le service (tous les modules sont alors bootés). Sources SÛRES seulement
   * (version, identité git) — jamais de secret ni de chemin FS absolu.
   */
  override async onKernelReady(): Promise<this> {
    const svc = this.get<DocumentationService>("documentation");
    if (!svc) return this;
    const root = this.kernel?.path;
    svc.registerVar("version", () => this.kernel?.version ?? "");
    svc.registerVar("branch", () => GitService.branch(root));
    svc.registerVar("commit", () => GitService.read(root).commit);
    return this;
  }
}

export default Documentation;
export { DocumentationService, DocumentationController };
// Le périmètre publié — une seule définition, partagée avec le générateur
// du site public (`scripts/build-docs-site.mjs`).
export {
  ROOT_GROUPS,
  ROOT_PAGES,
} from "./nodefony/service/DocumentationService";

// Config — schéma Zod (source de vérité) + builder
export {
  defineDocumentationConfig,
  documentationConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
export {
  documentationConfigSchema,
  type DocumentationConfig,
} from "./nodefony/config/config";

// Briques pures réutilisables (RAG / SSG futurs)
export {
  parseFrontmatter,
  metaString,
  metaList,
  type Frontmatter,
  type ParsedDoc,
} from "./nodefony/src/frontmatter";
export { scanDocsDir, type ScannedDoc } from "./nodefony/src/docScanner";
export { isSafeSlug, pathToSlug, type DocSource } from "./nodefony/src/slug";
export {
  searchDocs,
  extractSearchText,
  foldText,
  splitSearchTerms,
  type SearchableDoc,
} from "./nodefony/src/search";
export {
  rewriteInternalLinks,
  type RewriteLinksOptions,
} from "./nodefony/src/linkResolver";
export {
  DocumentationError,
  DocNotFoundError,
  DocUnsafeSlugError,
} from "./nodefony/src/errors/DocumentationError";

// Interfaces publiques
export type {
  DocAudience,
  DocStatus,
  DocVarProvider,
  IDocAudienceInfo,
  IDocPageRef,
  IDocSection,
  IDocTree,
  IDocPage,
  IDocumentationService,
} from "./nodefony/interfaces/IDocumentation";
