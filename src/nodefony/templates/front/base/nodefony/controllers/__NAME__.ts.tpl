import { Controller, route, controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

/**
 * <%= it.nameClass %> — sert la page <%= it.frontend %> « <%= it.kebab %> ».
 *
 * ── Comment la page arrive au navigateur ──────────────────────────────────
 * 1. Le HTML ne vit PAS ici : c'est la coquille `frontend/index.html`
 *    (TA page — meta, polices, favicon, scripts externes). Ce controller la
 *    fait rendre par le framework.
 * 2. `renderDocument("<%= it.kebab %>", nonce)` remplit le marqueur
 *    `<!--nodefony:frontend-->` de la coquille avec les balises de l'ENTRY
 *    « <%= it.kebab %> » (déclarée dans l'`index.ts` du module, cf
 *    `registerEntry`) :
 *      - en DÉVELOPPEMENT : les <script> pointent Vite, relayé par Nodefony
 *        sur l'origine de la page (`/_vite/<famille>/`) → HMR,
 *        recompilation à la volée, état préservé ;
 *      - en PRODUCTION : le bundle pré-compilé fingerprinté (`npm run build`),
 *        servi en statique — Vite n'existe plus au runtime.
 * 3. Le NONCE CSP de la requête (émis par le firewall) est propagé aux
 *    <script> injectés : la Content-Security-Policy stricte reste intacte —
 *    ne JAMAIS recopier des balises <script> à la main dans la coquille.
 *
 * ── Les appels API de la page ─────────────────────────────────────────────
 * La page est rendue par Nodefony ; en dev, ses modules lui parviennent par la
 * même origine (`/_vite/…`, relayé à Vite). Un `fetch("/api/...")` atteint donc
 * directement ce controller, en dev comme en prod — aucun proxy à déclarer.
 */
@controller("")
class <%= it.nameClass %> extends Controller {
  constructor(context: ContextType) {
    super("<%= it.kebab %>-front", context);
  }

  @route("route-<%= it.kebab %>-page", { path: "<%= it.route %>", method: "GET" })
  renderPage(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      FrontendService | undefined;
    if (!svc) {
      // @nodefony/frontend absent du manifeste (nodefony.config.ts) : la page
      // ne peut pas être construite — on le DIT au lieu d'un écran vide.
      return this.render("<!-- @nodefony/frontend not ready -->");
    }
    return this.render(
      // En développement, les URLs vers Vite sont relatives à la page
      // (`/_vite/<famille>/…`, relayées par Nodefony) : un poste, un conteneur
      // ou un téléphone chargent la MÊME page sans configuration.
      svc.renderDocument(
        "<%= it.kebab %>",
        this.context?.cspNonce,
      ),
    );
  }
}

export default <%= it.nameClass %>;
