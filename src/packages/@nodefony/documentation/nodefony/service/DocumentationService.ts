import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  Container,
  GitService,
  Module,
  Service,
  type Message,
  type Msgid,
  type Pci,
  type Severity,
} from "nodefony";
import { scanDocsDir, type ScannedDoc } from "../src/docScanner";
import { parseFrontmatter, metaList, metaString } from "../src/frontmatter";
import { isSafeSlug } from "../src/slug";
import {
  DocNotFoundError,
  DocUnsafeSlugError,
} from "../src/errors/DocumentationError";
import type { DocumentationConfig } from "../config/schema";
import type {
  DocAudience,
  DocStatus,
  DocVarProvider,
  IDocAudienceInfo,
  IDocPage,
  IDocPageRef,
  IDocSection,
  IDocTree,
} from "../interfaces/IDocumentation";

const serviceName = "documentation";

/** Personas connues — descriptions affichées par le sélecteur de vue Studio. */
const AUDIENCES: readonly IDocAudienceInfo[] = [
  {
    key: "developer",
    label: "Développeur",
    desc: "Doc technique : architecture, contrats, API internes.",
  },
  {
    key: "devops",
    label: "DevOps",
    desc: "Déploiement, cluster, scaling, backplane (fond de panier).",
  },
  {
    key: "supervisor",
    label: "Superviseur",
    desc: "Observabilité : santé, métriques temps réel, alertes.",
  },
  { key: "admin", label: "Admin", desc: "Accès à toute la documentation." },
];

const VALID_AUDIENCES = new Set<string>(AUDIENCES.map((a) => a.key));
const VALID_STATUS = new Set<string>([
  "stable",
  "draft",
  "temporary",
  "experimental",
  "deprecated",
]);

/** Libellés « jolis » par chemin de groupe racine (sinon fallback auto). */
const ROOT_GROUP_LABELS: Record<string, string> = {
  racine: "docs/ (racine)",
  guides: "Guides",
  adr: "ADR — décisions d'architecture",
  architecture: "Architecture",
  audits: "Audits",
  release: "Releases",
  packages: "Packages",
  realtime: "Realtime",
  "realtime/socket": "Realtime / La Socket Nodefony",
};

/** Snapshot caché : docs scannés + arbre construit + index slug→doc. */
interface CacheEntry {
  at: number;
  tree: IDocTree;
  index: Map<string, ScannedDoc>;
}

/**
 * Service de documentation Nodefony — **headless** : produit l'index transverse
 * et le contenu résolu des pages, sans rendre aucun HTML (le front Studio, un
 * générateur statique ou le RAG le consomment).
 *
 * Sources scannées (config `scan`) : le dossier `docs/` racine (transverse) +
 * les `<module>/docs/*.md` co-localisés (ADR-0001) si `includeModules`.
 *
 * Perf/mémoire (règle absolue) : tout est lazy. L'index est construit au 1ᵉʳ
 * accès et caché avec un TTL (`cache.ttlMs`) — le scan FS n'est PAS refait à
 * chaque requête. Le registre de variables `{{ }}` est alloué au 1ᵉʳ
 * `registerVar`. 0 alloc par requête hors la lecture froide d'une page (chemin
 * admin, pas le hot path applicatif).
 */
class DocumentationService extends Service {
  module: Module;
  /** Snapshot caché (index + arbre) — `null` tant qu'aucun scan. */
  #cache: CacheEntry | null = null;
  /** Fournisseurs de variables `{{ }}` — `null` tant qu'aucun enregistré. */
  #vars: Map<string, DocVarProvider> | null = null;

  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      null,
      (module.options as Record<string, unknown>) ?? {},
    );
    this.module = module;
  }

  override log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message) {
    if (!msgid) {
      // eslint-disable-next-line no-param-reassign
      msgid = `\x1b[36mDOCUMENTATION\x1b[0m`;
    }
    return super.log(pci, severity, msgid, msg);
  }

  /** Config validée du module (réassignée à `module.options` au onKernelRegister). */
  #config(): DocumentationConfig {
    return this.module.options as unknown as DocumentationConfig;
  }

  /** Racine du projet (où vit `docs/` transverse). */
  #projectRoot(): string {
    return this.kernel?.path ?? process.cwd();
  }

  // ───────────────────────── API publique ─────────────────────────

  registerVar(name: string, provider: DocVarProvider): void {
    if (this.#vars === null) this.#vars = new Map();
    this.#vars.set(name, provider);
  }

  invalidate(): void {
    this.#cache = null;
  }

  async getTree(): Promise<IDocTree> {
    return (await this.#ensureCache()).tree;
  }

  async getPage(slug: string): Promise<IDocPage> {
    // Garde défense-en-profondeur AVANT toute recherche/lecture (anti-traversée).
    if (!isSafeSlug(slug)) throw new DocUnsafeSlugError(slug);

    const { index } = await this.#ensureCache();
    const doc = index.get(slug);
    if (!doc) throw new DocNotFoundError(slug);

    // Lecture du chemin RÉEL connu (jamais reconstruit depuis le slug).
    const raw = await readFile(doc.absPath, "utf8");
    const { meta, body } = parseFrontmatter(raw);

    const repoRel = relative(this.#projectRoot(), doc.absPath).replace(
      /\\/g,
      "/",
    );
    const source = metaString(meta, "source") ?? repoRel;

    return {
      slug: doc.slug,
      title: metaString(meta, "title") ?? doc.title,
      version: metaString(meta, "version") ?? "doc",
      status: this.#coerceStatus(metaString(meta, "status")),
      updated: metaString(meta, "updated"),
      source,
      sourceUrl: this.#buildSourceUrl(source),
      markdown: this.#resolveVars(body),
    };
  }

  // ───────────────────────── interne ─────────────────────────

  /** Sert le cache si frais (TTL), sinon rescanne et reconstruit l'arbre. */
  async #ensureCache(): Promise<CacheEntry> {
    const ttl = this.#config().cache.ttlMs;
    const now = Date.now();
    if (this.#cache && ttl > 0 && now - this.#cache.at < ttl) {
      return this.#cache;
    }
    const docs = await this.#scanAll();
    const index = new Map<string, ScannedDoc>();
    for (const d of docs) index.set(d.slug, d);
    const tree: IDocTree = {
      generatedAt: new Date(now).toISOString(),
      audiences: [...AUDIENCES],
      sections: this.#buildSections(docs),
    };
    this.#cache = { at: now, tree, index };
    return this.#cache;
  }

  /** Scanne la racine + (si activé) les `<module>/docs/` de chaque module. */
  async #scanAll(): Promise<ScannedDoc[]> {
    const cfg = this.#config();
    const exclude = cfg.scan.exclude;
    const root = this.#projectRoot();

    const out: ScannedDoc[] = [];
    out.push(
      ...(await scanDocsDir(
        join(root, cfg.scan.rootDir),
        { kind: "root" },
        exclude,
      )),
    );

    if (cfg.scan.includeModules) {
      const modules = this.kernel?.getModules?.() ?? {};
      const scans = Object.values(modules)
        // L'app = la racine du projet → son docs/ EST le docs/ transverse déjà
        // scanné ci-dessus. On l'exclut pour ne pas dupliquer.
        .filter((m) => m && !m.isApp && m.path)
        .map((m) =>
          scanDocsDir(
            join(m.path, "docs"),
            { kind: "module", module: m.name },
            exclude,
          ),
        );
      for (const docs of await Promise.all(scans)) out.push(...docs);
    }
    return out;
  }

  /** Regroupe les docs scannés en sections (racine par dossier, module par module). */
  #buildSections(docs: ScannedDoc[]): IDocSection[] {
    const rootGroups = new Map<string, ScannedDoc[]>();
    const moduleGroups = new Map<string, ScannedDoc[]>();

    for (const d of docs) {
      if (d.source.kind === "root") {
        (rootGroups.get(d.group) ?? setGet(rootGroups, d.group)).push(d);
      } else {
        const key = d.source.module;
        (moduleGroups.get(key) ?? setGet(moduleGroups, key)).push(d);
      }
    }

    const rootSections: IDocSection[] = [...rootGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, pages]) => ({
        id: `root-${group.replace(/\//g, "~")}`,
        label: this.#rootLabel(group),
        pages: pages.map((p) => this.#toPageRef(p)),
      }));

    const moduleSections: IDocSection[] = [...moduleGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mod, pages]) => ({
        id: `mod-${mod}`,
        label: `Module ${mod}`,
        module: mod,
        pages: pages.map((p) => this.#toPageRef(p)),
      }));

    return [...rootSections, ...moduleSections];
  }

  /** Convertit un doc scanné en référence d'arbre (métadonnées seules). */
  #toPageRef(d: ScannedDoc): IDocPageRef {
    const audience = metaList(d.meta, "audience").filter((a) =>
      VALID_AUDIENCES.has(a),
    ) as DocAudience[];
    const ref: IDocPageRef = { slug: d.slug, title: d.title, audience };
    const version = metaString(d.meta, "version");
    if (version) ref.version = version;
    const status = this.#coerceStatus(metaString(d.meta, "status"));
    if (status) ref.status = status;
    return ref;
  }

  /** Libellé d'une section racine (mapping connu, sinon auto-capitalisé). */
  #rootLabel(group: string): string {
    return (
      ROOT_GROUP_LABELS[group] ??
      group
        .split("/")
        .map((s) =>
          s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        )
        .join(" / ")
    );
  }

  /** Restreint une valeur libre au type `DocStatus` (sinon `undefined`). */
  #coerceStatus(value: string | undefined): DocStatus | undefined {
    return value && VALID_STATUS.has(value) ? (value as DocStatus) : undefined;
  }

  /**
   * Remplace les variables `{{ name }}` par la valeur de leur fournisseur
   * enregistré. Variable inconnue → laissée telle quelle (signale à l'auteur
   * qu'il manque un provider, plutôt que de masquer silencieusement).
   */
  #resolveVars(markdown: string): string {
    if (this.#vars === null || this.#vars.size === 0) return markdown;
    const vars = this.#vars;
    return markdown.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) => {
      const provider = vars.get(name as string);
      if (!provider) return whole;
      try {
        return provider();
      } catch {
        return whole; // un provider qui throw ne casse jamais le rendu
      }
    });
  }

  /**
   * Construit le lien « Modifier sur GitHub » d'une page à partir d'un chemin
   * RELATIF au repo. Branche = config explicite, sinon branche git réelle
   * (`GitService`), sinon `main`. N'expose jamais de chemin FS absolu.
   */
  #buildSourceUrl(repoRelPath: string): string {
    const repo = this.#config().repo;
    const branch =
      repo.branch ?? (GitService.branch(this.#projectRoot()) || "main");
    const base = repo.url.replace(/\/+$/, "");
    return `${base}/${repo.editPathPrefix}/${branch}/${repoRelPath}`;
  }
}

/** Crée et insère une liste vide dans une Map, et la retourne (helper groupBy). */
function setGet<K>(map: Map<K, ScannedDoc[]>, key: K): ScannedDoc[] {
  const arr: ScannedDoc[] = [];
  map.set(key, arr);
  return arr;
}

export default DocumentationService;
export type { DocumentationConfig };
