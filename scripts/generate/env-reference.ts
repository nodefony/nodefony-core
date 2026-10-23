/**
 * La page PUBLIQUE des variables d'environnement, rendue depuis les registres
 * du produit — jamais écrite à la main.
 *
 * Trois sources, celles que lit déjà la notice `.env.example` de toute
 * application : le catalogue du `env.ts` d'une application GÉNÉRÉE (préréglage
 * complet, rendu à blanc par le vrai moteur de scaffold), `frameworkEnvCatalog`
 * (les réglages que le framework lit lui-même) et les noms courts que les
 * schémas des modules déclarent (`.meta({ env })`), convertis par
 * `moduleShortcutsCatalog`. Défaut et exigence passent par les règles de la
 * notice (`envVarDefaultText`, `isEnvVarRequired`) : la page et la notice ne
 * peuvent pas annoncer deux choses différentes d'une même variable, et ajouter
 * une variable au code puis régénérer suffit à la faire paraître ici.
 *
 * @usage import { renderEnvReference } from "./env-reference"
 * @output docs/guides/variables-environnement.md (écrit par son appelant)
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { frameworkEnvCatalog } from "../../src/nodefony/src/config/reservedEnv.ts";
import { collectEnvShortcuts } from "../../src/nodefony/src/config/envShortcuts.ts";
import {
  envVarDefaultText,
  isEnvVarRequired,
} from "../../src/nodefony/src/config/envExample.ts";
import {
  envVarPlacement,
  getEnvCatalog,
  type EnvVarPlacement,
  type NamedEnvVarMeta,
} from "../../src/nodefony/src/config/defineEnv.ts";
import { runScaffold } from "../../src/nodefony/src/cli/scaffold/engine.ts";
import { moduleShortcutsCatalog } from "../../src/nodefony/src/cli/env.ts";
import type { IModuleShortcut } from "../../src/nodefony/src/cli/envReport.ts";
import {
  CONFIG_SCHEMA_EXPORT,
  CONFIG_SCHEMA_FIELD,
  declaredPackageEntry,
} from "../../src/nodefony/src/cli/packageManifest.ts";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";

/** Chemin de la page, en `/` : il voyage (frontmatter, message, `git add`). */
export const ENV_REFERENCE_PAGE = "docs/guides/variables-environnement.md";

/** Nom de l'application témoin : il paraît dans les exemples de la page. */
const SAMPLE_APP = "mon-app";

/** Source du module qui déclare `defineEnv` et ses briques, en URL d'import. */
const DEFINE_ENV_URL = pathToFileURL(
  path.join(ROOT, "src", "nodefony", "src", "config", "defineEnv.ts"),
).href;

/**
 * Le catalogue du `env.ts` d'une application générée en préréglage complet.
 *
 * Le gabarit est rendu par `runScaffold` en simulation — le moteur que
 * `create app` exécute, donc les mêmes conditions et le même nom —, puis le
 * fichier rendu est importé, et son catalogue lu par `getEnvCatalog`, comme le
 * fait `nodefony env --example`. Son import de `nodefony` est redirigé vers la
 * SOURCE de `defineEnv` : le catalogue et ses métadonnées viennent alors du
 * même module, sans dépendre d'un `dist/` qui peut dater d'avant le commit.
 *
 * Le dossier jetable vit sous le dossier temporaire du système et disparaît
 * avec l'appel.
 *
 * @returns les variables déclarées, dans l'ordre du gabarit.
 * @throws Error si le rendu ne produit pas d'`env.ts` à la racine.
 */
async function readAppTemplateCatalog(): Promise<readonly NamedEnvVarMeta[]> {
  const version = (
    JSON.parse(
      readFileSync(path.join(ROOT, "src", "nodefony", "package.json"), "utf8"),
    ) as { version: string }
  ).version;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "nf-env-reference-"));
  try {
    const dir = path.join(tmp, SAMPLE_APP);
    const result = runScaffold(
      {
        type: "app",
        answers: { name: SAMPLE_APP, preset: "complete", frontend: "none" },
        dir,
        force: false,
      },
      version,
      { dryRun: true },
    );
    const rendered = (result.changes ?? []).find(
      (c) => c.path === path.join(dir, "env.ts"),
    );
    if (!rendered) {
      throw new Error("le rendu de create app ne contient pas d'env.ts");
    }
    const file = path.join(tmp, "env.mts");
    writeFileSync(
      file,
      rendered.content.replace(
        /from "nodefony";/u,
        `from ${JSON.stringify(DEFINE_ENV_URL)};`,
      ),
    );
    const mod = (await import(pathToFileURL(file).href)) as { env: unknown };
    return getEnvCatalog(mod.env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Où poser la variable en production, dit à l'exploitant. */
const PLACEMENT_LABEL: Record<EnvVarPlacement, string> = {
  platform: "variables de la plateforme",
  secrets: "🔒 gestionnaire de secrets",
  workstation: "le poste seulement",
};

/**
 * Les noms courts de chaque paquet `@nodefony/*` du dépôt qui déclare un schéma.
 *
 * Le paquet DÉCLARE son schéma (`nodefony.configSchema`, un fichier de `dist/`),
 * comme le lit `nodefony env` dans une application. On en lit la SOURCE
 * correspondante : au moment d'un commit, le `dist/` peut être plus ancien que
 * le schéma qu'on commite, et la page décrirait l'état d'avant. Une source
 * introuvable lève en la nommant — une page muette sur un module serait fausse
 * sans que rien ne le dise.
 *
 * @returns les raccourcis, groupés par module, modules triés par nom.
 */
async function readRepositoryShortcuts(): Promise<IModuleShortcut[]> {
  const scope = path.join(ROOT, "src", "packages", "@nodefony");
  const out: IModuleShortcut[] = [];
  for (const dir of readdirSync(scope).sort()) {
    const packageDir = path.join(scope, dir);
    const declared = declaredPackageEntry(packageDir, CONFIG_SCHEMA_FIELD);
    if (declared === null) continue;
    const source = path.join(
      packageDir,
      ...declared
        .replace(/^\.\/dist\//u, "")
        .replace(/\.js$/u, ".ts")
        .split("/"),
    );
    if (!existsSync(source)) {
      throw new Error(
        `@nodefony/${dir} déclare ${declared}, mais sa source ${path.relative(ROOT, source)} est introuvable`,
      );
    }
    const mod = (await import(pathToFileURL(source).href)) as Record<
      string,
      unknown
    >;
    const exportName = CONFIG_SCHEMA_EXPORT;
    const producer = mod[exportName];
    if (typeof producer !== "function") {
      throw new Error(
        `${path.relative(ROOT, source)} n'exporte pas ${exportName}()`,
      );
    }
    for (const s of collectEnvShortcuts((producer as () => unknown)())) {
      out.push({ ...s, module: `@nodefony/${dir}` });
    }
  }
  return out;
}

/**
 * Une cellule de tableau Markdown : sur une ligne, sans barre verticale nue,
 * et sans `<…>` qu'un moteur prendrait pour une balise — hors des segments de
 * code, où l'échappement s'afficherait tel quel.
 */
function cell(text: string): string {
  return text
    .replace(/\s*\n\s*/gu, " ")
    .replace(/\|/gu, "\\|")
    .split("`")
    .map((part, i) => (i % 2 === 0 ? part.replace(/</gu, "\\<") : part))
    .join("`");
}

/** Où la poser, depuis la règle de la notice (`envVarPlacement`). */
function placementOf(v: NamedEnvVarMeta): string {
  return PLACEMENT_LABEL[envVarPlacement(v)];
}

/** Quand l'absence de la variable est une erreur, depuis la règle de la notice. */
function requirementOf(v: NamedEnvVarMeta): string {
  if (isEnvVarRequired(v)) return "toujours";
  const when: string[] = [];
  if (v.requiredIn?.length) when.push(`en ${v.requiredIn.join(", ")}`);
  if (v.requiredWhen) when.push(v.requiredWhen);
  return when.length > 0 ? cell(when.join(" ; ")) : "non";
}

/** Le tableau des réglages du framework d'une section. */
function frameworkTable(vars: readonly NamedEnvVarMeta[]): string[] {
  return [
    "| Variable | Rôle | Absente ⇒ | Où la poser |",
    "| --- | --- | --- | --- |",
    ...vars.map(
      (v) =>
        `| \`${v.name}\` | ${cell(v.description ?? v.title ?? "")} | ${cell(envVarDefaultText(v))} | ${placementOf(v)} |`,
    ),
  ];
}

/** Les variables de l'application générée, une table par section du gabarit. */
function appTables(vars: readonly NamedEnvVarMeta[]): string[] {
  const out: string[] = [];
  const sections = [...new Set(vars.map((v) => v.section ?? "Divers"))];
  for (const section of sections) {
    out.push(
      `### ${section}`,
      "",
      "| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const v of vars) {
      if ((v.section ?? "Divers") !== section) continue;
      out.push(
        `| \`${v.name}\` | ${cell(v.description ?? v.title ?? "")} | ${requirementOf(v)} | ${cell(envVarDefaultText(v))} | ${placementOf(v)} |`,
      );
    }
    out.push("");
  }
  return out;
}

/**
 * Rend la page entière.
 *
 * @param generatedBy - le script qui écrit la page, nommé dans son frontmatter.
 * @returns le Markdown de la page, prêt à écrire.
 */
export async function renderEnvReference(generatedBy: string): Promise<string> {
  const app = await readAppTemplateCatalog();
  // La règle de la notice (`composeEnvExample`) : une variable que
  // l'application redéclare garde SA déclaration, elle n'est pas listée deux fois.
  const declared = new Set(app.map((v) => v.name));
  const framework = frameworkEnvCatalog(null).filter(
    (v) => !declared.has(v.name),
  );
  const deployment = framework.filter((v) => v.placement !== "workstation");
  const workstation = framework.filter((v) => v.placement === "workstation");
  const shortcuts = (await readRepositoryShortcuts()).filter(
    (s) => !declared.has(s.env),
  );
  const fromModules = moduleShortcutsCatalog(shortcuts);
  const modules = [...new Set(shortcuts.map((s) => s.module))];

  const L: string[] = [
    "---",
    'title: "Variables d\'environnement — la référence"',
    "navTitle: Variables d'environnement",
    "lang: fr",
    "module: global",
    "topic: environment-variables",
    "audience: [devops, developer]",
    "status: stable",
    `generated: ${generatedBy}`,
    "source: src/nodefony/src/config/reservedEnv.ts",
    "---",
    "",
    `<!-- GÉNÉRÉ par ${generatedBy} (npm run env:snapshot).`,
    "     NE PAS ÉDITER À LA MAIN : corriger une variable de l'application dans",
    "     src/nodefony/templates/app/base/env.ts.tpl, un réglage du framework dans",
    "     src/nodefony/src/config/reservedEnv.ts, un réglage de module dans le",
    "     schéma de sa configuration (.meta({ env })), puis régénérer. -->",
    "",
    "# Variables d'environnement — la référence",
    "",
    "📍 [Documentation](../index.md) › [Guides](README.md) › **Variables d'environnement**",
    "",
    "> Cette page liste les variables d'environnement d'une application Nodefony,",
    "> et surtout **ce qui se passe quand l'une d'elles manque**. C'est la",
    "> question utile : une variable absente ne fait presque jamais échouer le",
    "> démarrage. Le framework applique alors un défaut, et ce défaut est celui",
    "> que tu vas obtenir en production si tu oublies de la poser.",
    "",
    "Elle est générée depuis le code, comme la notice `.env.example` de chaque",
    "application : les deux ne peuvent pas se contredire.",
    "",
    "## La commande qui fait foi pour TON application",
    "",
    "Les variables d'une application vivent dans son `env.ts`. Cette page montre",
    `celles d'une application tout juste générée (\`npx nodefony create app ${SAMPLE_APP}\`,`,
    "préréglage complet) : la tienne en a peut-être ajouté, ou retiré, et un",
    "préréglage minimal en déclare moins. Pour savoir exactement ce qu'elle lit,",
    "demande-le-lui :",
    "",
    "```bash",
    "npx nodefony env             # chaque variable, sa valeur effective et d'où elle vient",
    "npx nodefony env --example   # réécrit la notice .env.example de l'application",
    "```",
    "",
    "`nodefony env` ne démarre pas l'application : il répond même quand elle ne",
    "démarre plus, et il masque les secrets. Il sort en `78` si une variable",
    "requise manque.",
    "",
    "La colonne « Où la poser » dit à qui confier la valeur en production : les",
    "**variables de la plateforme** (le manifeste de déploiement, un `ConfigMap`),",
    "le **gestionnaire de secrets** (un `Secret` Kubernetes, un coffre), ou le",
    "**poste seulement** — un réglage de développement ou de diagnostic, qui n'a",
    "rien à faire dans un déploiement.",
    "",
    `## Ce que déclare une application générée (${app.length})`,
    "",
    "Le nom de l'application (`" +
      SAMPLE_APP +
      "`) paraît dans certains exemples : c'est le tien qui",
    "les remplace. La colonne « Exigée » dit quand l'absence arrête le démarrage.",
    "",
    ...appTables(app),
    `## Réglages du framework : déploiement (${deployment.length})`,
    "",
    "Lus par le cœur, quelle que soit l'application.",
    "",
    ...frameworkTable(deployment),
    "",
    `## Réglages du framework : poste et diagnostic (${workstation.length})`,
    "",
    "Utiles sur le poste du développeur ou pour une mesure ponctuelle.",
    "",
    ...frameworkTable(workstation),
    "",
    `## Réglages des modules (${fromModules.length})`,
    "",
    "Chaque module peut donner un nom court à un réglage de sa configuration.",
    "La variable n'est lue que si l'application charge le module. Sa valeur est",
    "validée par le schéma du module : une valeur invalide arrête le démarrage",
    "en nommant la variable. Chacune accepte aussi la forme `<NOM>_FILE`, qui",
    "désigne un fichier dont le contenu est la valeur (un secret monté).",
    "",
    "Absente, la variable laisse le réglage à sa valeur de configuration, et à",
    "défaut au **défaut du schéma**. « aucun » signifie que le module calcule la",
    "valeur lui-même ou s'en passe : la colonne « Rôle » dit lequel.",
    "",
  ];
  for (const name of modules) {
    L.push(
      `### \`${name}\``,
      "",
      "| Variable | Réglage | Rôle | Défaut du schéma | Où la poser |",
      "| --- | --- | --- | --- | --- |",
    );
    shortcuts.forEach((s, i) => {
      if (s.module !== name) return;
      const v = fromModules[i] as NamedEnvVarMeta;
      L.push(
        `| \`${v.name}\` | \`${s.path.join(".")}\` | ${cell(v.description ?? "")} | ${cell(envVarDefaultText(v))} | ${placementOf(v)} |`,
      );
    });
    L.push("");
  }
  L.push(
    "## Ce que cette page ne liste pas",
    "",
    "- **Les variables que ton application a ajoutées** à son `env.ts` :",
    "  `npx nodefony env` les rend, et la notice `.env.example` les explique une",
    "  par une. Le guide [Configuration](configuration.md) montre comment en",
    "  déclarer une.",
    "- **La surcharge générique** `NF__<MODULE>__<CHEMIN>` : elle atteint",
    "  n'importe quel réglage d'un module, sans nom court. Voir le guide",
    "  [Configuration](configuration.md).",
    "- **Les variables qui ne sont pas à Nodefony**, comme `NODE_ENV`, qui se",
    "  lisent sous leur propre nom. Toute variable que Nodefony possède porte le",
    "  préfixe `NF_`, pour ne jamais entrer en collision avec celles d'un autre",
    "  outil.",
    "",
    "## Pour aller plus loin",
    "",
    "- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)",
    "- ☸️ [Kubernetes](kubernetes.md) — où ces variables se posent dans un déploiement.",
    "- 🗄️ [Persistance](persistence.md) — les URL des bases et des services de données.",
    "",
  );
  return L.join("\n");
}
