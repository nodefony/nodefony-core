import path from "node:path";
import type { IViteSupervisor } from "../../interfaces/IViteSupervisor";

/**
 * Génère les balises HTML à injecter dans la page rendue côté serveur
 * pour brancher le frontend Vite.
 *
 * Dev : `<script type="module" src="http://host:port/@vite/client">` + entry.
 * Prod : lira `manifest.json` du build pour les chemins fingerprintés (TODO).
 */
export class TemplateHelper {
  constructor(
    private readonly supervisor: IViteSupervisor,
    private readonly mode: "development" | "production",
  ) {}

  /**
   * Tags à injecter dans `<head>` (ou avant `</body>`) pour une entrée donnée.
   * @param entryName nom logique de l'entrée (matche `entryName` dans IResolvedFrontendEntry)
   */
  renderTags(entryName: string): string {
    if (this.mode === "development") {
      return this.renderDevTags(entryName);
    }
    return this.renderProdTags(entryName);
  }

  private renderDevTags(entryName: string): string {
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
    // Preamble React Fast Refresh — requis par @vitejs/plugin-react. Sans ça,
    // l'app crash au boot avec : "@vitejs/plugin-react can't detect preamble".
    // Normalement injecté par Vite via `transformIndexHtml` — mais ici c'est
    // Nodefony qui rend le HTML, donc on doit l'inliner nous-mêmes AVANT
    // le `@vite/client` et l'entry.
    if (entry.type === "react19") {
      tags.push(
        `<script type="module">
import RefreshRuntime from "${baseUrl}/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>`,
      );
    }
    tags.push(`<script type="module" src="${baseUrl}/@vite/client"></script>`);
    tags.push(`<script type="module" src="${entryUrl}"></script>`);
    return tags.join("\n");
  }

  private renderProdTags(_entryName: string): string {
    // TODO Phase ultérieure : lire manifest.json + injecter assets fingerprintés.
    return `<!-- @nodefony/frontend: prod manifest not yet implemented -->`;
  }
}

export default TemplateHelper;
