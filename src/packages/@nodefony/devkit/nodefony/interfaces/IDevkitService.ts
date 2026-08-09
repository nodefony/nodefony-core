import type {
  ICard,
  ICardAppInfo,
  ICardDoor,
  ICardInput,
  ICardVerb,
} from "nodefony";
import type { DevkitConfig } from "../config/config";

/**
 * Le contrat de la carte est celui du CŒUR — ces noms n'en sont que les alias,
 * conservés parce qu'ils forment la surface publique de ce module.
 *
 * La forme de la carte ne peut avoir qu'une définition : la CLI
 * (`nodefony card`, standalone 0-boot) et la porte HTTP de ce module rendent le
 * MÊME objet. Deux déclarations parallèles auraient divergé au premier champ
 * ajouté, et chacune aurait passé ses propres tests.
 */
export type IDevkitCard = ICard;
/** Identité de l'application qui répond. */
export type IDevkitAppInfo = ICardAppInfo;
/** Une PORTE : un endroit où aller chercher la suite. */
export type IDevkitDoor = ICardDoor;
/** Un VERBE : une commande à lancer (toujours préfixée `npx`). */
export type IDevkitVerb = ICardVerb;
/** L'état minimal dont la carte se dérive — injecté, jamais lu. */
export type IDevkitCardInput = ICardInput;

/**
 * API publique de `DevkitService` (injectable, nom `devkit`).
 *
 * L'interface est le CONTRAT : ce que les autres modules (et Studio) peuvent
 * appeler. Tout ce qui n'est pas ici est un détail d'implémentation, libre de
 * changer.
 */
export interface IDevkitService {
  /** Snapshot de lecture — état courant du service. */
  status(): { ready: boolean };

  /**
   * Carte de visite de l'application, DÉRIVÉE de l'état du Kernel.
   *
   * Le module ne stocke rien en propre : ce qu'il rend est recalculé à la
   * lecture. Une carte mise en cache mentirait au premier module ajouté.
   *
   * Ici — et ici seulement — la liste des modules est celle des modules
   * réellement CHARGÉS (`source: "runtime"`) : le Kernel tourne, le gating
   * `policy`/`when` a déjà eu lieu. La porte CLI, elle, répond à froid et le
   * DIT.
   */
  getCard(): IDevkitCard;

  /**
   * Réglages effectifs du serveur MCP (défauts du schéma + surcharges de l'app).
   *
   * Exposé sur le contrat parce que la porte HTTP les lit : gardes d'accès et
   * allowlist d'outils viennent d'ICI, jamais d'une seconde lecture de la
   * configuration — deux lectures divergent.
   */
  mcpSettings(): DevkitConfig["mcp"];
}
