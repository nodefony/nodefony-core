/**
 * Les bandes du plein écran : une zone MODALE entre la ligne d'onglets et
 * l'invite — menu, complétion, confirmation, aide (ADR-0013 §11, #903).
 *
 * Une bande s'ouvre par `DevTerminal.openBand`, qui rend sa fermeture : qui
 * l'ouvre la referme. Elle reçoit le clavier avant le défilement et la souris
 * sur son rectangle, en coordonnées LOCALES ; un clic sur elle ne traverse
 * jamais vers la vue. Ctrl+C et Ctrl+D ne lui parviennent pas : une bande ne
 * retient jamais l'arrêt.
 */
import type { IFrameBand } from "./devFrame";
import type { InputEvent } from "./inputDecoder";
import type { ScreenCharset } from "./startupScreen";
import type { IRegion } from "./devLayout";

/** Une bande ouverte : ce qu'elle dessine, et ce qu'elle fait des évènements. */
export interface IDevBand extends IFrameBand {
  /**
   * Un évènement pour elle : touche, texte, collage, ou souris sur son
   * rectangle (ligne et colonne LOCALES, depuis 1).
   *
   * @param event - l'évènement.
   * @returns `false` pour le rendre à la suite de la chaîne (le défilement,
   *   Alt+N) ; un évènement de souris sur la bande est consommé quoi qu'elle
   *   rende.
   */
  handle(event: InputEvent): boolean;
}

/** Une ligne de l'aide : le geste, et ce qu'il fait. */
interface IGesture {
  readonly keys: string;
  readonly does: string;
}

/**
 * La bande d'aide : les gestes du plein écran, sur deux colonnes quand la
 * largeur le permet, sinon une. `Échap`,
 * `?`, `q` ou `F1` la referment ; le reste passe (on défile et on change
 * d'onglet l'aide ouverte).
 *
 * @param options - jeu de caractères, couleur, souris captée, et la fermeture
 *   que `openBand` a rendue.
 * @returns la bande.
 */
export function helpBand(options: {
  readonly charset: ScreenCharset;
  readonly color: boolean;
  readonly mouse: boolean;
  /** L'invite est branchée : ↑ ↓ y parcourent l'historique, plus le journal. */
  readonly prompt?: boolean;
  readonly close: () => void;
}): IDevBand {
  const ascii = options.charset === "ascii";
  const gestures: IGesture[] = [
    { keys: ascii ? "Alt+1..9" : "Alt+1…9", does: "changer d'onglet" },
    // Sur un clavier AZERTY, Terminal.app et iTerm2 demandent Maj pour le
    // chiffre ; VS Code lit la position de la touche, donc Option seule.
    {
      keys: ascii ? "Maj+Alt+1..9" : "Maj+Alt+1…9",
      does: "idem en AZERTY, hors VS Code",
    },
    { keys: "PgUp PgDn", does: "défiler d'une page" },
  ];
  if (options.prompt === true) {
    gestures.push(
      {
        keys: ascii ? "haut bas Ctrl+P/N" : "↑ ↓ Ctrl+P/N",
        does: "historique de l'invite",
      },
      {
        keys: ascii ? "molette clic PgUp" : "molette · clic · PgUp",
        does: "focus au journal (↑ ↓ y défilent)",
      },
      { keys: ascii ? "droite" : "→", does: "accepter la suggestion" },
      { keys: "Alt+Entrée", does: "saut de ligne" },
      { keys: "Ctrl+W Ctrl+U", does: "effacer le mot / la ligne" },
      { keys: "Début Fin", does: "invite vide : haut / direct" },
    );
  } else {
    gestures.push(
      { keys: ascii ? "haut bas" : "↑ ↓", does: "défiler d'une ligne" },
      { keys: "Début Fin", does: "haut / retour au direct" },
    );
  }
  if (options.mouse) {
    gestures.push(
      { keys: "clic", does: "montrer un onglet" },
      { keys: "glisser", does: "copier une sélection" },
      { keys: "molette", does: "défiler" },
    );
  }
  gestures.push(
    { keys: "Échap", does: "effacer la sélection" },
    options.prompt === true
      ? { keys: "Ctrl+C", does: "effacer ; invite vide : arrêter" }
      : { keys: "Ctrl+C", does: "arrêter le serveur" },
  );
  const half = Math.ceil(gestures.length / 2);
  const keyWidth = gestures.reduce((w, g) => Math.max(w, g.keys.length), 0);
  const cellWidth =
    keyWidth + 2 + gestures.reduce((w, g) => Math.max(w, g.does.length), 0) + 3;
  const paint = (code: string, text: string): string =>
    options.color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const cell = (gesture: IGesture | undefined): string =>
    gesture === undefined
      ? ""
      : `${paint("1;36", gesture.keys.padEnd(keyWidth))}  ${gesture.does.padEnd(cellWidth - keyWidth - 2)}`;
  // Deux colonnes quand elles tiennent, sinon une — la hauteur suit.
  const twoColumns = (width: number): boolean => width >= 2 * cellWidth + 1;
  return {
    height(width: number): number {
      return (twoColumns(width) ? half : gestures.length) + 1;
    },
    render(region: IRegion): readonly string[] {
      const lines = [
        ` ${paint("1", "Gestes")}${paint("2", "  —  Échap ou ? pour fermer")}`,
      ];
      const two = twoColumns(region.width);
      const rows = two ? half : gestures.length;
      for (let row = 0; row < rows; row++) {
        lines.push(
          two
            ? ` ${cell(gestures[row])}${cell(gestures[row + half])}`
            : ` ${cell(gestures[row])}`,
        );
      }
      return lines;
    },
    handle(event: InputEvent): boolean {
      if (
        (event.kind === "key" &&
          !event.ctrl &&
          !event.alt &&
          (event.key === "escape" || event.key === "f1")) ||
        (event.kind === "text" && (event.text === "?" || event.text === "q"))
      ) {
        options.close();
        return true;
      }
      return false;
    },
  };
}
