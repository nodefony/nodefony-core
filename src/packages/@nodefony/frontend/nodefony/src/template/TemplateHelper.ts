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
    const baseUrl = `http://${status.host}:${status.port}`;
    // `entryFile` est déjà relatif au `root` Vite (ex: "src/main.tsx") —
    // résolu côté FrontendService.registerEntry via `path.relative(root, absEntry)`.
    const entryUrl = `${baseUrl}/${entry.entryFile.replace(/^\/+/, "")}`;
    return [
      `<script type="module" src="${baseUrl}/@vite/client"></script>`,
      `<script type="module" src="${entryUrl}"></script>`,
    ].join("\n");
  }

  private renderProdTags(_entryName: string): string {
    // TODO Phase ultérieure : lire manifest.json + injecter assets fingerprintés.
    return `<!-- @nodefony/frontend: prod manifest not yet implemented -->`;
  }
}

export default TemplateHelper;
