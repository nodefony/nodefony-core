/**
 * État d'un jeton à un instant donné — `active`, `expired` (sa borne `exp` est passée) ou `revoked` (retiré avant terme) ; révoqué l'emporte sur expiré.
 *
 * Au cœur parce que deux paquets qui ne se connaissent pas le lisent : la
 * sécurité, qui le calcule (`tokenStatusOf`), et le temps réel, qui en tire le
 * code de fermeture d'une socket (ADR-0021 §S11). `@nodefony/security` le
 * réexporte sous le même nom.
 */
export type TokenStatus = "active" | "expired" | "revoked";
