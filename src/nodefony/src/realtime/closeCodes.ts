/**
 * Code de fermeture WebSocket privé (plage 4000-4999, RFC 6455 §7.4.2) : les
 * droits de l'identité ont changé, la connexion est fermée pour que le client
 * se RECONNECTE avec son identité à jour. À distinguer de 4001 (identité morte),
 * après lequel le client ne se reconnecte pas.
 *
 * Partagé par le serveur, qui ferme, et le client, qui décide de se
 * reconnecter : une seule constante, sinon les deux côtés divergent.
 */
export const IDENTITY_REFRESH_CLOSE_CODE = 4005;
