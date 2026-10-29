/**
 * Conversions IEEE 754 binary16 (« demi-précision ») du codec CBOR — RFC 8949 §3.3 et Appendice D.
 *
 * Isolées ici parce que l'encodeur (sérialisation préférée, §4.1 : le flottant le plus
 * court qui conserve la valeur) et le décodeur (lecture de `0xf9`) en ont tous deux
 * besoin, et que ni `DataView` ni `Math` ne connaissent ce format.
 */

const probe = new DataView(new ArrayBuffer(4));

/**
 * Bits binary16 d'un nombre déjà exact en binary32, ou `-1` s'il n'y tient pas sans perte.
 *
 * L'appelant garantit `Math.fround(v) === v` et `v` fini : on part des 32 bits du
 * binary32 et l'on vérifie que les 13 bits bas de la mantisse sont nuls et que
 * l'exposant tient dans les 5 bits du binary16 (normalisé, ou dénormalisé exact).
 *
 * @param v - nombre fini, exactement représentable en binary32
 * @returns les 16 bits (0..65535) ou `-1`
 */
export function float16Bits(v: number): number {
  probe.setFloat32(0, v);
  const u = probe.getUint32(0);
  const sign = (u >>> 16) & 0x8000;
  const exp = (u >>> 23) & 0xff;
  const mant = u & 0x7fffff;
  // 23 bits de mantisse → 10 : les 13 bits bas doivent être nuls.
  if ((mant & 0x1fff) !== 0) return -1;
  // ±0 passe ; un dénormalisé binary32 (< 2^-126) est hors de portée du binary16.
  if (exp === 0) return mant === 0 ? sign : -1;
  const e = exp - 127;
  if (e >= -14 && e <= 15) return sign | ((e + 15) << 10) | (mant >>> 13);
  if (e >= -24 && e < -14) {
    // Dénormalisé binary16 : mantisse implicite (bit 10) décalée, sans perdre un bit.
    const full = 0x400 | (mant >>> 13);
    const shift = -14 - e;
    if ((full & ((1 << shift) - 1)) !== 0) return -1;
    return sign | (full >>> shift);
  }
  return -1;
}

/**
 * Valeur d'un binary16 donné par ses 16 bits (RFC 8949 Appendice D).
 *
 * `0x8000` rend `-0`, `0x7c00`/`0xfc00` les infinis, toute mantisse non nulle
 * avec exposant 31 rend `NaN` — l'appelant décide ensuite ce qu'il en fait.
 *
 * @param h - les 16 bits (0..65535)
 * @returns le nombre représenté
 */
export function float16Value(h: number): number {
  const exp = h & 0x7c00;
  if (exp === 0) {
    // Zéro ou dénormalisé : mantisse × 2^-24 (une constante, pas un `2 **`).
    const v = (h & 0x3ff) * 5.960464477539063e-8;
    return (h & 0x8000) !== 0 ? -v : v;
  }
  if (exp === 0x7c00) {
    if ((h & 0x3ff) !== 0) return NaN;
    return (h & 0x8000) !== 0 ? -Infinity : Infinity;
  }
  // Normalisé : on recompose le binary32 équivalent — signe, exposant rebiaisé (15 → 127),
  // mantisse étendue de 10 à 23 bits — et on le relit. Exact, et sans `Math.pow`.
  probe.setUint32(
    0,
    ((h & 0x8000) << 16) | (((exp >>> 10) + 112) << 23) | ((h & 0x3ff) << 13),
  );
  return probe.getFloat32(0);
}
