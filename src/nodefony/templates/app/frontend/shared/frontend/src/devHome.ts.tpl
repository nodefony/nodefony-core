/**
 * Ce que l'accueil montre en DÉVELOPPEMENT seulement — et la garde qui l'empêche
 * de partir en production.
 *
 * 🔴 La garde est ICI, sur les données, et pas dans la page : `DEV_HOME` vaut
 * `null` dès que Vite construit pour la production (`import.meta.env.DEV` est
 * remplacé par `false`) ; `homeContent()` n'est alors jamais appelée, et le
 * minifieur la retire avec tout ce qu'elle porte — textes, liens et mot de
 * passe compris. Une garde posée dans le gabarit de la page ne suffirait pas :
 * Vue et Angular compilent les textes de leurs gabarits dans le bundle,
 * qu'ils soient affichés ou non.
 *
 * Les textes eux-mêmes vivent dans `homeContent.ts`.
 */
<%= it.front.badge.versionImport %>
import { homeContent, type IHomeContent } from "./homeContent";

export type {
  IHomeCard,
  IHomeContent,
  IHomeSection,
  IHomeText,
} from "./homeContent";

/** Le contenu de développement, et le front de cette page. */
export interface IDevHome extends IHomeContent {
  /** Le front de cette page : nom, version lue à l'exécution, logo. */
  readonly front: {
    readonly name: string;
    readonly version: string;
    readonly logo: string;
  };
}

/** Contenu de développement de l'accueil — `null` en production. */
export const DEV_HOME: IDevHome | null = import.meta.env.DEV
  ? {
      ...homeContent(),
      front: {
        name: "<%= it.front.badge.name %>",
        version: <%= it.front.badge.versionExpr %>,
        logo: "<%= it.front.badge.logo %>",
      },
    }
  : null;
