import type { PackageManagerName } from "../../Cli";
import type { IAppContributionContext } from "../contributions";
import {
  packageManagerFromField,
  resolvePackageManager,
} from "../packageManager";
import { renderAppDockerfile } from "./engine";
import { manifestString, parsePackageManifest } from "./packageManifest";

/** Chemin du `Dockerfile` dans l'application, en `/` (il voyage). */
export const APP_DOCKERFILE_PATH = "Dockerfile";

/**
 * Le gestionnaire de paquets d'une application déjà créée : le champ
 * `packageManager` de son `package.json`, sinon le verrou présent.
 *
 * Ni l'agent de l'invocation ni un défaut : `npx nodefony upgrade` lancé dans
 * une application bun dirait `npm`, et la copie suivie, intacte, serait
 * remplacée par un `Dockerfile` qui installe avec le mauvais outil.
 *
 * @param context - contexte de la contribution
 * @returns le gestionnaire constaté, ou `null` si rien ne le dit
 */
export function appPackageManager(
  context: Pick<IAppContributionContext, "appRoot" | "read">,
): PackageManagerName | null {
  const text = context.read("package.json");
  if (text !== null) {
    try {
      const declared = packageManagerFromField(
        manifestString(
          parsePackageManifest(text, "package.json"),
          "packageManager",
        ),
      );
      if (declared !== null) return declared;
    } catch {
      // Manifeste illisible : le verrou tranche.
    }
  }
  const resolved = resolvePackageManager({
    dir: context.appRoot,
    userAgent: undefined,
  });
  return resolved.source === "lockfile" ? resolved.name : null;
}

/**
 * Contribution du paquet `nodefony` à une application (`nodefony.contribute`) :
 * son `Dockerfile`, en COPIE SUIVIE.
 *
 * Posé par `create app`, il était une semence que plus rien ne rafraîchissait :
 * un piège corrigé dans le gabarit n'atteignait aucune application existante.
 * Suivi, il est remplacé par `scaffold:sync --update` (et donc `nodefony
 * upgrade`) tant que l'application ne l'a pas retouché ; une copie retouchée
 * est rapportée `modified` et gardée. Une copie identique à la livraison
 * s'inscrit au registre d'elle-même — c'est le cas d'une application qui vient
 * d'être créée.
 *
 * Gestionnaire introuvable (ni champ, ni verrou) → rien n'est posé : rendre le
 * fichier pour un outil deviné remplacerait une copie intacte par une fausse.
 *
 * @param context - contexte fourni par `runAppContributions`
 */
export function contribute(context: IAppContributionContext): void {
  const manager = appPackageManager(context);
  if (manager === null) return;
  context.write(
    APP_DOCKERFILE_PATH,
    renderAppDockerfile(context.appName, manager),
    { tracked: true },
  );
}
