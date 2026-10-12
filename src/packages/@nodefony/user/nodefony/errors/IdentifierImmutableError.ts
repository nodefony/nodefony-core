import { nodefonyError } from "nodefony";

/**
 * Une mise à jour tente de RENOMMER un compte — l'identifiant est immuable.
 *
 * Sessions, jetons, clés d'API, secret TOTP et passkeys sont rangés sous
 * `IUser.identifier` : le changer orphelinerait tout ce qui y est rattaché
 * (accès en cours impossibles à révoquer, facteurs hérités par un futur compte
 * du même nom), sans un mot. Changer d'identifiant = créer un compte neuf.
 *
 * `code = 409`.
 */
export class IdentifierImmutableError extends nodefonyError {
  constructor(current: string) {
    super(`Identifier is immutable: ${current}`, 409);
  }
}

export default IdentifierImmutableError;
