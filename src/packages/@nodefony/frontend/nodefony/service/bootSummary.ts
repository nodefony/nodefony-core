import type { IBootNotice } from "nodefony";
import type { IViteSupervisorStatus } from "../interfaces/IViteSupervisor";

/** Ce que le frontend dit au bilan de démarrage. */
export interface IFrontendBootSummary {
  /** Instances Vite réellement prêtes. */
  ready: number;
  /**
   * Une ligne par instance : les bundles qu'elle sert et son port INTERNE
   * (`react, studio · Vite interne :5173`) — jamais présenté comme une adresse
   * à ouvrir : Vite passe derrière Nodefony, on ouvre l'application.
   */
  lines: string[];
  /** Le point d'attention à déclarer, ou `null` si tout est servi. */
  notice: IBootNotice | null;
}

/**
 * Résume les instances Vite pour le bilan de démarrage — fonction PURE (les
 * statuts sont lus par l'appelant), éprouvable sans lancer Vite.
 *
 * @param statuses - l'état de chaque superviseur Vite, après démarrage.
 * @returns lignes de détail, nombre d'instances prêtes, point d'attention.
 */
export function summarizeFrontendBoot(
  statuses: readonly IViteSupervisorStatus[],
): IFrontendBootSummary {
  const lines: string[] = [];
  const failed: string[] = [];
  let ready = 0;
  for (const st of statuses) {
    const names = st.entries.map((e) => e.entryName).join(", ");
    if (st.state === "ready") {
      ready++;
      lines.push(
        `${names} · Vite interne${st.port === null ? "" : ` :${st.port}`}`,
      );
    } else {
      failed.push(names);
      // Un état d'échec se dit comme tel ; un état transitoire (`compiling`)
      // se nomme — « en échec » serait faux, et ferait chercher une panne.
      const state =
        st.state === "errored" || st.state === "crashed"
          ? "en échec"
          : `pas prêt (${st.state})`;
      lines.push(
        `${names} · Vite ${state}${st.lastError ? ` — ${st.lastError}` : ""}`,
      );
    }
  }
  let notice: IBootNotice | null = null;
  if (statuses.length > 0 && ready === 0) {
    notice = {
      code: "FRONTEND_BUILD_FAILED",
      level: "error",
      message: "Aucune instance Vite n'est prête — aucun bundle n'est servi",
      fix: "nodefony development --debug (journal Vite complet)",
    };
  } else if (failed.length > 0) {
    notice = {
      code: "FRONTEND_PARTIAL",
      level: "warning",
      message: `Vite pas prêt pour ${failed.join(" · ")} — les autres bundles sont servis`,
      fix: "nodefony development --debug (journal Vite complet)",
    };
  }
  return { ready, lines, notice };
}
