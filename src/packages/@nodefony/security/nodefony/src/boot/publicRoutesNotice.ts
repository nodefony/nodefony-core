import { isFrameworkZone } from "nodefony";
import type { IBootNotice, IFirewallZoneView } from "nodefony";

/**
 * Le point d'attention « routes métier publiques » du bilan de démarrage.
 *
 * Hors d'une zone du pare-feu, une requête n'est jamais authentifiée : son
 * identité n'est pas résolue, et une route métier qu'on croyait protégée
 * répond à n'importe qui. Les seules zones présentes sont alors les aires du
 * framework (`/nodefony/*`) ; on le DIT au démarrage, avec la recette.
 *
 * La classification « applicative ou framework » n'est pas recopiée : elle
 * vient du cœur (`isFrameworkZone`), qui l'applique aussi au tableau des zones.
 *
 * @param zones - zones montées (`firewall.describe().zones`).
 * @returns le point à déclarer, ou `null` si une zone applicative existe.
 */
export function publicRoutesNotice(
  zones: readonly IFirewallZoneView[],
): IBootNotice | null {
  if (zones.some((z) => !isFrameworkZone(z))) return null;
  return {
    code: "FIREWALL_PUBLIC_ROUTES",
    level: "warning",
    message:
      "Tes routes métier sont PUBLIQUES — aucune zone de pare-feu ne les couvre",
    fix: 'use("@nodefony/security", { areas: { main: { pattern: "^/api", authenticators: ["session"] } } })',
  };
}
