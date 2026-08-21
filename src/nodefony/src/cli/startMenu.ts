/**
 * Composition PURE du menu interactif `nodefony menu` — même patron que
 * `envReport`/`cardReport`/`aiSyncReport` : ce fichier reçoit l'état (contexte,
 * descriptions, commandes de module) et rend une structure neutre ; l'adaptateur
 * (`MenuCommand`) la traduit en prompts inquirer. Zéro I/O, zéro import lourd :
 * testable sans TTY et sans kernel.
 *
 * Deux règles tiennent ce menu :
 * - le RÉSUMÉ d'une entrée vient de `command.description()` (source unique,
 *   celle de `--help`) — jamais d'une copie locale qui divergerait ;
 * - le menu n'ajoute que ce qui n'existe nulle part ailleurs : le CONSEIL
 *   d'usage (`when`), affiché sous la liste pendant la navigation.
 *
 * Une commande absente de commander (retirée, renommée) sort du menu toute
 * seule : `describe()` rend `null` et l'entrée n'est pas émise.
 */

/** Contexte de lancement : dans un projet Nodefony, ou hors de tout projet. */
export type StartMenuContext = "project" | "outside";

/**
 * Item neutre du menu — champs BRUTS, aucun rendu. L'adaptateur compose
 * l'affichage (alignement, couleurs, troncature à la largeur du terminal) :
 * la composition décide QUOI montrer, jamais COMMENT.
 */
export type StartMenuItem =
  | { kind: "separator"; label: string }
  | {
      kind: "choice";
      /** Ce que l'utilisateur choisit (colonne de gauche). */
      label: string;
      /** Résumé court (colonne de droite, tronquable). */
      summary: string;
      value: string;
      /** Conseil d'usage, affiché sous la liste pendant la navigation. */
      description: string;
    };

/** Une commande de module lue du manifest cache de complétion. */
export interface IStartMenuModuleCommand {
  name: string;
  description: string;
}

export interface IStartMenuInput {
  /** Vrai si une application Nodefony est résolue ici (`kernel.trunk`). */
  inProject: boolean;
  /**
   * Résumé d'une commande — `command.description()` de commander, ou `null`
   * si la commande n'est pas enregistrée (elle est alors écartée du menu).
   */
  describe: (name: string) => string | null;
  /**
   * Commandes de MODULE (`security:user:add`, …) lues du manifest cache de
   * complétion — elles ne sont pas encore posées dans commander à `onStart`
   * (dispatch différé), mais le cache écrit au dernier boot dev les connaît.
   */
  moduleCommands?: IStartMenuModuleCommand[];
  /**
   * Noms des scripts présents dans le `package.json` du projet. Le menu n'en
   * propose que ceux de son catalogue (`NPM_SCRIPT_CATALOG`) : les gestes
   * qualité et infra qu'aucune commande nodefony ne porte. Un script absent
   * du package.json n'est pas proposé — la présence fait foi, jamais le
   * catalogue seul.
   */
  npmScripts?: string[];
  /** Nom du projet, pour le message d'accueil. */
  projectName?: string;
}

interface ICatalogEntry {
  value: string;
  contexts: StartMenuContext[];
  /** Titre de groupe, par contexte (un même geste change de sens hors projet). */
  group: Record<StartMenuContext, string | null>;
  /** Le CONSEIL d'usage — la seule prose qui n'existe pas déjà ailleurs. */
  when: string;
}

/**
 * Catalogue déclaratif du menu. L'ordre du tableau EST l'ordre d'affichage,
 * groupe par groupe. Ajouter une commande au menu = une entrée ici, rien
 * d'autre (le résumé et la disponibilité viennent de commander).
 */
export const START_MENU_CATALOG: readonly ICatalogEntry[] = [
  // ── Serveur ──────────────────────────────────────────────────────────────
  {
    value: "development",
    contexts: ["project"],
    group: { project: "Serveur", outside: null },
    when: "Pour coder : rechargement automatique à chaque sauvegarde, HMR côté front. Ctrl+C pour arrêter.",
  },
  {
    value: "production",
    contexts: ["project"],
    group: { project: "Serveur", outside: null },
    when: "Le mode des conteneurs et des pods : premier plan, logs sur la sortie standard, arrêt gracieux sur SIGTERM.",
  },
  {
    value: "cluster",
    contexts: ["project"],
    group: { project: "Serveur", outside: null },
    when: "Plusieurs workers isolés sur une même machine (bare-metal/VPS) — relance automatique d'un worker tombé.",
  },
  {
    value: "status",
    contexts: ["project", "outside"],
    group: { project: "Serveur", outside: "Machine" },
    when: "Qu'est-ce qui tourne ici ? Superviseur, serveurs, Vite, ports occupés — sans rien démarrer.",
  },
  {
    value: "stop",
    contexts: ["project", "outside"],
    group: { project: "Serveur", outside: "Machine" },
    when: "Arrête proprement tout runtime Nodefony de la machine (dev, prod, cluster) — remplace le pkill -9.",
  },
  // ── Comprendre ───────────────────────────────────────────────────────────
  {
    value: "check",
    contexts: ["project"],
    group: { project: "Comprendre", outside: null },
    when: "Diagnostic statique : marche même quand l'app ne démarre plus, et rapporte le bilan du dernier boot.",
  },
  {
    value: "inspect",
    contexts: ["project"],
    group: { project: "Comprendre", outside: null },
    when: "L'état RÉEL de l'app — ce qui est monté, pas ce que le code laisse croire. Sans ouvrir de port.",
  },
  {
    value: "env",
    contexts: ["project"],
    group: { project: "Comprendre", outside: null },
    when: "Chaque variable : sa valeur effective, le fichier .env qui l'a posée, et celles qui sont masquées ou inconnues.",
  },
  {
    value: "card",
    contexts: ["project"],
    group: { project: "Comprendre", outside: null },
    when: "La carte de visite : modules installés, où aller (docs, console d'admin), quoi lancer. Le point de départ.",
  },
  // ── Faire évoluer / Démarrer ─────────────────────────────────────────────
  {
    value: "create",
    contexts: ["project", "outside"],
    group: { project: "Faire évoluer", outside: "Démarrer" },
    when: "Le wizard pose les questions puis génère un code conforme : ne rien écrire à la main qu'un générateur produit.",
  },
  {
    value: "build",
    contexts: ["project"],
    group: { project: "Faire évoluer", outside: null },
    when: "Compile modules puis application. Le runtime charge dist/ : une route neuve n'existe qu'après ce geste.",
  },
  {
    value: "install",
    contexts: ["project"],
    group: { project: "Faire évoluer", outside: null },
    when: "Installe les dépendances puis construit — le geste après un clone ou un changement de dépendances.",
  },
  {
    value: "outdated",
    contexts: ["project"],
    group: { project: "Faire évoluer", outside: null },
    when: "Les dépendances en retard, agrégées par paquet — distingue une plage épinglée d'un simple npm update.",
  },
  // ── Outillage ────────────────────────────────────────────────────────────
  {
    value: "git:hooks",
    contexts: ["project"],
    group: { project: "Outillage", outside: null },
    when: "Pose .githooks/ (pre-commit léger, pre-push verify) via git config natif — zéro dépendance, geste explicite.",
  },
  {
    value: "ai:sync",
    contexts: ["project"],
    group: { project: "Outillage", outside: null },
    when: "Pose les pointeurs vers les skills d'agent livrés par les paquets installés — à rejouer après un npm update.",
  },
  {
    value: "completion",
    contexts: ["project", "outside"],
    group: { project: "Outillage", outside: "Machine" },
    when: "La complétion shell (bash, zsh, fish) : commandes, options et arguments au TAB.",
  },
];

/** Groupes, dans l'ordre d'affichage, par contexte. */
const GROUP_ORDER: Record<StartMenuContext, readonly string[]> = {
  project: ["Serveur", "Comprendre", "Faire évoluer", "Outillage"],
  outside: ["Démarrer", "Machine"],
};

/**
 * Scripts npm que le menu sait proposer — les gestes qu'AUCUNE commande
 * nodefony ne porte (qualité, infra docker). Un script n'apparaît que s'il
 * existe dans le package.json du projet (`npmScripts`). La valeur émise est
 * préfixée `npm:` — l'adaptateur la déplie en `npm run <script>`.
 */
export const NPM_SCRIPT_CATALOG: readonly {
  script: string;
  /** Résumé court (colonne de droite) — le geste, pas le pourquoi. */
  summary: string;
  group: string;
  when: string;
}[] = [
  {
    script: "verify",
    summary: "typecheck + lint + tests + check",
    group: "Qualité (npm run)",
    when: "LA passe avant de dire « fait » : typecheck + lint + tests + check, dans cet ordre. Les tests seuls ne typecheckent rien.",
  },
  {
    script: "test",
    summary: "tests unitaires (vitest)",
    group: "Qualité (npm run)",
    when: "Les tests unitaires du projet (vitest). Rapides — le boot réel vit dans test:e2e.",
  },
  {
    script: "test:e2e",
    summary: "build + boot réel + HTTP/WS",
    group: "Qualité (npm run)",
    when: "Le gate LENT : build, boot réel, HTTP/WS de bout en bout. À jouer avant de livrer, pas à chaque sauvegarde.",
  },
  {
    script: "lint",
    summary: "style et pièges (oxlint)",
    group: "Qualité (npm run)",
    when: "Style et pièges (oxlint) — ce que ni le compilateur ni les tests ne voient.",
  },
  {
    script: "format",
    summary: "reformate tout (prettier)",
    group: "Qualité (npm run)",
    when: "Reformate tout le projet (prettier --write).",
  },
  {
    script: "infra:up",
    summary: "docker compose up -d",
    group: "Infra (docker)",
    when: "Démarre les conteneurs déclarés par le projet (base SQL, redis…) — à lancer AVANT le serveur s'ils sont requis.",
  },
  {
    script: "infra:down",
    summary: "docker compose down",
    group: "Infra (docker)",
    when: "Arrête et retire les conteneurs du projet.",
  },
];

/** Préfixe des valeurs « script npm » émises par le menu. */
export const NPM_SCRIPT_PREFIX = "npm:";

/** Titre du groupe des commandes de module (projet seulement). */
export const MODULE_COMMANDS_GROUP = "Commandes du projet";

/** Ce que le menu doit FAIRE d'un choix — décidé ici, exécuté par l'adaptateur. */
export type MenuAction =
  /** Script du projet : `npm run <script>`, sortie héritée. */
  | { kind: "npm"; script: string }
  /** Commande intégrée : commander la connaît, on l'exécute dans CE process. */
  | { kind: "inline"; argv: string[] }
  /** Commande de MODULE : elle exige un process neuf (voir ci-dessous). */
  | { kind: "respawn"; argv: string[] };

/**
 * Le plan d'exécution d'un choix de menu.
 *
 * ⚠️ **Une commande de MODULE ne peut pas s'exécuter dans le process du menu.**
 * Le menu s'ouvre à `onStart` pour rester instantané ; à cette phase, les
 * commandes de module ne sont pas encore posées dans commander (elles le sont à
 * `onPreRegister`, par le dispatch différé). Les exécuter par le re-parse
 * commander donnait donc `unknown command 'http:network'` + CRITIC + exit 1 —
 * un menu qui PROPOSE un geste puis le refuse. Elles se relancent dans un
 * process neuf, exactement comme le menu le fait déjà pour un script npm : le
 * boot complet a lieu, le dispatch différé fait son travail.
 *
 * La décision vit ici, PURE, parce qu'elle se teste : l'adaptateur ne fait plus
 * que `spawnSync` ou appeler commander, gestes qu'aucun test unitaire n'observe.
 *
 * @param response - la valeur choisie dans le menu.
 * @param isBuiltin - commander connaît-il cette commande à cet instant ?
 */
export function planMenuAction(
  response: string,
  isBuiltin: (name: string) => boolean,
): MenuAction {
  if (response.startsWith(NPM_SCRIPT_PREFIX)) {
    return { kind: "npm", script: response.slice(NPM_SCRIPT_PREFIX.length) };
  }
  const argv = response.split(" ").filter(Boolean);
  // Le premier mot porte l'identité de la commande ; « inspect routes » reste
  // une intégrée à argument.
  return isBuiltin(argv[0] ?? "")
    ? { kind: "inline", argv }
    : { kind: "respawn", argv };
}

function choice(value: string, summary: string, when: string): StartMenuItem {
  return { kind: "choice", label: value, summary, value, description: when };
}

/**
 * Construit le menu principal pour un contexte donné.
 *
 * @returns message d'accueil + items ordonnés (separators de groupe inclus).
 */
export function buildStartMenu(input: IStartMenuInput): {
  message: string;
  items: StartMenuItem[];
} {
  const context: StartMenuContext = input.inProject ? "project" : "outside";
  const items: StartMenuItem[] = [];
  for (const groupTitle of GROUP_ORDER[context]) {
    const entries = START_MENU_CATALOG.filter(
      (e) => e.contexts.includes(context) && e.group[context] === groupTitle,
    );
    const rendered: StartMenuItem[] = [];
    for (const entry of entries) {
      const summary = input.describe(entry.value);
      if (summary === null) {
        continue; // commande retirée du CLI → sortie du menu, sans erreur
      }
      rendered.push(choice(entry.value, summary, entry.when));
    }
    if (rendered.length > 0) {
      items.push({ kind: "separator", label: groupTitle });
      items.push(...rendered);
    }
  }
  if (context === "project" && input.npmScripts?.length) {
    const available = new Set(input.npmScripts);
    const byGroup = new Map<string, StartMenuItem[]>();
    for (const entry of NPM_SCRIPT_CATALOG) {
      if (!available.has(entry.script)) {
        continue;
      }
      const item: StartMenuItem = {
        kind: "choice",
        label: entry.script,
        summary: entry.summary,
        value: `${NPM_SCRIPT_PREFIX}${entry.script}`,
        description: entry.when,
      };
      const bucket = byGroup.get(entry.group);
      if (bucket) {
        bucket.push(item);
      } else {
        byGroup.set(entry.group, [item]);
      }
    }
    for (const [groupTitle, groupItems] of byGroup) {
      items.push({ kind: "separator", label: groupTitle });
      items.push(...groupItems);
    }
  }
  if (context === "project") {
    if (input.moduleCommands?.length) {
      items.push({ kind: "separator", label: MODULE_COMMANDS_GROUP });
      for (const mc of input.moduleCommands) {
        items.push({
          kind: "choice",
          label: mc.name,
          summary: mc.description,
          value: mc.name,
          description:
            "Commande apportée par un module de cette application (relue du dernier démarrage dev).",
        });
      }
    }
  }
  // 🔴 **Une absence s'ÉNONCE — elle ne se laisse pas deviner.** Le menu s'ouvre
  // à `onStart`, trop tôt pour que commander connaisse les commandes de MODULE
  // (dispatch différé) : il les relit d'un cache qu'un boot précédent a écrit.
  // Ce cache n'existe pas encore sur un dépôt neuf, après un `npm ci`, ou si
  // `node_modules` a été nettoyé — et le groupe disparaissait alors ENTIER, sans
  // un mot. `http:network`, `frontend:build`, `security:user:add`,
  // `proxy:generate`… toutes bien réelles, toutes invisibles, sur un menu qui
  // avait l'air complet : se taire ici fait croire que le CLI se limite à ça.
  //
  // Le mot va dans le MESSAGE et non dans un séparateur, parce qu'un séparateur
  // sans entrée sous lui est précisément ce que ce menu s'interdit (un test le
  // fige). Hors projet, aucune commande de module n'est attendue : rien à dire.
  const manque = input.inProject && !input.moduleCommands?.length;
  const message = input.inProject
    ? `${input.projectName ?? "Projet Nodefony"} — que veux-tu faire ?${
        manque
          ? " (commandes des modules non listées : l'app n'a pas encore démarré ici — `nodefony --help` les montre toutes)"
          : ""
      }`
    : "Aucun projet Nodefony ici — que veux-tu faire ?";
  return { message, items };
}

/**
 * Sous-menu des sujets d'`inspect`, dérivé de la table SOURCE
 * (`INSPECT_SUBJECTS`) : seuls les sujets SANS argument obligatoire sont
 * proposés (un sujet à paramètre exigerait une saisie de plus — il reste
 * accessible en ligne de commande, l'aide d'`inspect` les liste).
 *
 * @param subjects - la table `INSPECT_SUBJECTS` (injectée : ce fichier reste pur).
 */
export function buildInspectMenu(
  subjects: Record<string, { summary: string; param?: string }>,
): { message: string; items: StartMenuItem[] } {
  const items: StartMenuItem[] = [];
  for (const [name, subject] of Object.entries(subjects)) {
    if (subject.param) {
      continue;
    }
    items.push({
      kind: "choice",
      label: name,
      summary: subject.summary,
      value: name,
      description: `nodefony inspect ${name} — même donnée que la console d'admin, redaction des secrets comprise.`,
    });
  }
  return { message: "Inspecter quoi ?", items };
}

/**
 * Filtre le menu à la frappe (prompt `search`) — la logique est ICI, pure et
 * testée : normalisation (minuscules, accents retirés), chaque MOT du terme
 * doit se retrouver dans le label, le résumé, le conseil OU le titre du groupe
 * de l'entrée. Les titres de groupe suivent leurs entrées : un groupe dont
 * rien ne survit disparaît AVEC son titre.
 */
export function filterStartMenu(
  items: StartMenuItem[],
  term: string,
): StartMenuItem[] {
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  const words = normalize(term).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return items;
  }
  const kept: StartMenuItem[] = [];
  let pendingGroup: StartMenuItem | null = null;
  let currentGroupLabel = "";
  for (const item of items) {
    if (item.kind === "separator") {
      pendingGroup = item;
      currentGroupLabel = item.label;
      continue;
    }
    const haystack = normalize(
      `${item.label} ${item.summary} ${item.description} ${currentGroupLabel}`,
    );
    if (words.every((w) => haystack.includes(w))) {
      if (pendingGroup) {
        kept.push(pendingGroup);
        pendingGroup = null;
      }
      kept.push(item);
    }
  }
  return kept;
}
