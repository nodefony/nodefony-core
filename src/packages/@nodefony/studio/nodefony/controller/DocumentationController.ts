/// <reference types="node" />
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Controller, Get, Param, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";

/**
 * Controller Documentation — **DÉMO / POC** (pour décider de l'archi du futur
 * module `@nodefony/documentation`, cf étude de faisabilité 2026-05-25).
 *
 * Démontre le **data plane** d'un portail de doc unifié :
 *  - `GET /nodefony/documentation/api/tree`        → index TRANSVERSE (sections,
 *    pas par module) + tags `audience` (persona : developer / devops / supervisor / admin).
 *  - `GET /nodefony/documentation/api/page/{slug}` → contenu markdown d'une page +
 *    `vars` résolues CÔTÉ SERVEUR (le « registre de providers dynamiques » `{{ }}`).
 *
 * À NE PAS prendre pour le module final : ici tout est en dur (1 page réelle :
 * « socket »). Le vrai module lira les `<module>/docs/*.md` co-localisés (ADR-0001),
 * parsera le frontmatter (audience/section/version) et résoudra les `{{ }}` depuis
 * `symbols.json` / `package.json` / git. Cf [[project_doc_portal_faisabilite]].
 *
 * Sécurité : lecture seule, valeurs SÛRES uniquement (pas de chemin FS absolu, pas
 * de secret). Auth = mock comme le reste de Studio (firewall réel = P6).
 */
@controller("/nodefony")
class DocumentationController extends Controller {
  constructor(context: Context) {
    super("DocumentationController", context);
  }

  /** Index transverse du portail : sections → pages, taguées par audience. */
  @Get("/documentation/api/tree")
  async tree() {
    const rootSections = await this.#listRootDocSections();
    return this.renderJson({
      generatedAt: new Date().toISOString(),
      audiences: [
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
        {
          key: "admin",
          label: "Admin",
          desc: "Accès à toute la documentation.",
        },
      ],
      sections: [
        {
          id: "realtime",
          label: "Realtime — la Socket Nodefony",
          pages: [
            {
              slug: "socket",
              title: "Nodefony Socket — hub + backplane IPC cluster",
              audience: ["developer", "devops", "supervisor"],
              version: "0.1-démo",
              status: "draft",
            },
            {
              slug: "client",
              title: "Client navigateur (RealtimeClient isomorphe)",
              audience: ["developer"],
              version: "0.1-démo",
              status: "draft",
              wip: true,
            },
          ],
        },
        {
          id: "http",
          label: "HTTP — pipeline & serveurs",
          pages: [
            {
              slug: "pipeline",
              title: "Pipeline de requête HTTP/HTTP2",
              audience: ["developer"],
              wip: true,
            },
          ],
        },
        {
          id: "ops",
          label: "Exploitation",
          pages: [
            {
              slug: "cluster",
              title: "Cluster, scaling & cloud-native",
              audience: ["devops", "supervisor"],
              wip: true,
            },
          ],
        },
        {
          id: "roadmap",
          label: "Roadmap (temporaire)",
          pages: [
            {
              slug: "migration",
              title: "MIGRATION_STATUS — état de la migration",
              audience: ["developer", "devops", "supervisor"],
              version: "live",
              status: "live",
            },
          ],
        },
        // Docs EXISTANTES de docs/ racine (hors session-retros), surfacées en direct.
        ...rootSections,
      ],
    });
  }

  /**
   * Scanne `docs/` racine (récursif) en EXCLUANT les retex (`session-retros/`),
   * groupe par dossier de tête → sections du portail. Lit le système de fichiers
   * (hors hot path, admin). Slug = chemin relatif sans `.md`, `/` → `~`.
   */
  async #listRootDocSections(): Promise<unknown[]> {
    const docs = await this.#listRootDocs();
    const labels: Record<string, string> = {
      racine: "docs/ (racine)",
      guides: "Guides",
      adr: "ADR — décisions d'architecture",
      architecture: "Architecture",
      audits: "Audits",
      release: "Releases",
      packages: "Packages",
    };
    const groups = new Map<string, { slug: string; title: string }[]>();
    for (const d of docs) {
      if (!groups.has(d.group)) groups.set(d.group, []);
      groups.get(d.group)!.push({ slug: d.slug, title: d.title });
    }
    return [...groups.entries()].map(([group, pages]) => ({
      id: `root-${group}`,
      label: labels[group] ?? group,
      pages: pages.map((p) => ({
        ...p,
        audience: ["developer", "devops", "supervisor"],
        status: "doc",
      })),
    }));
  }

  /** Liste plate des fichiers markdown de docs/ (hors session-retros). */
  async #listRootDocs(): Promise<
    { slug: string; rel: string; title: string; group: string }[]
  > {
    const root = this.kernel?.path ?? process.cwd();
    const docsDir = join(root, "docs");
    let entries: string[] = [];
    try {
      entries = (await readdir(docsDir, { recursive: true })) as string[];
    } catch {
      return [];
    }
    return entries
      .filter(
        (rel) =>
          rel.endsWith(".md") && !rel.split(/[/\\]/).includes("session-retros"),
      )
      .map((rel) => {
        const norm = rel.replace(/\\/g, "/");
        const parts = norm.split("/");
        const group = parts.length > 1 ? parts[0] : "racine";
        const base = parts[parts.length - 1].replace(/\.md$/, "");
        const title = base
          .replace(/^\d+[-_]/, "")
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return {
          slug: `root~${norm.replace(/\//g, "~").replace(/\.md$/, "")}`,
          rel: norm,
          title,
          group,
        };
      })
      .sort((a, b) => a.rel.localeCompare(b.rel));
  }

  /** Contenu d'une page + variables dynamiques résolues côté serveur. */
  @Get("/documentation/api/page/{slug}")
  async page(@Param("slug") slug: string) {
    // Page TEMPORAIRE : MIGRATION_STATUS.md du repo, pour lecture facile dans Studio.
    // Nom de fichier FIXE (aucune entrée utilisateur dans le chemin → 0 traversée).
    if (slug === "migration") {
      const root = this.kernel?.path ?? process.cwd();
      try {
        const markdown = await readFile(
          join(root, "MIGRATION_STATUS.md"),
          "utf8",
        );
        return this.renderJson({
          slug,
          title: "MIGRATION_STATUS — état de la migration",
          version: "live",
          temporary: true,
          markdown,
        });
      } catch (e) {
        return this.renderJson({
          slug,
          temporary: true,
          error: `MIGRATION_STATUS.md illisible : ${(e as Error).message}`,
          markdown:
            "## MIGRATION_STATUS.md introuvable\n\nFichier non lu côté serveur.",
        });
      }
    }
    // Doc EXISTANTE de docs/ racine : le slug est validé contre le scan (allowlist)
    // → on ne concatène JAMAIS le slug brut dans un chemin (0 traversée de répertoire).
    if (slug.startsWith("root~")) {
      const docs = await this.#listRootDocs();
      const hit = docs.find((d) => d.slug === slug);
      if (!hit) {
        return this.renderJson({ slug, error: "Document inconnu." });
      }
      const root = this.kernel?.path ?? process.cwd();
      try {
        const markdown = await readFile(join(root, "docs", hit.rel), "utf8");
        return this.renderJson({
          slug,
          title: hit.title,
          version: "doc",
          source: `docs/${hit.rel}`,
          markdown,
        });
      } catch (e) {
        return this.renderJson({
          slug,
          error: `Lecture impossible : ${(e as Error).message}`,
          markdown: `## ${hit.title}\n\nFichier illisible.`,
        });
      }
    }

    if (slug !== "socket") {
      return this.renderJson({
        slug,
        wip: true,
        error:
          "Page de démo non rédigée (le module final lira <module>/docs/*.md).",
      });
    }
    // Le « registre de providers » : valeurs résolues à la lecture, côté serveur.
    // SÛRES uniquement (aucun chemin FS, aucun secret). Le vrai module y branchera
    // symbols.json / package.json / git.
    const vars = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      env: String(this.kernel?.environment ?? "—"),
      pid: process.pid,
      framework: "@nodefony/http",
    };
    return this.renderJson({
      slug,
      title: "Nodefony Socket — hub + backplane IPC cluster",
      audience: ["developer", "devops", "supervisor"],
      version: "0.1-démo",
      status: "draft",
      vars,
      markdown: SOCKET_MD,
    });
  }
}

/**
 * Contenu markdown de démo (la « source » qu'écrira l'auteur). Inclut :
 *  - des `{{ var }}` résolus côté serveur (providers dynamiques) ;
 *  - un bloc ```mermaid``` (convention d'authoring : schéma écrit dans le texte).
 */
const SOCKET_MD = `## La Socket Nodefony, en une phrase

Une **seule prise** (\`IRealtimeSocket\`) côté client et serveur qui multiplexe *N* canaux
en duplex, quel que soit le transport dessous (pub/sub, IPC cluster, Redis, SIP…).

> 🔌 **Analogie — le fond de panier (backplane).** Dans un serveur rackable, le *backplane*
> est la carte au fond du châssis où **toutes les cartes se branchent** : elles communiquent
> sans se câbler une à une. Le **\`IBackplane\`** de Nodefony joue ce rôle entre les *workers* :
> un message publié sur un worker ressort sur **tous** les autres, sans que le code applicatif
> sache s'il y a 1 ou 50 process. Loopback (mono-process) → IPC (cluster) → Redis (multi-pod) :
> **même prise, on change juste le fond de panier.**

## Les couches (de haut en bas)

1. **RealtimeClient** *(navigateur, isomorphe)* — \`subscribe / on / publish / request\`.
2. **Transport** \`IRealtimeTransport\` — WSS aujourd'hui ; seul point qui connaît le réseau.
3. **JsonRpcPeer** — protocole **JSON-RPC 2.0** (le même des deux côtés, isomorphe).
4. **RealtimeHub** *(broker serveur)* — pub/sub par canal, **fan-out** vers les abonnés.
5. **IBackplane** *(fond de panier)* — propage les publications **entre workers**.
6. **Workers / pods** — chaque process se branche sur le backplane.

## Flux subscribe → publish en cluster

\`\`\`mermaid
sequenceDiagram
  participant B as Navigateur
  participant W1 as Worker A (Hub)
  participant BP as IBackplane (IPC)
  participant W2 as Worker B (Hub)
  B->>W1: subscribe("orm:health")
  Note over W2: une requête tombe sur Worker B
  W2->>BP: publish("orm:health", payload)
  BP-->>W1: fan-out cross-process
  W1-->>B: push("orm:health", payload)
\`\`\`

Le navigateur est abonné sur **Worker A** mais l'événement naît sur **Worker B** : le
backplane (ici l'**IPC du cluster Node**) fait traverser le message — l'abonné le reçoit
quand même. C'est l'invariant « *même prise, peu importe le worker* ».

---

*Page générée le **{{generatedAt}}** · Node **{{node}}** · env **{{env}}** · pid **{{pid}}** ·
brique **{{framework}}**. Ces valeurs sont **résolues côté serveur** (registre de providers
\`{{ }}\`) — la doc cite l'état réel, elle n'est pas figée.*
`;

export default DocumentationController;
