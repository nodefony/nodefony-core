/**
 * **JsonViewer** — dump JSON read-only (compat). Conservé comme **wrapper** mince
 * de {@link JsonView} (la vue riche : arbre repliable, aperçu, copier, bascule
 * Brut). Les appelants historiques en profitent sans changement. Pour un aperçu
 * en survol → `JsonPeek` ; pour une carte compacte → `JsonCard`.
 *
 * Sécurité : rendu 100 % texte → aucune injection même si la réponse serveur
 * contient du markup.
 */
import { JsonView } from "./json/JsonView";

export interface JsonViewerProps {
  value: unknown;
  /** Hauteur max scrollable (px). Défaut 420. */
  maxHeight?: number;
}

export function JsonViewer({ value, maxHeight = 420 }: JsonViewerProps) {
  return <JsonView value={value} maxHeight={maxHeight} />;
}
