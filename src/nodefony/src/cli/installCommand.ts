/**
 * Ce qu'une page AFFICHE pour installer Nodefony : la commande qui crée une
 * application, et la plage de Node.js exigée.
 *
 * Ces deux valeurs se DÉDUISENT du paquet qui tourne, elles ne s'écrivent
 * jamais en dur. Écrite en dur, la commande `npx nodefony create app` lancée
 * hors d'une application va chercher le `latest` de `nodefony` sur npm — tant
 * que la ligne 10 est en préversion, la 7.0.2 en JavaScript, sans rapport
 * avec la page qui la propose. Un badge « Node.js ≥ 24 » recopié à la main
 * mentait de même sur la plage d'`engines`.
 *
 * Une seule règle, appelée par l'écran de connexion, l'accueil de la démo
 * générée et le message du noyau lancé hors d'une application. Les scripts de
 * publication en portent une copie (`canalDeVersion`, frontière de paquet) :
 * un test confronte les deux.
 */
import { engines, version as frameworkVersion } from "../../package.json";

/** Version semver (même grammaire que `scripts/release/release-core.mjs#SEMVER`). */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/u;

/** Plage de Node.js exigée par le framework, lue dans `engines` de son manifeste. */
export const NODE_ENGINE_RANGE: string = engines.node;

/** Un plancher de plage : `^24.16.0` ou `>=26.0.0`. */
const RANGE_FLOOR = /^(?:\^|>=)\s*(\d+)\.(\d+)\.(\d+)$/u;

/**
 * Plage de Node.js en clair, pour un badge : `^24.16.0 || >=26.0.0` →
 * `24.16+ ou 26+`. Une forme que la règle ne reconnaît pas est rendue telle
 * quelle — exacte, à défaut d'être lisible.
 *
 * @param range - plage semver (`engines.node`)
 * @returns la plage lisible
 */
export function describeNodeRange(range: string): string {
  const floors: string[] = [];
  for (const part of range.split("||")) {
    const match = RANGE_FLOOR.exec(part.trim());
    if (match === null) return range;
    const [, major, minor, patch] = match;
    floors.push(
      patch !== "0"
        ? `${major}.${minor}.${patch}+`
        : minor !== "0"
          ? `${major}.${minor}+`
          : `${major}+`,
    );
  }
  return floors.join(" ou ");
}

/** Plage de Node.js exigée par le framework, en clair (`24.16+ ou 26+`). */
export const NODE_ENGINE_LABEL: string = describeNodeRange(NODE_ENGINE_RANGE);

/**
 * Canal npm (dist-tag) qui sert une version : l'identifiant de sa préversion
 * (`10.0.0-beta.8` → `beta`), sinon `latest`.
 *
 * @param version - une version semver
 * @returns le canal, ou `null` si la version est invalide
 */
export function npmChannelOf(version: string): string | null {
  const match = SEMVER.exec(version);
  if (match === null) return null;
  const prerelease = match[4];
  if (prerelease === undefined) return "latest";
  const dot = prerelease.indexOf(".");
  return dot === -1 ? prerelease : prerelease.slice(0, dot);
}

/**
 * Spécificateur npm d'un paquet du framework pour la version donnée, canal
 * NOMMÉ tant que c'est une préversion (`@nodefony/http@beta`), nu pour une
 * stable — `latest` est alors la ligne de cette version.
 *
 * @param name - nom npm du paquet (`nodefony`, `@nodefony/http`…)
 * @param version - version du framework ; défaut : celle du paquet qui tourne
 * @returns le spécificateur, prêt à écrire dans une commande
 */
export function packageSpec(
  name: string,
  version: string = frameworkVersion,
): string {
  const channel = npmChannelOf(version);
  return channel === null || channel === "latest" ? name : `${name}@${channel}`;
}

/**
 * Commande qui crée une application de la version donnée, canal NOMMÉ tant que
 * c'est une préversion : `npm create nodefony@beta mon-app`. Une stable
 * s'écrit sans canal, `latest` étant alors la ligne de cette version.
 *
 * @param appName - nom d'application montré dans la commande ; vide = aucun
 * @param version - version du framework ; défaut : celle du paquet qui tourne
 * @returns la commande, prête à copier
 */
export function createAppCommand(
  appName: string,
  version: string = frameworkVersion,
): string {
  const spec = packageSpec("nodefony", version);
  return appName === ""
    ? `npm create ${spec}`
    : `npm create ${spec} ${appName}`;
}

/**
 * Commande qui crée une application JETABLE portant la démo :
 * `npm create nodefony essai -- --demo`. La démo sert à apprendre, pas à
 * rester — on ne l'ajoute pas à une application, on en crée une pour elle.
 * Une seule règle pour la fin de `create app` et l'accueil de développement.
 *
 * @param version - version du framework ; défaut : celle du paquet qui tourne
 * @returns la commande, prête à copier
 */
export function demoAppCommand(version: string = frameworkVersion): string {
  return `${createAppCommand("essai", version)} -- --demo`;
}
