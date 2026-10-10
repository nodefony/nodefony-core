import { INSECURE_TRANSPORT_MESSAGE, nodefonyError } from "nodefony";

/**
 * Secret refusé parce qu'il arrive en clair — `code = 403` (RFC 9110 §15.5.4 :
 * le serveur a compris la requête mais refuse de l'honorer).
 *
 * Message constant ({@link INSECURE_TRANSPORT_MESSAGE}, cœur) : le navigateur
 * le reconnaît, et il ne dit rien de la topologie.
 *
 * Levée AVANT toute vérification, quand un mot de passe ou un code de second
 * facteur arrive en production sur une requête dont le scheme effectif n'est
 * pas `https` (cf {@link CredentialTransportPolicy}). Ce n'est pas un 401 :
 * aucune preuve n'a été jugée, et rien de ce que le client corrigera dans son
 * secret ne changera la réponse — c'est le canal qu'il doit changer. Pas de
 * `WWW-Authenticate` non plus : un défi Basic ferait rouvrir au navigateur la
 * fenêtre qui renverrait le mot de passe par le même canal.
 */
export class InsecureTransportError extends nodefonyError {
  constructor() {
    super(INSECURE_TRANSPORT_MESSAGE, 403);
  }
}

export default InsecureTransportError;
