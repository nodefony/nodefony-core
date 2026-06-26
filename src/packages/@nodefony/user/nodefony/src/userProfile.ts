import type { IUserProfile } from "../contracts/IUserProfile";

/**
 * Logique PURE du profil utilisateur (claims OIDC stockés dans
 * `metadata.profile`) — validation d'un patch client, projection en DTO par
 * allowlist, fusion dans la `metadata` existante. Aucun I/O, aucun service :
 * testable isolément (cœur de la garantie anti-fuite + anti-injection de clé).
 */

/** Clés de profil reconnues — allowlist STRICTE (toute autre clé est ignorée). */
export const PROFILE_FIELDS = [
  "givenName",
  "familyName",
  "displayName",
  "email",
  "locale",
  "picture",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Bornes de longueur par champ (anti-abus + cohérence du stockage JSON). */
const MAX_LEN: Record<ProfileField, number> = {
  givenName: 100,
  familyName: 100,
  displayName: 150,
  email: 254, // RFC 5321 §4.5.3.1.3
  locale: 35, // BCP 47 large
  picture: 2048, // URL pratique
};

// Le profil est de l'AFFICHAGE (pas un secret) : on rejette le manifestement
// invalide sans sur-contraindre. Email/locale = formes souples mais cohérentes.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LOCALE_RE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;

/**
 * Borne dure d'un avatar embarqué en **data URL** (image recadrée + redimensionnée
 * CÔTÉ CLIENT, ~256px WebP → ~20 KB). Le cap protège la row user (l'avatar vit
 * dans la DB, choix cloud-native) et borne la surface : un avatar bien compressé
 * reste très en dessous.
 */
const MAX_PICTURE_DATA_URL = 128 * 1024;

/**
 * Data URL d'avatar ACCEPTÉE : base64 d'un raster `png`/`jpeg`/`webp` uniquement.
 * **SVG exclu** par construction (un SVG embarque du script → XSS au rendu de
 * l'avatar) ; `gif` exclu (animation/poids). Le base64 est validé (alphabet strict
 * + padding) → ni `javascript:`, ni polyglotte.
 */
const DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|webp);base64,(?:[A-Za-z0-9+/]+={0,2})$/i;

/**
 * Valide une valeur `picture` : soit une **URL http(s)** (claim OIDC, Gravatar,
 * saisie), soit un **data URL image** raster (avatar uploadé + recadré côté
 * client, stocké en DB). Retourne un message d'erreur, ou `null` si valide.
 */
function validatePictureValue(v: string): string | null {
  if (/^https?:\/\//i.test(v)) {
    return v.length > MAX_LEN.picture
      ? `picture too long (max ${MAX_LEN.picture})`
      : null;
  }
  if (/^data:/i.test(v)) {
    if (v.length > MAX_PICTURE_DATA_URL) {
      return "picture data URL too large (max 128KB)";
    }
    return DATA_IMAGE_RE.test(v)
      ? null
      : "picture data URL must be base64 png/jpeg/webp (svg/gif rejected)";
  }
  return "picture must be an http(s) URL or a png/jpeg/webp data URL";
}

/**
 * Valide + normalise un patch de profil reçu d'un client. Allowlist stricte :
 * seules les clés {@link PROFILE_FIELDS} sont lues (anti-injection d'une clé
 * `metadata` arbitraire). Chaque valeur est `trim`ée ; une chaîne vide ou `null`
 * = **effacement** du champ (matérialisé `""`, retiré au merge).
 *
 * @param input - corps client (`request.body.profile` admin, ou `request.body`
 *   self).
 * @returns `{ ok: true, value }` (patch normalisé) ou `{ ok: false, error }` si
 *   une valeur est mal typée, trop longue, ou syntaxiquement invalide.
 */
export function validateProfilePatch(
  input: unknown,
):
  | { ok: true; value: Partial<Record<ProfileField, string>> }
  | { ok: false; error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "profile must be an object" };
  }
  const src = input as Record<string, unknown>;
  const value: Partial<Record<ProfileField, string>> = {};
  for (const field of PROFILE_FIELDS) {
    if (!(field in src)) continue;
    const raw = src[field];
    if (raw === null) {
      value[field] = ""; // effacement explicite
      continue;
    }
    if (typeof raw !== "string") {
      return { ok: false, error: `${field} must be a string` };
    }
    const v = raw.trim();
    if (v.length === 0) {
      value[field] = "";
      continue;
    }
    if (field === "picture") {
      // URL http(s) OU data URL raster (avatar recadré client) — borne + type
      // gérés par le helper (data URL >> MAX_LEN générique).
      const err = validatePictureValue(v);
      if (err) return { ok: false, error: err };
      value[field] = v;
      continue;
    }
    if (v.length > MAX_LEN[field]) {
      return { ok: false, error: `${field} too long (max ${MAX_LEN[field]})` };
    }
    if (field === "email" && !EMAIL_RE.test(v)) {
      return { ok: false, error: "email is not a valid address" };
    }
    if (field === "locale" && !LOCALE_RE.test(v)) {
      return { ok: false, error: "locale is not a valid BCP 47 tag" };
    }
    value[field] = v;
  }
  return { ok: true, value };
}

/**
 * Projette la `metadata` brute d'une entité vers un {@link IUserProfile} — lecture
 * par **allowlist** (seules les clés connues, typées string non vide). Garantit
 * qu'aucune autre clé de `metadata` (applicative/sensible) n'entre dans le DTO.
 *
 * @param metadata - `entity.metadata` (inconnu : l'entité ORM, pas le contrat).
 */
export function projectProfile(metadata: unknown): IUserProfile {
  const profile: IUserProfile = {};
  if (!metadata || typeof metadata !== "object") return profile;
  const raw = (metadata as { profile?: unknown }).profile;
  if (!raw || typeof raw !== "object") return profile;
  const src = raw as Record<string, unknown>;
  for (const field of PROFILE_FIELDS) {
    const v = src[field];
    if (typeof v === "string" && v.length > 0) profile[field] = v;
  }
  return profile;
}

/**
 * Fusionne un patch validé dans la `metadata` existante en **préservant les autres
 * clés**. Les champs de profil vidés (`""`) sont RETIRÉS (pas de clé fantôme).
 * Rend la nouvelle `metadata` complète, prête pour `updateOne({ metadata })`.
 *
 * @param metadata - `metadata` actuelle de l'entité (préservée hors `profile`).
 * @param patch - patch validé par {@link validateProfilePatch}.
 */
export function mergeProfileIntoMetadata(
  metadata: unknown,
  patch: Partial<Record<ProfileField, string>>,
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object"
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const current =
    base.profile && typeof base.profile === "object"
      ? (base.profile as Record<string, unknown>)
      : {};
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...current, ...patch })) {
    if (typeof v === "string" && v.length > 0) merged[k] = v;
  }
  base.profile = merged;
  return base;
}
