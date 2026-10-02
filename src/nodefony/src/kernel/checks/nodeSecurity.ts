/**
 * Contrôle de SÉCURITÉ du runtime — ce Node a-t-il des failles déjà corrigées ?
 *
 * `engines.node` dit le PLANCHER fonctionnel (`freshness.ts`). Il ne dit rien
 * de la sécurité : un Node 24.10 satisfait `>=24`, et porte pourtant toutes les
 * failles corrigées par les publications de sécurité 24.x parues depuis. Relever
 * `engines` pour l'interdire casserait l'installation de qui n'a pas migré — une
 * rupture. Le geste juste est un AVERTISSEMENT, nommant la version qui corrige.
 *
 * La vérité vient de la liste officielle (`nodejs.org/dist/index.json`, champ
 * `security` de chaque publication), JAMAIS d'une table écrite ici : une table
 * figée se périme à la publication suivante et rend « à jour » un Node troué.
 * Injoignable ⇒ contrôle NON FAIT, dit comme tel — jamais un quitus.
 */
import { readFile } from "node:fs/promises";

/** Une publication de Node, telle que la liste officielle la décrit. */
export interface INodeRelease {
  /** `v24.21.0` */
  version: string;
  /** Date de publication, `AAAA-MM-JJ`. */
  date: string;
  /** Vrai quand la publication corrige au moins une faille. */
  security: boolean;
}

/** Le constat : ce Node a des failles corrigées depuis. */
export interface INodeSecurityGap {
  /** Version du runtime examiné. */
  current: string;
  /** Publications de sécurité de la même majeure, postérieures à lui. */
  securityReleases: number;
  /** La plus récente publication de la même majeure — la cible du geste. */
  latest: INodeRelease;
}

/** Adresse par défaut de la liste officielle des publications. */
export const NODE_DIST_INDEX = "https://nodejs.org/dist/index.json";

/** Délai au-delà duquel la liste est déclarée injoignable. */
const FETCH_TIMEOUT_MS = 3000;

/** `v24.10.0` → `[24, 10, 0]`, ou `null` si la forme n'est pas reconnue. */
function parseVersion(version: string): [number, number, number] | null {
  // Forme EXACTE, sans `trim()` : un `\r` toléré ici réécrirait la ligne affichée.
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  return a[0] !== b[0]
    ? a[0] > b[0]
    : a[1] !== b[1]
      ? a[1] > b[1]
      : a[2] > b[2];
}

/**
 * Confronte une version de Node à la liste officielle des publications.
 *
 * Fonction PURE : la liste est injectée, la version aussi — une règle qui lit
 * `process.version` ne s'éprouve que sur la version qu'elle décrit.
 *
 * @param current - version du runtime (`process.version`).
 * @param releases - liste officielle des publications.
 * @returns le constat, ou `null` quand aucune publication de sécurité de la
 *          même majeure n'est postérieure (ou que la version ne se lit pas).
 */
export function assessNodeSecurity(
  current: string,
  releases: readonly INodeRelease[],
): INodeSecurityGap | null {
  const mine = parseVersion(current);
  if (!mine) return null;
  let latest: INodeRelease | null = null;
  let latestParsed: [number, number, number] | null = null;
  let securityReleases = 0;
  for (const release of releases) {
    const parsed = parseVersion(release.version);
    if (!parsed || parsed[0] !== mine[0] || !isNewer(parsed, mine)) continue;
    if (release.security) securityReleases++;
    if (!latestParsed || isNewer(parsed, latestParsed)) {
      latest = release;
      latestParsed = parsed;
    }
  }
  if (securityReleases === 0 || !latest) return null;
  return { current, securityReleases, latest };
}

/** Date de publication telle que la liste officielle l'écrit. */
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Tout ce qu'un terminal peut interpréter comme une commande : C0, DEL, C1. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/gu;

/**
 * Garde la forme utile d'une entrée de la liste, ou `null`.
 *
 * 🔴 La version et la date finissent dans un TERMINAL : une source hostile
 * (miroir compromis) y glisserait une séquence d'échappement — effacer
 * l'écran, réécrire le titre, poser un lien trompeur. Elles ne passent donc
 * que dans leur forme EXACTE, jamais « nettoyées ».
 */
function toRelease(entry: unknown): INodeRelease | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { version, date, security } = entry as Record<string, unknown>;
  if (typeof version !== "string" || typeof date !== "string") return null;
  if (!parseVersion(version) || !RELEASE_DATE.test(date)) return null;
  return { version, date, security: security === true };
}

/** Résultat d'une lecture de la liste : les publications, ou la raison d'échec. */
export type NodeReleasesResult =
  { ok: true; releases: INodeRelease[] } | { ok: false; reason: string };

/**
 * Lit la liste officielle des publications de Node.
 *
 * La source se règle par `NF_NODE_DIST_URL` : une URL (miroir d'entreprise) ou
 * un CHEMIN de fichier (poste sans accès à Internet, banc de test). Défaut :
 * {@link NODE_DIST_INDEX}.
 *
 * @param source - URL ou chemin ; défaut `NF_NODE_DIST_URL` puis la liste officielle.
 * @returns les publications, ou la raison pour laquelle elles manquent.
 */
export async function loadNodeReleases(
  source: string = process.env["NF_NODE_DIST_URL"] || NODE_DIST_INDEX,
): Promise<NodeReleasesResult> {
  try {
    let body: unknown;
    if (/^https?:\/\//u.test(source)) {
      const res = await fetch(source, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok)
        return { ok: false, reason: `${source} : HTTP ${res.status}` };
      body = await res.json();
    } else {
      body = JSON.parse(await readFile(source, "utf8"));
    }
    if (!Array.isArray(body)) {
      return {
        ok: false,
        reason: `${source} : liste attendue, forme inconnue`,
      };
    }
    const releases = body
      .map(toRelease)
      .filter((r): r is INodeRelease => r !== null);
    if (releases.length === 0) {
      return { ok: false, reason: `${source} : aucune publication lisible` };
    }
    return { ok: true, releases };
  } catch (error) {
    // Le message de `JSON.parse` recopie un extrait du corps reçu : ses octets
    // de contrôle n'atteignent pas le terminal.
    const why = (
      error instanceof Error ? error.message : String(error)
    ).replace(CONTROL_CHARS, "?");
    return { ok: false, reason: `${source} injoignable (${why})` };
  }
}

/**
 * La phrase du constat : la faille, puis le geste.
 *
 * @param gap - le constat rendu par {@link assessNodeSecurity}.
 * @returns la phrase actionnable.
 */
export function nodeSecurityMessage(gap: INodeSecurityGap): string {
  const target = gap.latest.version.replace(/^v/u, "");
  const major = target.split(".")[0];
  const count =
    gap.securityReleases === 1
      ? "1 publication de sécurité est parue"
      : `${gap.securityReleases} publications de sécurité sont parues`;
  return (
    `Node ${gap.current} porte des failles déjà corrigées : ${count} depuis ` +
    `dans la série ${major} (la dernière version, ${gap.latest.version}, date ` +
    `du ${gap.latest.date}). Il s'agit du Node de CE poste ; une image bâtie ` +
    `sur \`node:${major}-*\` suit la série. → installer Node ${target} ` +
    `(ex. \`nvm install ${major}\`)`
  );
}
