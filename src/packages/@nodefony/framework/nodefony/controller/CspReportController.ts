import { CSP_REPORT_MAX_BYTES, CSP_REPORT_PATH, type Module } from "nodefony";
import { HttpError, type ContextType } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";
import { Body, CsrfExempt } from "../decorators/routerDecorators";

/**
 * Ce que la route attend du service `cspReports` (`@nodefony/security`) —
 * contrat structurel, sans dépendance de paquet.
 */
interface ICspReportSink {
  receive(
    contentType: string | null | undefined,
    body: Uint8Array,
    client: string | null,
    userAgent?: string | null,
  ): unknown;
}

const NO_STORE = { "cache-control": "no-store" };

// Montage one-shot par process (même sémantique que `mountOAuth2Routes`).
let mounted = false;

/**
 * Réception PUBLIQUE des rapports de violation CSP (ADR-0024 §C7) —
 * `POST /nodefony/security/api/csp-report`, adaptateur MINCE au-dessus du
 * service `cspReports`.
 *
 * Le navigateur poste sans identifiant : la route contourne le pare-feu, et la
 * défense CSRF (`@CsrfExempt`) — elle ne change l'état de personne, et un
 * rapport n'a aucune session à détourner. Le corps arrive en FLUX
 * (`@Body({ stream: true })`) pour être borné PENDANT la lecture : au-delà de
 * {@link CSP_REPORT_MAX_BYTES}, 413 sans rien garder. Tout le reste — quota,
 * type de contenu, forme, expurgation — appartient au collecteur, et la
 * réponse est 204 quoi qu'il en pense : l'émetteur n'apprend rien.
 */
class CspReportController extends Controller {
  constructor(context: ContextType) {
    super("CspReportController", context);
  }

  /**
   * Reçoit un rapport, ou un lot de rapports.
   *
   * @param stream - le corps brut, jamais lu par le pipeline.
   * @throws HttpError 413 quand le corps dépasse le plafond.
   */
  @CsrfExempt()
  async report(@Body({ stream: true }) stream: AsyncIterable<Uint8Array>) {
    const headers = this.context?.request?.headers;
    const declared = Number(headers?.["content-length"]);
    if (Number.isFinite(declared) && declared > CSP_REPORT_MAX_BYTES) {
      throw new HttpError("CSP report too large", 413, this.context);
    }
    const chunks: Uint8Array[] = [];
    let seen = 0;
    for await (const chunk of stream) {
      seen += chunk.byteLength;
      if (seen > CSP_REPORT_MAX_BYTES) {
        throw new HttpError("CSP report too large", 413, this.context);
      }
      chunks.push(chunk);
    }
    const sink = this.get<ICspReportSink>("cspReports");
    if (sink) {
      sink.receive(
        headers?.["content-type"],
        Buffer.concat(chunks, seen),
        this.context?.remoteAddress ?? null,
        headers?.["user-agent"] ?? null,
      );
    }
    return this.renderResponse("", "utf8", 204, NO_STORE);
  }
}

/**
 * Monte la route de réception — appelé par le module framework à
 * `onKernelReady`, seulement si le service `cspReports` est présent (rapports
 * demandés vers la route du framework).
 *
 * @param frameworkModule - module qui porte le contrôleur.
 */
export function mountCspReportRoute(frameworkModule: Module): void {
  if (mounted) return;
  Router.createRoute("security.cspReport", {
    path: CSP_REPORT_PATH,
    constructor: CspReportController,
    classMethod: "report",
    requirements: { methods: ["POST"] },
    // Le navigateur n'envoie aucun identifiant avec un rapport.
    bypassFirewall: true,
  });
  if (
    !Object.prototype.hasOwnProperty.call(
      CspReportController.prototype,
      "module",
    )
  ) {
    Router.setController(CspReportController, frameworkModule);
  }
  mounted = true;
}

export default CspReportController;
