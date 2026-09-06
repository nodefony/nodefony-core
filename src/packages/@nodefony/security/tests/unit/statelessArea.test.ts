import assert from "node:assert/strict";
import type { IUserProvider } from "@nodefony/user";
import type { ISecuredArea } from "../../nodefony/contracts/ISecuredArea";
import { SessionAuthenticator } from "../../nodefony/src/authenticator/SessionAuthenticator";

/**
 * Une zone déclarée SANS REGISTRE ne peut pas s'authentifier par session.
 *
 * `stateless: true` promet, dans sa description de configuration et dans la
 * console d'administration, que « la session est ignorée même si un cookie est
 * présent ». Or `supports()` rend vrai dès qu'une session reprise porte un
 * utilisateur : sur une zone stateless qui liste `session`, un porteur de
 * cookie était authentifié par sa session, et rien ne le disait — ni au boot,
 * ni à la requête, ni à l'écran.
 *
 * La contradiction se refuse au DÉMARRAGE, pas à la première requête : une
 * application dont le firewall se contredit ne doit pas servir. Le point
 * d'extension existe (`IAuthenticator.validateArea`, appelé pour chaque zone
 * qui liste l'authenticator — `firewall.ts:443`), et un refus y devient une
 * erreur de configuration fail-closed.
 */
describe("SessionAuthenticator — conditions d'emploi au BOOT", () => {
  const zone = (surcharge: Partial<ISecuredArea> = {}): ISecuredArea =>
    ({
      name: "api",
      stateless: false,
      authenticators: ["session"],
      ...surcharge,
    }) as unknown as ISecuredArea;

  const auth = (): SessionAuthenticator =>
    new SessionAuthenticator(() => ({}) as unknown as IUserProvider);

  it("🔴 refuse une zone stateless : la session y serait la preuve d'identité", () => {
    assert.throws(
      () => auth().validateArea(zone({ stateless: true })),
      /stateless/,
    );
  });

  it("accepte une zone à registre — le cas normal du navigateur", () => {
    assert.doesNotThrow(() => auth().validateArea(zone()));
  });

  it("le refus NOMME la zone : sur dix zones, il faut savoir laquelle", () => {
    // Un message qui ne nomme pas sa zone oblige à les relire toutes.
    assert.throws(
      () => auth().validateArea(zone({ name: "partenaires", stateless: true })),
      /partenaires/,
    );
  });
});
