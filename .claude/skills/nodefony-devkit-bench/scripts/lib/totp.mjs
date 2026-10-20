/**
 * Le code TOTP qu'une application d'authentification afficherait — calculé par
 * le juge, qui joue ici le téléphone de la personne.
 *
 * RFC 6238 aux réglages par défaut du framework : HMAC-SHA1, 6 chiffres, pas de
 * 30 s, secret en base32 RFC 4648 sans remplissage (`secretBase32` rendu par
 * `POST /nodefony/security/api/totp/enroll`).
 *
 * ⚠️ Un juge qui calcule FAUX accuserait l'agent de refuser un code juste :
 * `gate-step-up.selftest.mjs` l'éprouve sur le vecteur de l'annexe B de la
 * RFC, pas seulement sur son serveur jouet, qui partagerait la même erreur.
 *
 * @module
 */
import { createHmac } from "node:crypto";
import { request } from "./http-probe.mjs";

/** Période d'un code, en secondes (défaut du framework). */
export const PERIODE_S = 30;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Décode une chaîne base32 RFC 4648 (remplissage et espaces tolérés).
 *
 * @param {string} texte - le secret encodé.
 * @returns {Buffer} les octets du secret.
 */
export function base32Decode(texte) {
  const propre = texte.replace(/[\s=]/gu, "").toUpperCase();
  let bits = 0;
  let valeur = 0;
  const octets = [];
  for (const c of propre) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`base32 : caractère invalide « ${c} »`);
    valeur = (valeur << 5) | i;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

/**
 * Le pas de temps courant (compteur RFC 6238).
 *
 * @param {number} [maintenantMs] - heure en millisecondes epoch.
 * @returns {number} le numéro du pas.
 */
export const pasCourant = (maintenantMs = Date.now()) =>
  Math.floor(maintenantMs / 1000 / PERIODE_S);

/**
 * Le code d'un pas donné (RFC 4226 §5.3, troncature dynamique).
 *
 * @param {Buffer} cle - le secret, en octets.
 * @param {number} pas - le compteur.
 * @param {number} [chiffres] - longueur du code.
 * @returns {string} le code, complété de zéros à gauche.
 */
export function codeHotp(cle, pas, chiffres = 6) {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const mac = createHmac("sha1", cle).update(compteur).digest();
  const decalage = mac[mac.length - 1] & 0x0f;
  const binaire = mac.readUInt32BE(decalage) & 0x7fffffff;
  return String(binaire % 10 ** chiffres).padStart(chiffres, "0");
}

/**
 * Le code TOTP d'un secret base32 pour un pas donné.
 *
 * @param {string} secretBase32 - le secret tel que rendu à l'enrôlement.
 * @param {number} pas - le compteur (voir {@link pasCourant}).
 * @returns {string} le code à 6 chiffres.
 */
export const codeTotp = (secretBase32, pas) =>
  codeHotp(base32Decode(secretBase32), pas);

/** Routes libre-service du second facteur — celles du framework. */
export const ROUTES_TOTP = "/nodefony/security/api/totp";

/**
 * Enrôle un TOTP sur le compte de la session fournie, par les routes du
 * framework (`enroll` puis `confirm` avec le code du pas courant).
 *
 * Trois juges en ont besoin ; recopié, le geste divergerait au premier
 * changement de forme, et le juge en retard accuserait l'agent.
 *
 * @param {import("./http-probe.mjs").CookieJar} jar - une session ouverte au mot de passe.
 * @returns {Promise<{secret: string, pas: number}|{injoignable: string}|{indisponible: number}|{inoperant: string}>}
 *   le secret et le pas consommé par la confirmation — ou pourquoi rien n'est enrôlé :
 *   `indisponible` porte le statut (404/503) d'un TOTP absent ou coupé.
 */
export async function enrolerTotp(jar) {
  const json = { accept: "application/json" };
  const r = await request("POST", `${ROUTES_TOTP}/enroll`, jar, {
    headers: json,
  });
  if (r.error) return { injoignable: r.error };
  if (r.status === 404 || r.status === 503) return { indisponible: r.status };
  let secret;
  try {
    secret = JSON.parse(r.body).secretBase32 ?? null;
  } catch {
    secret = null;
  }
  if (r.status !== 200 || typeof secret !== "string") {
    return {
      inoperant: `POST ${ROUTES_TOTP}/enroll rend ${r.status} — ${String(r.body).slice(0, 160)}`,
    };
  }
  const pas = pasCourant();
  const c = await request("POST", `${ROUTES_TOTP}/confirm`, jar, {
    body: { code: codeTotp(secret, pas) },
    headers: json,
  });
  if (c.error) return { injoignable: c.error };
  if (c.status !== 200) {
    return {
      inoperant: `POST ${ROUTES_TOTP}/confirm rend ${c.status} — ${String(c.body).slice(0, 160)}`,
    };
  }
  return { secret, pas };
}
