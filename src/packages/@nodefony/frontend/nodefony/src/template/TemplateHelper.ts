import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { PLATFORM_EVENTS } from "nodefony";
import type { IViteSupervisor } from "../../interfaces/IViteSupervisor";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder";

/**
 * Chemin résolu (1×, caché) du build navigateur de la debug bar Nodefony
 * (`nodefony/debugbar`). `undefined` = pas encore tenté, `null` = irrésolu.
 */
let debugbarFile: string | null | undefined;

/** Une entrée du `manifest.json` de Vite (champs utiles seulement). */
interface ViteManifestChunk {
  file: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
}
type ViteManifest = Record<string, ViteManifestChunk>;

/** Marqueur optionnel dans l'`index.html` du module où injecter les tags. */
const FRONTEND_MARKER = "<!--nodefony:frontend-->";

/** Échappe une string pour usage littéral dans une RegExp. */
const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Génère les balises HTML à injecter dans la page rendue côté serveur
 * pour brancher le frontend Vite.
 *
 * Dev : `<script type="module" src="http://host:port/@vite/client">` + entry.
 * Prod : lira `manifest.json` du build pour les chemins fingerprintés (TODO).
 */
export class TemplateHelper {
  /**
   * Manifests Vite parsés, cachés par `outDir` (lecture disque 1× par bundle).
   * `null` = lecture tentée mais manifest absent/illisible (build manquant).
   */
  private readonly manifestCache = new Map<string, ViteManifest | null>();

  /** `index.html` des modules, caché par `root` (prod only — dev re-lit). */
  private readonly indexCache = new Map<string, string | null>();

  /**
   * @param supervisor superviseur Vite (dev) — `null` en prod (Vite ne tourne pas).
   * @param mode bascule dev (URLs vers le dev server) / prod (manifest).
   * @param entries entrées résolues — requises en prod pour `outDir`/`publicPath`.
   * @param assetBaseUrl base CDN normalisée (sans slash final) préfixant les URLs
   *   prod émises ; `""` = origine Nodefony (chemins relatifs).
   */
  constructor(
    private readonly supervisor: IViteSupervisor | null,
    private readonly mode: "development" | "production",
    private readonly entries: ReadonlyArray<IResolvedFrontendEntry> = [],
    private readonly assetBaseUrl: string = "",
  ) {}

  /**
   * Tags à injecter dans `<head>` (ou avant `</body>`) pour une entrée donnée.
   * @param entryName nom logique de l'entrée (matche `entryName` dans IResolvedFrontendEntry)
   * @param nonce nonce CSP de la requête (`Context.cspNonce`) — posé sur les `<script>`
   *   pour satisfaire `script-src 'nonce-…'` (preamble inline dev + entrée prod).
   */
  renderTags(entryName: string, nonce?: string): string {
    if (this.mode === "development") {
      return this.renderDevTags(entryName, nonce);
    }
    return this.renderProdTags(entryName, nonce);
  }

  /**
   * Document HTML complet pour une entrée : lit l'`index.html` du module (le dev
   * y met SES meta/polices/scripts externes), retire le `<script type=module>`
   * de l'entrée source (Vite-native, non résolvable quand Nodefony sert la page)
   * et injecte les tags Nodefony — au marqueur `<!--nodefony:frontend-->` sinon
   * avant `</head>`. Pas d'`index.html` → coquille minimale générée.
   *
   * @param entryName nom logique de l'entrée
   */
  renderDocument(entryName: string, nonce?: string): string {
    const tags = this.renderTags(entryName, nonce);
    const entry =
      this.entries.find((e) => e.entryName === entryName) ??
      this.supervisor?.status().entries.find((e) => e.entryName === entryName);
    const html = entry ? this.loadIndexHtml(entry.root) : null;
    if (!html) {
      return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
${tags}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
    }
    return this.injectIntoHtml(html, tags, entry!.entryFile);
  }

  /** Injecte `tags` dans `html` (marqueur > `</head>` > `</body>` > append). */
  private injectIntoHtml(
    html: string,
    tags: string,
    entryFile: string,
  ): string {
    // Retire le <script type=module src=…entry…> source : en page servie par
    // Nodefony il pointe vers un chemin que seul le dev server Vite résout.
    const base = escapeRe(entryFile.replace(/\\/g, "/").split("/").pop() ?? "");
    const stripped = base
      ? html.replace(
          new RegExp(
            `<script\\b[^>]*type=["']module["'][^>]*src=["'][^"']*${base}["'][^>]*>\\s*</script>`,
            "i",
          ),
          "",
        )
      : html;
    if (stripped.includes(FRONTEND_MARKER)) {
      return stripped.replace(FRONTEND_MARKER, tags);
    }
    if (/<\/head>/i.test(stripped)) {
      return stripped.replace(/<\/head>/i, `${tags}\n</head>`);
    }
    if (/<\/body>/i.test(stripped)) {
      return stripped.replace(/<\/body>/i, `${tags}\n</body>`);
    }
    return stripped + tags;
  }

  /**
   * Lit `${root}/index.html`. Caché par root en **prod** (hot path) ; en dev,
   * re-lu à chaque appel pour refléter les éditions du shell. `null` si absent.
   */
  private loadIndexHtml(root: string): string | null {
    if (this.mode === "production") {
      const cached = this.indexCache.get(root);
      if (cached !== undefined) return cached;
    }
    let html: string | null = null;
    try {
      html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    } catch {
      html = null;
    }
    if (this.mode === "production") this.indexCache.set(root, html);
    return html;
  }

  private renderDevTags(entryName: string, nonce?: string): string {
    if (!this.supervisor) {
      return `<!-- @nodefony/frontend: no vite supervisor (dev) -->`;
    }
    const status = this.supervisor.status();
    if (status.state !== "ready") {
      // Tag commentaire HTML — UX dev : indique que Vite n'est pas prêt.
      return `<!-- @nodefony/frontend: vite supervisor state=${status.state} -->`;
    }
    const entry = status.entries.find((e) => e.entryName === entryName);
    if (!entry) {
      return `<!-- @nodefony/frontend: unknown entry "${entryName}" -->`;
    }
    const baseUrl = `${status.https ? "https" : "http"}://${status.host}:${status.port}`;
    // Multi-bundle (P14.6) : URL via `/@fs/<absolute>` plutôt que relative au
    // root Vite unique. Sans ça, deux consumers qui ont chacun `frontend/src/main.tsx`
    // produisent la même URL `${baseUrl}/src/main.tsx` et Vite résout contre le
    // root du PREMIER consumer pour les deux pages.
    // Slash backslash → URL : normalise pour Windows (path.resolve renvoie OS-native).
    const absEntryPath = path
      .resolve(entry.root, entry.entryFile)
      .replace(/\\/g, "/");
    // absEntryPath commence par `/` sur Unix, par `C:/...` sur Windows.
    // Vite accepte `/@fs/C:/...` sur Windows et `/@fs/abs/path` sur Unix.
    const fsPath = absEntryPath.startsWith("/")
      ? `/@fs${absEntryPath}`
      : `/@fs/${absEntryPath}`;
    const entryUrl = `${baseUrl}${fsPath}`;
    const tags: string[] = [];
    // Nonce CSP (étape B) : posé sur le preamble INLINE (obligatoire — `script-src
    // 'nonce-…'` sans `'unsafe-inline'`) ET sur les `<script src>` Vite (cohérence +
    // ouvre `strict-dynamic`). Vide si nonce absent (security off) → inoffensif.
    const n = nonce ? ` nonce="${nonce}"` : "";
    // Preamble React Fast Refresh — requis par @vitejs/plugin-react. Sans ça,
    // l'app crash au boot avec : "@vitejs/plugin-react can't detect preamble".
    // Normalement injecté par Vite via `transformIndexHtml` — mais ici c'est
    // Nodefony qui rend le HTML, donc on doit l'inliner nous-mêmes AVANT
    // le `@vite/client` et l'entry.
    if (entry.type === "react19") {
      tags.push(
        `<script type="module"${n}>
import RefreshRuntime from "${baseUrl}/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>`,
      );
    }
    tags.push(
      `<script type="module"${n} src="${baseUrl}/@vite/client"></script>`,
    );
    tags.push(`<script type="module"${n} src="${entryUrl}"></script>`);
    // Pont HMR : relaie les hot-updates Vite vers un CustomEvent `window` que la
    // debug bar observe. Branché sur `createHotContext` (réutilise le client
    // `@vite/client` DÉJÀ chargé) → AUCUNE connexion WebSocket supplémentaire
    // (≠ ancienne sonde qui ouvrait un 2ᵉ client `vite-hmr` en boucle).
    tags.push(this.hmrBridgeTag(baseUrl, n));
    // Debug bar Nodefony (dev only, auto) — vitrine realtime + HMR fusionnés au
    // runtime. Le script est servi depuis le build navigateur du Core via Vite
    // (`/@fs/<abs>`) ; on lui injecte le framework + l'origine.
    const dbg = this.debugBarTag(baseUrl, entry.type, entryName, n);
    if (dbg) tags.push(dbg);
    return tags.join("\n");
  }

  /**
   * Pont HMR sans socket : relaie les événements globaux de Vite
   * (`vite:afterUpdate`, etc.) vers un `CustomEvent` `nodefony:hmr` sur `window`,
   * que la debug bar écoute. `createHotContext` réutilise le client HMR déjà
   * ouvert par `@vite/client` — zéro connexion ajoutée. Tolérant aux versions
   * (try/catch) : si l'export change, le compteur HMR reste à 0 sans casser la page.
   */
  private hmrBridgeTag(baseUrl: string, nonceAttr: string): string {
    return `<script type="module"${nonceAttr}>
try {
  const { createHotContext } = await import("${baseUrl}/@vite/client");
  const h = createHotContext("/@nodefony-debugbar-hmr");
  const fire = (kind, path) =>
    window.dispatchEvent(new CustomEvent("${PLATFORM_EVENTS.hmr}", { detail: { kind, path } }));
  fire("connected");
  h.on("vite:afterUpdate", (p) => {
    const ups = (p && p.updates) || [];
    if (ups.length) ups.forEach((u) => fire("update", u.acceptedPath || u.path));
    else fire("update");
  });
  h.on("vite:beforeFullReload", () => fire("full-reload"));
  h.on("vite:error", () => fire("error"));
} catch (e) {
  /* pont HMR indisponible — compteur debug bar à 0, page intacte */
}
</script>`;
  }

  /**
   * Tag d'injection de la debug bar (subpath `nodefony/debugbar`). Résout le
   * fichier dist navigateur côté serveur (1×, caché) et le sert via `/@fs`.
   * Renvoie un commentaire HTML (jamais d'erreur) si le subpath est irrésoluble.
   */
  private debugBarTag(
    baseUrl: string,
    framework: string,
    entryName: string,
    nonceAttr: string,
  ): string {
    if (debugbarFile === undefined) {
      try {
        debugbarFile = createRequire(import.meta.url).resolve(
          "nodefony/debugbar",
        );
      } catch {
        debugbarFile = null;
      }
    }
    if (!debugbarFile)
      return `<!-- @nodefony/frontend: debugbar unresolved -->`;
    const norm = debugbarFile.replace(/\\/g, "/");
    const fsUrl = `${baseUrl}${norm.startsWith("/") ? `/@fs${norm}` : `/@fs/${norm}`}`;
    const opts = JSON.stringify({
      frontend: { framework, name: entryName, viteOrigin: baseUrl },
    });
    return `<script type="module"${nonceAttr}>
import { mountDebugBar } from ${JSON.stringify(fsUrl)};
mountDebugBar(${opts});
</script>`;
  }

  /**
   * Prod : lit le `manifest.json` du build Vite (caché par `outDir`) et injecte
   * les assets fingerprintés du chunk d'entrée — JS + CSS + preload des imports
   * partagés — préfixés par le `publicPath` de l'entrée (servi par `Statics`).
   */
  private renderProdTags(entryName: string, nonce?: string): string {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry) {
      return `<!-- @nodefony/frontend: unknown entry "${entryName}" -->`;
    }
    const manifest = this.loadManifest(entry.outDir);
    if (!manifest) {
      return `<!-- @nodefony/frontend: prod manifest missing for "${entryName}" (run \`nodefony frontend:build\`) -->`;
    }
    // Clé manifest = chemin source relatif au root Vite (POSIX). `entryFile` est
    // déjà relatif au root (FrontendService) — normaliser les backslashes Windows.
    const key = entry.entryFile.replace(/\\/g, "/");
    const chunk =
      manifest[key] ??
      // Fallback : retrouver le chunk marqué `isEntry` si la clé ne matche pas.
      Object.values(manifest).find((c) => c.isEntry);
    if (!chunk) {
      return `<!-- @nodefony/frontend: entry chunk "${key}" not in manifest -->`;
    }
    // publicPath finit par `/`, les `file` du manifest ne commencent pas par `/`.
    // `assetBaseUrl` (CDN, sans slash final) préfixe en prod si renseigné.
    const base = this.assetBaseUrl + entry.publicPath;
    const tags: string[] = [];
    // CSS d'abord (évite le FOUC) — récursif sur les imports pour le CSS partagé.
    for (const href of this.collectCss(manifest, key)) {
      tags.push(`<link rel="stylesheet" href="${base}${href}">`);
    }
    // Preload des chunks partagés (perf : parallélise le téléchargement).
    for (const imp of chunk.imports ?? []) {
      const dep = manifest[imp];
      if (dep)
        tags.push(`<link rel="modulepreload" href="${base}${dep.file}">`);
    }
    tags.push(
      `<script type="module"${nonce ? ` nonce="${nonce}"` : ""} crossorigin src="${base}${chunk.file}"></script>`,
    );
    return tags.join("\n");
  }

  /**
   * Lit + parse `${outDir}/.vite/manifest.json` (Vite ≥5) une seule fois par
   * `outDir`. Retombe sur `${outDir}/manifest.json` (layout legacy). `null` mis
   * en cache si absent — pas de relecture disque par requête (hot path).
   */
  private loadManifest(outDir: string): ViteManifest | null {
    const cached = this.manifestCache.get(outDir);
    if (cached !== undefined) return cached;
    let parsed: ViteManifest | null = null;
    for (const rel of [".vite/manifest.json", "manifest.json"]) {
      try {
        const raw = fs.readFileSync(path.join(outDir, rel), "utf8");
        parsed = JSON.parse(raw) as ViteManifest;
        break;
      } catch {
        /* essaie le layout suivant */
      }
    }
    this.manifestCache.set(outDir, parsed);
    return parsed;
  }

  /**
   * Collecte récursivement les fichiers CSS d'un chunk + de ses imports
   * (le CSS d'un chunk partagé doit être chargé par toutes les entrées).
   * Dédup via un `Set`, anti-cycle via l'ensemble des clés visitées.
   */
  private collectCss(
    manifest: ViteManifest,
    key: string,
    seen = new Set<string>(),
    out = new Set<string>(),
  ): Set<string> {
    if (seen.has(key)) return out;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return out;
    for (const css of chunk.css ?? []) out.add(css);
    for (const imp of chunk.imports ?? []) {
      this.collectCss(manifest, imp, seen, out);
    }
    return out;
  }
}

export default TemplateHelper;
