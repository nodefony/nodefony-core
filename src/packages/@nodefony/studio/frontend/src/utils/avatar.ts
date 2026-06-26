/**
 * Helpers d'avatar (purs, 0 dépendance). Stratégie de résolution d'un avatar :
 * `picture` (data URL uploadée OU URL OIDC/Gravatar) → Gravatar dérivé de l'email
 * → initiales. Gravatar = norme de facto (hash de l'email) ; dérivé CÔTÉ CLIENT
 * pour ne pas faire appeler un tiers par le serveur (privacy / cloud-native).
 */

/** Sous-ensemble de `UserProfileData` nécessaire à l'avatar. */
export interface AvatarProfile {
  givenName?: string;
  familyName?: string;
  displayName?: string;
  email?: string;
  /** data URL (avatar uploadé) ou URL http(s). */
  picture?: string;
}

/** Initiales de repli : prénom+nom, sinon displayName/identifiant (max 2 lettres). */
export function initials(profile: AvatarProfile, identifier?: string): string {
  const g = (profile.givenName ?? "").trim();
  const f = (profile.familyName ?? "").trim();
  if (g || f) return ((g[0] ?? "") + (f[0] ?? "")).toUpperCase();
  const d = (profile.displayName ?? identifier ?? "").trim();
  if (!d) return "?";
  const parts = d.split(/\s+/).filter(Boolean);
  const two =
    parts.length > 1
      ? (parts[0][0] ?? "") + (parts[1][0] ?? "")
      : d.slice(0, 2);
  return two.toUpperCase();
}

/**
 * URL **Gravatar** dérivée de l'email — hash **SHA-256** (API moderne ; MD5 =
 * legacy). `d=404` : si l'email n'a pas de Gravatar, l'image renvoie 404 → l'UI
 * retombe sur les initiales. ⚠️ Interroge gravatar.com (tiers) → à n'utiliser
 * QU'EN absence de `picture`, et soumis au CSP `img-src` de Studio (bloqué =
 * fallback initiales, gracieux). Libravatar = variante fédérée (même schéma).
 *
 * @returns l'URL, ou `null` si l'email est vide / SubtleCrypto indisponible.
 */
export async function gravatarUrl(
  email: string,
  size = 200,
): Promise<string | null> {
  const norm = email.trim().toLowerCase();
  if (!norm || !globalThis.crypto?.subtle) return null;
  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(norm),
    );
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `https://www.gravatar.com/avatar/${hex}?s=${size}&d=404`;
  } catch {
    return null;
  }
}
