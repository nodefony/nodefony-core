/**
 * Curseur de pagination `SCAN` — **règle unique** des trois stores Redis
 * (sessions, jetons, identifiants WebAuthn).
 *
 * Pourquoi un fichier partagé : ces trois stores portaient chacun leur copie de
 * `encodeCursor`/`decodeCursor`. La copie du store de session a été durcie (un
 * curseur venu de l'extérieur y est validé) ; les deux autres ne l'ont jamais
 * été — un `?cursor=` arbitraire y partait tel quel vers Redis et faisait
 * **échouer une simple consultation**. Deux implémentations d'une même règle
 * dérivent toujours : il n'y en a plus qu'une.
 */

/**
 * Plafond de sécurité d'un balayage administratif complet : au-delà, on s'arrête
 * et on **journalise** (listing partiel signalé, jamais tronqué en silence).
 *
 * `SCAN` est O(keyspace) — un index secondaire (`SET` d'ids) serait
 * l'optimisation v2 pour un très grand parc.
 */
export const MAX_SCAN = 10_000;

/**
 * Curseur de page **composite** : `"<skip>:<curseurRedis>"`.
 *
 * Pourquoi composer plutôt que passer le curseur Redis nu : `SCAN COUNT` est un
 * indice d'effort, pas un plafond — Redis peut rendre plus de clés que demandé
 * (petit keyspace encodé en listpack → tout arrive d'un coup). Sans précaution
 * la page dépasserait `limit` et violerait `IPage`. Le `skip` mémorise combien
 * de clés du batch courant ont déjà été rendues, pour que la page suivante
 * rejoue le même `SCAN` et reprenne à la bonne position. Rien n'est perdu, rien
 * ne déborde.
 */
export function encodeCursor(scanCursor: string, skip: number): string {
  return `${skip}:${scanCursor}`;
}

/**
 * Inverse d'{@link encodeCursor} — tolère un curseur absent, vide ou malformé.
 *
 * Le jeton vient de l'extérieur (query string du data plane admin, client qui
 * rejoue une page) : il n'est donc PAS digne de confiance. Un curseur `SCAN`
 * Redis est toujours une suite de chiffres — tout le reste repart de `"0"`
 * plutôt que d'être transmis au serveur, qui répondrait par une erreur et ferait
 * échouer une simple consultation. Repartir du début est faux au pire d'une
 * page ; jeter serait faux à coup sûr.
 *
 * Le split se fait au PREMIER `:` : le curseur Redis est opaque et reste intact
 * même s'il contenait lui-même un `:`.
 */
export function decodeCursor(cursor?: string): {
  scanCursor: string;
  skip: number;
} {
  if (!cursor) return { scanCursor: "0", skip: 0 };
  const sep = cursor.indexOf(":");
  if (sep === -1) {
    // Curseur Redis nu (client externe, ancien format) → honoré s'il est valide.
    return { scanCursor: scanOrZero(cursor), skip: 0 };
  }
  const skip = Number.parseInt(cursor.slice(0, sep), 10);
  return {
    scanCursor: scanOrZero(cursor.slice(sep + 1)),
    skip: Number.isFinite(skip) && skip > 0 ? skip : 0,
  };
}

/** Un curseur `SCAN` exploitable (chiffres) ou `"0"` — jamais du texte libre. */
export function scanOrZero(value: string): string {
  return /^\d+$/.test(value) ? value : "0";
}

/** Un lot `SCAN` tel que node-redis le rend : curseur suivant (string) + clés. */
export interface IScanBatch {
  cursor: string;
  keys: readonly string[];
}

/**
 * Rend UNE page d'un balayage `SCAN` filtré — règle unique des trois stores.
 *
 * Les lots s'enchaînent jusqu'à **remplir** la page, finir le balayage, ou
 * épuiser l'effort borné ({@link MAX_SCAN} emplacements examinés par appel).
 * 🔴 Un seul lot ne suffit pas : `SCAN COUNT` examine des emplacements de TOUT
 * le keyspace (autres applications, idempotence, jetons), et un lot peut ne
 * contenir aucune clé retenue par le filtre. Rendre cette page vide ferait
 * conclure « rien » à tout consommateur qui ne suit pas le curseur — c'était
 * le cas de la console « Mes sessions » sur un Redis partagé.
 *
 * Le curseur rendu est composite ({@link encodeCursor}) : une page pleine au
 * milieu d'un lot reprend au MÊME lot, à la bonne position. Le keyspace n'est
 * jamais matérialisé — un lot à la fois.
 *
 * @param scan - lance un `SCAN` depuis ce curseur (MATCH et COUNT fixés par
 *   l'appelant ; `COUNT` doit rester le même d'une page à l'autre)
 * @param cursor - curseur reçu du client (non fiable — décodé et validé)
 * @param limit - taille maximale de la page
 * @param accept - lit une clé et rend l'élément à publier, ou `null` s'il est
 *   écarté (filtre, clé expirée, valeur corrompue)
 * @returns les éléments de la page et le curseur suivant (`null` = fin)
 */
export async function scanPage<T>(
  scan: (cursor: string) => Promise<IScanBatch>,
  cursor: string | undefined,
  limit: number,
  accept: (key: string) => Promise<T | null>,
): Promise<{ items: T[]; nextCursor: string | null }> {
  let { scanCursor, skip } = decodeCursor(cursor);
  const items: T[] = [];
  let budget = Math.max(1, Math.ceil(MAX_SCAN / limit));
  for (;;) {
    const res = await scan(scanCursor);
    budget -= 1;
    // `consumed` compte les CLÉS du lot parcourues (pas les éléments rendus) :
    // c'est la position de reprise, et le filtre en écarte une partie.
    let consumed = 0;
    for (const key of res.keys.slice(skip)) {
      if (items.length >= limit) break; // page pleine → le reste pour après
      consumed += 1;
      const item = await accept(key);
      if (item !== null) items.push(item);
    }
    if (skip + consumed < res.keys.length) {
      // Page pleine au milieu du lot : on reste sur ce lot.
      return { items, nextCursor: encodeCursor(scanCursor, skip + consumed) };
    }
    if (res.cursor === "0") {
      return { items, nextCursor: null }; // lot épuisé ET balayage terminé
    }
    scanCursor = scanOrZero(res.cursor);
    skip = 0;
    if (items.length >= limit || budget <= 0) {
      // Page pleine, ou effort épuisé : la page part avec de quoi reprendre.
      return { items, nextCursor: encodeCursor(scanCursor, 0) };
    }
  }
}
