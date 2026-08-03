/**
 * Juge de la tâche « isoler une partie de l'app dans un composant » — et il
 * NOMME sa cause.
 *
 * Il n'interroge pas le dépôt : il demande à l'APPLICATION ce qu'elle charge
 * (`nodefony inspect modules --json`, `inspect routes --json`). La distinction
 * est tout l'intérêt de ce juge — on peut créer un dossier `modules/audit/`
 * complet, avec son `package.json` et ses classes, sans que l'application le
 * charge : il manque alors le workspace, l'installation, ou l'entrée du
 * manifeste. Le dépôt aurait l'air juste, l'application ne saurait rien du
 * composant, et une sonde qui lirait des fichiers rendrait un vert.
 *
 * | Sortie | Cause                  | Ce que ça dit                                            |
 * | -----: | ---------------------- | -------------------------------------------------------- |
 * |    `0` | conforme               | un composant local est CHARGÉ et porte ses propres routes |
 * |    `1` | aucun-module-local     | l'app ne charge qu'elle-même et les paquets du framework  |
 * |    `2` | module-non-charge      | un dossier de module existe sur le disque, l'app l'ignore |
 * |    `3` | composant-sans-route   | chargé, mais aucune route ne lui appartient               |
 * |    `5` | inspection-impossible  | l'application ne se laisse pas lire — à INSTRUIRE          |
 *
 * La cause `5` ne tranche PAS : l'application ne se laisse pas lire, et les deux
 * explications s'excluent — le décor (application non construite) ou le code que
 * l'agent vient d'écrire (un chargement qui échoue). La confondre avec « pas de
 * module » rendrait le pire des verdicts, un rouge crédible sur un travail juste ;
 * mais l'imputer d'office au décor blanchirait un agent qui a cassé le boot. Elle
 * s'INSTRUIT — le gate de compilation, joué sur la même tâche, tranche le plus
 * souvent. La cause `2` est l'inverse : c'est le demi-travail le plus probable, et
 * la nommer évite de soupçonner le générateur quand c'est le câblage qui manque.
 *
 * Rien n'est littéralisé — ni un nom de module, ni un chemin sur le disque, ni
 * un préfixe de route. L'énoncé n'en dicte aucun, et un agent qui range son
 * composant ailleurs ou nomme ses routes autrement a fait juste. Le critère est
 * DÉDUIT, comme celui de la tâche 13 : un module que l'application charge, qui
 * n'est pas elle-même, qui n'est pas un paquet du framework, et qui ne vient pas
 * de `node_modules` — donc du code de ce dépôt, pas une dépendance installée.
 *
 * @module
 */
import { execFileSync } from "node:child_process";

/**
 * Interroge l'application, sans ouvrir de port.
 *
 * @param {string} sujet - `modules` ou `routes`.
 * @param {string} [cwd] - l'application (défaut : répertoire courant).
 * @returns {unknown[] | null} la réponse, ou `null` si l'app ne se laisse pas lire.
 */
function demanderALApp(sujet, cwd = process.cwd()) {
  try {
    const sortie = execFileSync(
      "npx",
      ["--no-install", "nodefony", "inspect", sujet, "--json"],
      {
        cwd,
        encoding: "utf8",
        timeout: 3 * 60 * 1000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const parsed = JSON.parse(sortie);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Un module est-il un composant LOCAL de cette application ?
 *
 * Exporté pour l'auto-contrôle : c'est LA règle du juge, et un contrôle qui la
 * réimplémenterait ne validerait que sa propre copie.
 *
 * @param {{name?: string, path?: string, isApp?: boolean}} m - une entrée d'`inspect modules`.
 * @returns {boolean} vrai si c'est du code de ce dépôt, ni l'app ni le framework.
 */
export function estComposantLocal(m) {
  if (m.isApp) return false;
  if ((m.name ?? "").startsWith("@nodefony/")) return false;
  if (m.name === "nodefony") return false;
  // Une DÉPENDANCE installée n'est pas un composant qu'on a isolé : c'est du
  // code que quelqu'un d'autre a écrit et que npm a posé là.
  const p = (m.path ?? "").replaceAll("\\", "/");
  return p !== "" && p !== "." && !p.includes("node_modules");
}

/**
 * Le verdict, sur des données déjà collectées.
 *
 * Séparé de la collecte pour la même raison qu'`evaluateProbe` l'est du banc :
 * l'auto-contrôle éprouve CETTE fonction sur des états figés, sans monter la
 * moindre application.
 *
 * @param {{modules: unknown[]|null, routes: unknown[]|null, dossierModulesSurDisque: boolean}} etat
 * @returns {{code: number, message: string}} le code de sortie et sa cause.
 */
export function juger({ modules, routes, dossierModulesSurDisque }) {
  if (modules === null) {
    return {
      code: 5,
      message:
        "CAUSE=inspection-impossible — `nodefony inspect modules` n'a rien rendu : " +
        "l'application ne se laisse pas lire (non construite, ou son chargement échoue). " +
        "À INSTRUIRE — ce peut être le décor comme du code que l'agent vient d'écrire ; " +
        "le gate de compilation de la même tâche tranche le plus souvent.",
    };
  }
  const locaux = modules.filter(estComposantLocal);
  if (locaux.length === 0) {
    if (dossierModulesSurDisque) {
      return {
        code: 2,
        message:
          "CAUSE=module-non-charge — un dossier de module existe sur le disque, mais " +
          "l'application ne charge aucun composant local : il manque le workspace, " +
          "l'installation, ou l'entrée du manifeste (`use(...)`).",
      };
    }
    return {
      code: 1,
      message:
        "CAUSE=aucun-module-local — l'application ne charge qu'elle-même et les paquets " +
        "du framework. La logique est restée DANS l'app : rien n'est retirable ni réutilisable.",
    };
  }
  if (routes === null) {
    return {
      code: 5,
      message:
        "CAUSE=inspection-impossible — `nodefony inspect routes` n'a rien rendu, alors que " +
        "les modules se lisaient. À INSTRUIRE, et surtout PAS à lire comme « le composant " +
        "n'a pas de route » : on ne sait pas ce qu'il porte.",
    };
  }
  const cles = new Set(locaux.map((m) => m.key ?? m.name));
  const auComposant = routes.filter((r) => r.module && cles.has(r.module));
  if (auComposant.length === 0) {
    return {
      code: 3,
      message:
        `CAUSE=composant-sans-route — le composant « ${[...cles].join(", ")} » est chargé, ` +
        "mais aucune route ne lui appartient : les points d'entrée sont restés dans " +
        "l'application, qui demeure donc indissociable de lui.",
    };
  }
  return {
    code: 0,
    message:
      `conforme — composant « ${[...cles].join(", ")} » chargé par l'application, ` +
      `${auComposant.length} route(s) lui appartiennent`,
  };
}

function main() {
  const modules = demanderALApp("modules");
  // La collecte du disque ne sert QU'À distinguer « rien fait » de « fait mais
  // pas câblé » : on ne la paie que dans ce cas.
  let dossierModulesSurDisque = false;
  if (modules !== null && modules.filter(estComposantLocal).length === 0) {
    try {
      dossierModulesSurDisque = /modules[/\\]/u.test(
        execFileSync("git", ["status", "--short", "--untracked-files=all"], {
          encoding: "utf8",
          timeout: 60_000,
        }),
      );
    } catch {
      dossierModulesSurDisque = false;
    }
  }
  const routes = modules === null ? null : demanderALApp("routes");
  const { code, message } = juger({ modules, routes, dossierModulesSurDisque });
  console.log(message);
  process.exit(code);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main();
}
