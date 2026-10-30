/**
 * Registre UNIQUE des codes de fermeture privés de la socket Nodefony (plage
 * 4000-4999, RFC 6455 §7.4.2), lu par le serveur qui ferme et par le client qui
 * décide de revenir — ADR-0021 §S11. Un code écrit en littéral ailleurs ferait
 * diverger les deux côtés sans que rien ne le dise.
 */

/**
 * Code de fermeture de l'identité MORTE — `authenticate` a levé, la session est détruite ou le jeton RÉVOQUÉ : le client ne se reconnecte pas.
 *
 * Un jeton révoqué ET expiré ferme ici, pas en {@link TOKEN_EXPIRED_CLOSE_CODE} :
 * la révocation l'emporte, c'est l'acte qui décrit ce qui s'est passé.
 */
export const IDENTITY_DEAD_CLOSE_CODE = 4001;

/**
 * Code de fermeture de l'ORIGINE refusée (contrôle `Origin` de la poignée de main, RFC 6455 §10.2) : le client ne se reconnecte pas.
 */
export const ORIGIN_REFUSED_CLOSE_CODE = 4003;

/**
 * Code de fermeture d'une ressource temps réel INTROUVABLE (un 4xx applicatif sans équivalent RFC, 404 en tête) : le client ne se reconnecte pas.
 */
export const NOT_FOUND_CLOSE_CODE = 4004;

/**
 * Code de fermeture des droits CHANGÉS d'une identité vivante : la connexion est fermée pour que le client se RECONNECTE aussitôt avec son identité à jour.
 *
 * À distinguer de {@link IDENTITY_DEAD_CLOSE_CODE}, après lequel le client ne
 * se reconnecte pas.
 */
export const IDENTITY_REFRESH_CLOSE_CODE = 4005;

/**
 * Code de fermeture du jeton PORTEUR arrivé à son `exp` sur une socket ouverte : un jeton neuf suffirait, le client 10.0 s'arrête (définitif).
 *
 * Jamais émis à la poignée de main : un refus distinct y dirait à qui tient un
 * jeton volé qu'il a été émis par l'application — le refus reste le 401
 * uniforme, donc `1008`. Une session expirée garde
 * {@link IDENTITY_DEAD_CLOSE_CODE} (sa cause n'est pas connaissable). Un client
 * 10.x qui sait obtenir un jeton frais pourra revenir sur ce code sans que le
 * serveur change.
 */
export const TOKEN_EXPIRED_CLOSE_CODE = 4006;
