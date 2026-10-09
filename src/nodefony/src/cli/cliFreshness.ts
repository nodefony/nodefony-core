import semver from "semver";
import { RESERVED_ENV } from "../config/reservedEnv";

/** Délai maximal accordé au registre : au-delà, on se tait. */
export const FRESHNESS_TIMEOUT_MS = 1500;

/** Registre public — remplacé par celui que npm a configuré quand il est connu. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** Une version publiée plus récente que le CLI qui tourne, et le tag qui la sert. */
export interface INewerRelease {
  version: string;
  tag: string;
}

/**
 * Choisit, parmi les `dist-tags` publiés, la version plus récente que celle du
 * CLI qui tourne — `null` s'il n'y en a pas.
 *
 * 🔴 **`latest` n'est PAS « la dernière version ».** Pour `nodefony`, il désigne
 * encore la 7.x (l'ancien framework JavaScript) pendant que la 10 se publie sous
 * `alpha` puis `beta`. Comparer au seul `latest` ne verrait jamais une 10.0.0-beta.3,
 * et conseiller `npm i -g nodefony@latest` à qui tourne en 10.0.0-beta.2 lui
 * installerait la 7. On compare donc à TOUS les tags, et le geste nomme le tag
 * qui porte la version retenue.
 *
 * La règle tient le canal de l'utilisateur :
 * - une version **stable** plus récente est toujours retenue ;
 * - une **préversion** n'est retenue que si le CLI est lui-même une préversion
 *   de la même majeure — on ne pousse pas qui tourne en stable vers une bêta,
 *   ni qui teste la 10 vers une alpha de la 11.
 *
 * @param self - version du CLI qui tourne.
 * @param distTags - les `dist-tags` du paquet, tels que le registre les rend.
 * @returns la plus haute version retenue et son tag, ou `null`.
 */
export function newerPublishedRelease(
  self: string,
  distTags: Readonly<Record<string, unknown>>,
): INewerRelease | null {
  const current = semver.parse(self);
  if (current === null) return null;
  let best: INewerRelease | null = null;
  for (const [tag, raw] of Object.entries(distTags)) {
    if (typeof raw !== "string") continue;
    const candidate = semver.parse(raw);
    if (candidate === null || !semver.gt(candidate, current)) continue;
    const isPrerelease = candidate.prerelease.length > 0;
    if (
      isPrerelease &&
      (current.prerelease.length === 0 || candidate.major !== current.major)
    ) {
      continue;
    }
    if (best === null || semver.gt(candidate, best.version)) {
      best = { version: candidate.version, tag };
    }
  }
  return best;
}

/**
 * Rend l'annonce d'un CLI périmé, avec le geste qui le met à jour.
 *
 * @param self - version du CLI qui tourne.
 * @param newer - la version plus récente retenue.
 * @returns le texte à écrire sur la sortie d'erreur.
 */
export function renderStaleCliNotice(
  self: string,
  newer: INewerRelease,
): string {
  return (
    `\n⚠ ce CLI est en ${self}, et ${newer.version} est publiée : ` +
    `l'application vient d'être engendrée sur la ${self}.\n` +
    `  npm i -g nodefony@${newer.tag}   # met le CLI global à jour\n`
  );
}

/**
 * Dit si la vérification doit être sautée : en intégration continue, ou quand
 * l'utilisateur l'a coupée.
 *
 * @param env - environnement à lire.
 * @returns `true` pour ne rien demander au registre.
 */
export function freshnessCheckDisabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const off = env[RESERVED_ENV.NF_NO_UPDATE_CHECK.name];
  return Boolean(env.CI) || (off !== undefined && off !== "" && off !== "0");
}

/**
 * Demande au registre les `dist-tags` d'un paquet — `null` au moindre écart.
 *
 * Ne lève JAMAIS : hors ligne, registre lent, réponse inattendue, tout rend
 * `null`, et l'appelant se tait. La requête est bornée par `timeoutMs` ; le
 * document abrégé (`install-v1`) suffit et pèse une fraction du complet.
 *
 * @param name - nom du paquet.
 * @param options.registry - registre à interroger (défaut : public).
 * @param options.timeoutMs - délai maximal.
 * @param options.fetchImpl - `fetch` injectable (tests).
 * @returns les `dist-tags`, ou `null`.
 */
export async function fetchDistTags(
  name: string,
  options: {
    registry?: string | undefined;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Record<string, unknown> | null> {
  const registry = (options.registry || DEFAULT_REGISTRY).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${registry}/${name.replaceAll("/", "%2F")}`, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? FRESHNESS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return null;
    const tags = (body as { "dist-tags"?: unknown })["dist-tags"];
    return typeof tags === "object" && tags !== null
      ? Object.fromEntries(Object.entries(tags))
      : null;
  } catch {
    return null;
  }
}

/**
 * Lance la vérification de fraîcheur du CLI et rend la promesse de son annonce.
 *
 * Partie AVANT la génération, attendue après : la requête court pendant
 * l'installation, et ne coûte donc rien dans le cas courant.
 *
 * @param self - version du CLI qui tourne.
 * @param env - environnement (désactivation, registre configuré par npm).
 * @param fetchImpl - `fetch` injectable (tests).
 * @returns l'annonce à écrire, ou `null`.
 */
export function startFreshnessCheck(
  self: string,
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: typeof fetch,
): Promise<string | null> {
  if (freshnessCheckDisabled(env)) return Promise.resolve(null);
  return fetchDistTags("nodefony", {
    registry: env.npm_config_registry,
    ...(fetchImpl ? { fetchImpl } : {}),
  }).then((tags) => {
    const newer = tags ? newerPublishedRelease(self, tags) : null;
    return newer ? renderStaleCliNotice(self, newer) : null;
  });
}
