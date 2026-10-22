/**
 * Facteur d'authentification déclaré au flux de session : l'audit écrit
 * `login.success` avec cette raison, ce qui distingue une session de profilage
 * d'une vraie connexion.
 */
export const PROFILE_SESSION_FACTOR = "devkit";

/**
 * Chemin de la route de connexion du profilage, que l'outil appelle. Hors du
 * motif de la zone d'administration (`^/nodefony/[^/]+/api`). Le contrôleur
 * l'écrit en littéraux ; un test tient l'égalité.
 */
export const PROFILE_SESSION_PATH = "/nodefony/devkit/profile-session";
