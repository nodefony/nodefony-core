/**
 * Lecture des zones du pare-feu pour le bilan de démarrage — vue minimale,
 * résolue par duck-typing : le cœur n'importe jamais `@nodefony/security`.
 *
 * La règle « une zone est-elle applicative ? » vit ICI et nulle part ailleurs :
 * le détail du bilan (tableau des zones) et le point d'attention « routes
 * métier publiques » (déclaré par `@nodefony/security`) l'appellent tous deux.
 */

/**
 * Vue minimale d'une zone du firewall (`firewall.describe().zones`), résolue
 * par duck-typing — le core n'importe jamais @nodefony/security.
 */
export interface IFirewallZoneView {
  readonly name: string;
  readonly pattern: string;
  readonly security?: boolean;
  readonly authenticators?: ReadonlyArray<string>;
  readonly allowsAnonymous?: boolean;
}

/**
 * Pattern de zone LISIBLE : `describe()` remonte `RegExp.source`, où V8 échappe
 * les slashes (`^\/nodefony\/…`) — on dé-échappe pour l'affichage ET pour le
 * classement par namespace (un `startsWith("^/nodefony")` sur la source brute
 * ne matcherait jamais — bug vécu au premier boot réel).
 */
export function cleanZonePattern(pattern: string): string {
  return pattern.replace(/\\\//g, "/");
}

/**
 * `true` si la zone vit dans le namespace réservé `/nodefony` → déclarée par
 * `@nodefony/framework` (les aires data plane admin). L'inférence par pattern
 * est fiable PAR CONVENTION : le routage `/nodefony` est réservé au framework
 * (règle figée), aucune app/module tiers n'y monte d'aire.
 */
export function isFrameworkZone(z: IFirewallZoneView): boolean {
  return cleanZonePattern(z.pattern).startsWith("^/nodefony");
}

/**
 * Tableau ANSI des zones firewall (ZONE/MODULE/PATTERN/AUTH/ACCÈS) — même
 * gabarit que le tableau process du bilan (`renderProcessTable`). MODULE = qui
 * déclare l'aire (`framework` pour le data plane `/nodefony`, `app` pour les
 * zones du `nodefony.config.ts`). ACCÈS résume la politique effective :
 * `public` (security:false), `anonyme OK` (authenticator anonymous dans la
 * chaîne — jamais bloquant, identité résolue si présente) ou `protégé`
 * (preuve exigée, 401 sinon). Zones applicatives en vert, aires framework en dim.
 */
export function renderZoneTable(
  lines: string[],
  zones: ReadonlyArray<IFirewallZoneView>,
  indent: string = "  ",
): void {
  const moduleOf = (z: IFirewallZoneView): string =>
    isFrameworkZone(z) ? "framework" : "app";
  const authOf = (z: IFirewallZoneView): string =>
    (z.authenticators ?? []).join(", ") || "—";
  const nameW = Math.max(4, ...zones.map((z) => z.name.length));
  const modW = Math.max(6, ...zones.map((z) => moduleOf(z).length));
  const patW = Math.max(
    7,
    ...zones.map((z) => cleanZonePattern(z.pattern).length),
  );
  const authW = Math.max(4, ...zones.map((z) => authOf(z).length));
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";
  lines.push(
    `${DIM}${indent}${"ZONE".padEnd(nameW)}  ${"MODULE".padEnd(modW)}  ${"PATTERN".padEnd(patW)}  ${"AUTH".padEnd(authW)}  ACCÈS${RESET}`,
    `${DIM}${indent}${"─".repeat(nameW + modW + patW + authW + 13)}${RESET}`,
  );
  for (const z of zones) {
    const framework = isFrameworkZone(z);
    const access =
      z.security === false
        ? `${YELLOW}public${RESET}`
        : z.allowsAnonymous || (z.authenticators ?? []).includes("anonymous")
          ? `anonyme OK`
          : `${GREEN}protégé${RESET}`;
    const color = framework ? DIM : GREEN;
    lines.push(
      `${indent}${color}${z.name.padEnd(nameW)}${RESET}  ` +
        `${DIM}${moduleOf(z).padEnd(modW)}${RESET}  ` +
        `${cleanZonePattern(z.pattern).padEnd(patW)}  ` +
        `${DIM}${authOf(z).padEnd(authW)}${RESET}  ${access}`,
    );
  }
}
