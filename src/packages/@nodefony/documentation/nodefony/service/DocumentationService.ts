import { readFile } from "node:fs/promises";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
import { rewriteInternalLinks } from "../src/linkResolver";
import {
  searchDocs,
  splitSearchTerms,
  type SearchableDoc,
} from "../src/search";
import {
  DocNotFoundError,
  DocUnsafeSlugError,
} from "../src/errors/DocumentationError";
import { stripTrailingSlashes } from "nodefony";
import type { DocumentationConfig } from "../config/config";
import type {
  DocAudience,
  DocStatus,
  DocVarProvider,
  IDocAudienceInfo,
  IDocPage,
  IDocPageRef,
  IDocSearchResult,
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

/**
 * Les groupes racine publiés, **dans l'ordre du menu**, avec leur libellé.
 *
 * L'ordre est PÉDAGOGIQUE, jamais alphabétique, et il part du geste : on fait une
 * première fois en étant guidé (tutoriels), on refait seul sur un besoin précis
 * (guides), puis on comprend ce qui se passait dessous (architecture). Un tri
 * alphabétique mettait « ADR » en tête et « Tutoriels » en cinquième position —
 * l'inverse exact du chemin de lecture.
 *
 * ⚠️ **C'est la SEULE définition de ce périmètre.** Le générateur du site public
 * (`scripts/build-docs-site.mjs`) l'importe depuis le `dist` de ce module — il en
 * importait déjà les briques de scan — au lieu d'en tenir une copie. Une copie a
 * existé ici, sous le prétexte d'une frontière de paquets que le script
 * franchissait pourtant déjà ; elle avait commencé à diverger. N'en réintroduire
 * aucune : le portail et le site doivent publier les MÊMES sections, sinon un
 * lecteur trouve dans l'un ce que l'autre lui cache.
 */
export const ROOT_GROUPS: ReadonlyArray<{ group: string; label: string }> = [
  { group: "tutoriels", label: "Tutoriels" },
  { group: "guides", label: "Guides" },
  { group: "architecture", label: "Architecture" },
];

/**
 * Pages de `docs/` (à la racine, hors sous-dossier) publiées dans le menu, dans
 * cet ordre. Le reste de ce dossier est du PILOTAGE — carte des phases, README du
 * corpus, essai sur l'outillage : utile au mainteneur du framework, illisible
 * pour qui construit une application.
 *
 * Comme {@link ROOT_GROUPS}, c'est la seule définition : le site public l'importe.
 */
export const ROOT_PAGES: ReadonlyArray<string> = [
  "index",
  "demarrer",
  "lexique",
];

/** Libellé du groupe qui porte les pages de `docs/` elles-mêmes. */
const ROOT_PAGES_LABEL = "Pour commencer";

/** Snapshot caché : docs scannés + arbre construit + index slug→doc. */
interface CacheEntry {
  at: number;
  tree: IDocTree;
  index: Map<string, ScannedDoc>;
  /** Chemin relatif au dépôt → slug (traduction des liens internes d'une page). */
  byPath: Map<string, string>;
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

  /**
   * Cherche `query` dans le corpus — titres ET corps — et rend des EXTRAITS.
   *
   * Pourquoi une recherche à part, et pas un filtre de l'arbre : filtrer le menu
   * ne répond qu'à « quelle page s'appelle ainsi ? ». La question réelle est
   * « où est-ce expliqué ? », dont la réponse est dans le CORPS des pages. Une
   * recherche qui ne lit que les titres laisse croire qu'un sujet n'est pas
   * documenté alors qu'il l'est, dans une page dont le nom ne le dit pas.
   *
   * Tout est borné : le nombre de pages rendues, le nombre d'extraits par page,
   * la longueur d'un extrait. Le total AVANT bornage est rendu à part
   * (`matched`), pour que « 20 résultats » ne se lise pas comme « il n'y en a
   * que 20 ».
   *
   * @param query - la saisie brute de l'utilisateur.
   * @param limit - nombre maximal de pages rendues (défaut 20).
   * @returns les pages retenues, leurs extraits, et ce qui a été balayé.
   */
  async search(query: string, limit = 20): Promise<IDocSearchResult> {
    if (splitSearchTerms(query).length === 0) {
      return { query, terms: [], scanned: 0, matched: 0, hits: [] };
    }

    const { tree, index } = await this.#ensureCache();
    // La section d'arbre qui porte chaque page — c'est ce qui situe un résultat.
    const sectionOf = new Map<string, string>();
    for (const s of tree.sections) {
      for (const p of s.pages) sectionOf.set(p.slug, s.label);
    }

    const corpus: SearchableDoc[] = [];
    for (const doc of index.values()) {
      // Une page hors de l'arbre n'est pas atteignable : la proposer mènerait
      // à un cul-de-sac.
      const sectionLabel = sectionOf.get(doc.slug);
      if (sectionLabel === undefined) continue;
      let raw: string;
      try {
        raw = await readFile(doc.absPath, "utf8");
      } catch {
        continue;
      }
      const { body } = parseFrontmatter(raw);
      corpus.push({
        slug: doc.slug,
        title: doc.title,
        navTitle: doc.navTitle,
        sectionLabel,
        body,
      });
    }

    // Le classement lui-même vit dans une brique PURE, parce que le site public
    // — qui n'a pas de serveur — fait tourner exactement la même fonction dans
    // le navigateur du lecteur. Deux copies divergeraient en silence : la
    // recherche du portail et celle du site ne rendraient plus les mêmes pages.
    return searchDocs(corpus, query, limit);
  }

  async getPage(slug: string): Promise<IDocPage> {
    // Garde défense-en-profondeur AVANT toute recherche/lecture (anti-traversée).
    if (!isSafeSlug(slug)) throw new DocUnsafeSlugError(slug);

    const { index, byPath } = await this.#ensureCache();
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
      markdown: this.#resolveLinks(this.#resolveVars(body), doc, byPath),
    };
  }

  /**
   * Traduit les liens internes de la page en slugs navigables.
   *
   * Les pages se lient par chemin relatif (lisible sur GitHub et dans l'éditeur) ;
   * le portail navigue par slug. Seul le serveur connaît la table chemin → slug,
   * donc la traduction se fait ici — sans quoi toute remontée (`../index.md`)
   * arrive au client comme une ancre morte.
   */
  #resolveLinks(
    markdown: string,
    from: ScannedDoc,
    byPath: Map<string, string>,
  ): string {
    const root = this.#projectRoot();
    const fromDir = relative(root, dirname(from.absPath)).replace(/\\/g, "/");
    return rewriteInternalLinks(markdown, {
      fromDir,
      toSlug: (repoRel) => byPath.get(repoRel),
    });
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
    // Table chemin-repo → slug : ce qui permet de traduire un lien relatif écrit
    // dans une page (`../index.md`) en cible navigable (cf #resolveLinks).
    const byPath = new Map<string, string>();
    const root = this.#projectRoot();
    for (const d of docs) {
      index.set(d.slug, d);
      byPath.set(relative(root, d.absPath).replace(/\\/g, "/"), d.slug);
    }
    const tree: IDocTree = {
      generatedAt: new Date(now).toISOString(),
      audiences: [...AUDIENCES],
      sections: this.#buildSections(docs),
    };
    this.#cache = { at: now, tree, index, byPath };
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

    if (cfg.scan.includeInstalled) {
      const seen = new Set(
        out
          .filter((d) => d.source.kind === "module")
          .map((d) => (d.source as { module: string }).module),
      );
      for (const [name, dir] of this.#installedDocDirs(root)) {
        if (seen.has(name)) continue; // déjà couvert par le module chargé
        out.push(
          ...(await scanDocsDir(
            dir,
            { kind: "module", module: name },
            exclude,
          )),
        );
      }
    }
    return out;
  }

  /**
   * Dossiers `docs/` des paquets Nodefony **installés** (chargés ou non).
   *
   * Un module qu'on n'a pas encore activé est justement celui dont on lit la doc
   * — sans ça, le portail renvoie dans le vide sur `redis`, `mongoose`… tant
   * qu'ils ne sont pas dans le manifeste.
   *
   * Les chemins sont résolus en **real-path** : en dépôt workspace,
   * `node_modules/@nodefony/x` est un lien vers `src/packages/@nodefony/x`, et
   * c'est la source qui doit indexer (sinon les liens entre pages ne se
   * résolvent pas — deux chemins pour un même fichier).
   */
  #installedDocDirs(root: string): Map<string, string> {
    const found = new Map<string, string>();
    const add = (name: string, dir: string): void => {
      try {
        if (!statSync(dir).isDirectory()) return;
        found.set(name, realpathSync(dir));
      } catch {
        /* pas de docs/ dans ce paquet — rien à indexer */
      }
    };
    // Le cœur du framework, publié sous le nom `nodefony`.
    add("nodefony", join(root, "node_modules/nodefony/docs"));
    const scope = join(root, "node_modules/@nodefony");
    let entries: string[] = [];
    try {
      entries = readdirSync(scope);
    } catch {
      return found; // pas de scope installé (app hors npm) → rien de plus
    }
    for (const pkg of entries) add(pkg, join(scope, pkg, "docs"));
    return found;
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

    // « Pour commencer » — les pages de `docs/` elles-mêmes, dans l'ordre déclaré.
    // `index` en fait partie : c'est l'accueil du corpus, et le retirer d'ici
    // faisait retomber le front sur le premier hub venu comme page par défaut.
    // C'est le RENDU qui évite de l'afficher deux fois, pas le contrat.
    const racine = (rootGroups.get("racine") ?? []).filter((d) =>
      ROOT_PAGES.includes(d.relPath.replace(/\.md$/i, "")),
    );
    const pourCommencer: IDocSection[] = racine.length
      ? [
          {
            id: "root-pour-commencer",
            label: ROOT_PAGES_LABEL,
            pages: ROOT_PAGES.map((n) =>
              racine.find((d) => d.relPath.replace(/\.md$/i, "") === n),
            )
              .filter((d): d is ScannedDoc => Boolean(d))
              .map((d) => this.#toPageRef(d)),
          },
        ]
      : [];

    // Les groupes PUBLIÉS, dans l'ordre déclaré — pas dans celui de l'alphabet.
    // Ce qui n'est pas déclaré (décisions d'architecture, plan de publication,
    // documents de pilotage) ne descend pas dans le menu : c'est de la référence
    // de mainteneur, et elle noyait le chemin de lecture.
    const rootSections: IDocSection[] = ROOT_GROUPS.map(({ group, label }) => {
      const pages = rootGroups.get(group);
      return pages?.length
        ? {
            id: `root-${group.replace(/\//g, "~")}`,
            label,
            pages: this.#orderPages(pages),
          }
        : null;
    }).filter((s): s is IDocSection => s !== null);

    // Le cœur d'abord — c'est ce dont tout le reste dépend —, les autres modules
    // par ordre alphabétique : entre `drizzle` et `redis`, aucun ordre de lecture
    // ne s'impose, et l'alphabet est alors le plus prévisible.
    const moduleSections: IDocSection[] = [...moduleGroups.entries()]
      .sort(([a], [b]) => {
        if (a === b) return 0;
        if (a === "nodefony") return -1;
        if (b === "nodefony") return 1;
        return a.localeCompare(b);
      })
      .map(([mod, pages]) => ({
        id: `mod-${mod}`,
        label: mod === "nodefony" ? "Cœur" : mod,
        module: mod,
        pages: this.#orderPages(pages),
      }));

    return [...pourCommencer, ...rootSections, ...moduleSections];
  }

  /**
   * Ordonne les pages d'une section : le **hub en premier**, le reste ensuite.
   *
   * Un `index.md` trié alphabétiquement atterrit au milieu de ses propres pages
   * (entre `headers` et `lexique` pour la sécurité) — le point d'entrée devient
   * alors invisible. Le hub ouvre sa section ; c'est le chemin de lecture normal.
   */
  #orderPages(pages: ScannedDoc[]): IDocPageRef[] {
    const refs = pages.map((p) => this.#toPageRef(p));
    // `index.md` d'abord, `README.md` EN REPLI — pas les deux à égalité. Deux
    // dossiers du corpus (`guides`, `architecture`) portent leur accueil sous le
    // nom `README.md`, que GitHub rend en ouvrant le répertoire ; sans ce repli
    // leur page d'accueil tombait au MILIEU de sa propre section, triée à
    // l'alphabet, sous le libellé « README ». Traiter les deux comme hub aurait
    // été pire : `docs/` porte les DEUX fichiers, et la section aurait eu deux
    // points d'entrée concurrents.
    if (!refs.some((r) => r.isHub)) {
      const readme = pages.findIndex((p) =>
        /(^|\/)readme\.md$/i.test(p.relPath),
      );
      if (readme !== -1) refs[readme]!.isHub = true;
    }
    return refs.sort((a, b) => {
      if (a.isHub !== b.isHub) return a.isHub ? -1 : 1;
      // Trier sur le libellé AFFICHÉ, pas sur le titre complet : le menu montre
      // `navTitle`, et trier sur autre chose que ce qu'on voit donne un ordre
      // qui paraît tiré au sort.
      return a.navTitle.localeCompare(b.navTitle);
    });
  }

  /** Convertit un doc scanné en référence d'arbre (métadonnées seules). */
  #toPageRef(d: ScannedDoc): IDocPageRef {
    const audience = metaList(d.meta, "audience").filter((a) =>
      VALID_AUDIENCES.has(a),
    ) as DocAudience[];
    // Un `index.md` est le HUB de sa section : point d'entrée, pas page comme une autre.
    const isHub = /(^|\/)index\.md$/i.test(d.relPath);
    const ref: IDocPageRef = {
      slug: d.slug,
      title: d.title,
      navTitle: d.navTitle,
      audience,
      isHub,
    };
    const version = metaString(d.meta, "version");
    if (version) ref.version = version;
    const status = this.#coerceStatus(metaString(d.meta, "status"));
    if (status) ref.status = status;
    return ref;
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
    const base = stripTrailingSlashes(repo.url);
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
