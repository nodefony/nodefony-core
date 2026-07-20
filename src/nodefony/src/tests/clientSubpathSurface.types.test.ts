/**
 * Tests de SURFACE PUBLIQUE des subpaths navigateur — `nodefony/client` et
 * `nodefony/react`.
 *
 * Ce que ces sentinelles protègent : un consommateur navigateur doit pouvoir
 * **NOMMER** les types que la lib lui rend. `useNodefonyIdentity()` rend une
 * `RealtimeIdentity` ; si le barrel ne la réexporte pas, l'inférence marche
 * encore (`const who = useNodefonyIdentity()`) mais la **déclaration explicite**
 * est impossible (`const who: RealtimeIdentity = …` → TS2724 / TS2459). Un type
 * qu'on ne peut pas nommer ne peut ni typer un champ de store, ni une prop de
 * composant, ni une signature — c'est une surface publique amputée sans qu'aucun
 * test d'exécution ne s'en aperçoive.
 *
 * Pourquoi les imports sont RELATIFS aux barrels et pas `nodefony/client` :
 * l'`exports` map fait pointer chaque subpath vers le `.d.ts` GÉNÉRÉ de ces
 * mêmes barrels (`dist/client/types/src/client/index.d.ts`). Barrel source
 * correct ⇒ `.d.ts` correct ⇒ subpath correct. Passer par le spécificateur de
 * paquet ferait dépendre la sentinelle du `dist` — donc un `dist` périmé
 * donnerait un faux rouge, et un `dist` absent un faux vert.
 *
 * Couvert par `npm run typecheck` (`tsgo -p tsconfig.tests.json`).
 *
 * Wrap `_typeOnly()` jamais appelé — `declare const` purement typage.
 */

import { describe, it } from "vitest";
import type {
  RealtimeIdentity,
  IRealtimeWelcome,
  IRealtimeDenied,
  RealtimeState,
  NodefonyNotice,
} from "../client/index";
import type {
  RealtimeIdentity as ReactIdentity,
  RealtimeState as ReactState,
  NodefonyNotice as ReactNotice,
} from "../client/react/index";

// ── Fixtures compile-only ─────────────────────────────────────────────────
// `declare const` est ILLÉGAL dans un corps de fonction (TS1184) : au scope
// module (ambient → aucun emit runtime).

declare const identity: RealtimeIdentity;
declare const welcome: IRealtimeWelcome;
declare const denied: IRealtimeDenied;
declare const state: RealtimeState;
declare const notice: NodefonyNotice;

declare const reactIdentity: ReactIdentity;
declare const reactState: ReactState;
declare const reactNotice: ReactNotice;

function _typeOnly(): void {
  // ── `nodefony/client` — les types que le client rend ────────────────────
  // L'identité résolue au handshake, portée par `socket.identity`.
  const _a: RealtimeIdentity = identity;
  // La trame d'accueil, qui EMBARQUE l'identité (`welcome.identity`).
  const _b: RealtimeIdentity = welcome.identity;
  // La trame de refus, qu'un `catch` doit pouvoir typer.
  const _c: IRealtimeDenied = denied;
  const _d: RealtimeState = state;
  const _e: NodefonyNotice = notice;

  // ── `nodefony/react` — ce que les hooks RENDENT ─────────────────────────
  // `useNodefonyIdentity(): RealtimeIdentity | null` : le consommateur doit
  // pouvoir déclarer la variable qui accueille le retour du hook.
  const _f: ReactIdentity | null = reactIdentity;
  const _g: ReactState = reactState;
  const _h: ReactNotice = reactNotice;

  // Les deux subpaths doivent parler du MÊME type, pas de deux jumeaux : une
  // identité lue via `nodefony/react` s'assigne à une variable typée depuis
  // `nodefony/client`. Un jour où l'un des deux dupliquerait la déclaration au
  // lieu de la réexporter, cette ligne casserait.
  const _i: RealtimeIdentity = reactIdentity;

  (void _a, _b, _c, _d, _e, _f, _g, _h, _i);
}

void _typeOnly;

describe("surface publique des subpaths navigateur", () => {
  it("nomme les types rendus par `nodefony/client` et `nodefony/react` (compile-only)", () => {
    // Rien à exécuter : la preuve est faite par `tsgo -p tsconfig.tests.json`.
    // Ce cas existe pour que la sentinelle apparaisse dans le rapport vitest —
    // un fichier de types muet dans le rapport finit par être oublié.
  });
});
