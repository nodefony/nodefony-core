/**
 * Le rapport de `nodefony doctor` tel qu'un HUMAIN le lit — rendu PUR.
 *
 * Ce module ne connaît ni le terminal, ni l'horloge, ni l'environnement : la
 * largeur, la couleur et l'instant lui sont DONNÉS, et il rend des lignes. Deux
 * raisons, et la seconde est la vraie.
 *
 * 1. Il devient éprouvable ailleurs que dans le terminal où il tourne —
 *    c'est-à-dire en intégration continue, où il n'y en a pas.
 * 2. Un rapport qui s'écrit au fil de l'eau ne peut pas se relire lui-même :
 *    impossible d'aligner une colonne sur le plus long titre, de regrouper deux
 *    contrôles qui partagent une raison, ou de compter ce qu'on vient d'écrire.
 *    Le rendu produit donc le document ENTIER avant qu'un seul octet ne sorte.
 *
 * ## Ce que la forme doit au lecteur
 *
 * Un diagnostic se lit en panne, souvent vite, parfois par quelqu'un qui ne
 * connaît pas le projet. Il répond donc dans cet ordre : **où** l'on regarde,
 * **l'état de chaque famille** d'un coup d'œil, le **détail** de ce qui ne va
 * pas, ce qui n'a **pas pu être regardé**, puis un bilan chiffré. Rien d'autre :
 * ce qui va bien ne se commente pas, et le bruit finit par masquer le signal.
 */
import path from "node:path";
import {
  accord,
  controlesSautes,
  countFindings,
  creerPalette,
  FAMILLES,
  COUNTED_FAMILIES,
  filet,
  ligneSommaire,
  replier,
  separerGeste,
  surlignerCode,
  symbole,
  TITRES,
  type CheckFamily,
  type EtatSection,
  type IControleSaute,
  type ILigneSommaire,
  type IPalette,
} from "./report";
import { formatAge, lastBootFileFor, type ILastBoot } from "./lastBoot";
// Type SEUL : élidé à la compilation, donc aucune arête d'import à l'exécution
// entre la collecte et son rendu.
import type { ICheckReport } from "./runCheck";
import type { ILiveFinding } from "./live";

/** Le décor du rendu — tout ce que ce module refuse d'aller chercher lui-même. */
export interface IOptionsRendu {
  /** Largeur utile, déjà bornée. */
  largeur: number;
  /** `true` pour émettre des séquences ANSI. */
  couleur: boolean;
  /** Instant de référence, pour l'âge du dernier démarrage. */
  now: number;
  /** Le dossier d'où la commande a été lancée, s'il diffère de la racine. */
  lanceDepuis?: string;
  /** `true` si un contrôle sauté fait échouer la commande. */
  strict: boolean;
}

/** L'indentation du corps, alignée sous le titre des lignes à puce. */
const CORPS = "     ";

/**
 * Un bilan de démarrage mérite d'être rapporté quand il porte une MAUVAISE
 * nouvelle.
 *
 * Un démarrage abouti, complet et sans brique manquante ne se commente pas :
 * l'afficher à chaque contrôle serait du bruit. Les avertissements seuls ne
 * suffisent pas non plus à déclencher — un boot de développement en produit
 * régulièrement.
 *
 * @param entry - le bilan lu.
 * @returns `true` s'il y a quelque chose à dire.
 */
export function meriteDEtreDit(entry: ILastBoot): boolean {
  return (
    entry.status === "failed" ||
    entry.healthy === false ||
    Boolean(entry.bricksSkipped?.length) ||
    Boolean(entry.errors)
  );
}

/**
 * Regroupe les contrôles sautés qui partagent la MÊME raison.
 *
 * Hors d'une application, quatre familles sont sautées pour un seul et même
 * motif. Les énumérer une par une répète quatre fois la même phrase et le même
 * geste : le lecteur croit à quatre problèmes distincts et cesse de lire avant
 * la fin. Une seule entrée, quatre titres, un geste.
 *
 * @param sautes - les contrôles sautés, dans l'ordre de lecture.
 * @returns un groupe par raison distincte, l'ordre du premier membre conservé.
 */
export function grouperParRaison(
  sautes: readonly IControleSaute[],
): { titres: string[]; reason: string; unlock?: string }[] {
  const groupes: { titres: string[]; reason: string; unlock?: string }[] = [];
  for (const saute of sautes) {
    const existant = groupes.find(
      (g) => g.reason === saute.reason && g.unlock === saute.unlock,
    );
    if (existant) existant.titres.push(saute.titre);
    else
      groupes.push({
        titres: [saute.titre],
        reason: saute.reason,
        unlock: saute.unlock,
      });
  }
  return groupes;
}

/**
 * Le document complet, ligne par ligne, sans retour chariot final.
 *
 * @param report - le diagnostic collecté.
 * @param opts - le décor de rendu (largeur, couleur, instant).
 * @returns les lignes à écrire, dans l'ordre.
 */
export function rendreRapport(
  report: ICheckReport,
  opts: IOptionsRendu,
): string[] {
  const { largeur, couleur, now, strict } = opts;
  const p = creerPalette(couleur);
  const lignes: string[] = [];
  /** Écrit une phrase repliée sous une puce, avec sa teinte. */
  const corps = (texte: string, teinte: (t: string) => string): void => {
    for (const l of replier(texte, largeur, CORPS)) {
      lignes.push(teinte(surlignerCode(l, p, couleur)));
    }
  };

  lignes.push(...enTete(report, opts, p));
  lignes.push(...sommaire(report, p, largeur));

  const bilansParlants = report.lastBoots.filter(meriteDEtreDit);
  if (bilansParlants.length > 0) {
    // Une SECTION, comme les autres : sans filet ni titre, ce bloc flottait
    // entre le sommaire et le premier manquement, et se lisait comme une suite
    // du sommaire alors qu'il parle d'autre chose — d'une EXÉCUTION passée.
    lignes.push("", p.discret(filet(largeur)), "");
    lignes.push(
      `  ${p.fort(bilansParlants.length > 1 ? "DERNIERS DÉMARRAGES" : "DERNIER DÉMARRAGE")}`,
    );
    for (const demarrage of bilansParlants) {
      lignes.push("");
      lignes.push(...dernierDemarrage(demarrage, now, p, largeur));
    }
  }

  // ── Le détail, groupé et dans l'ordre de lecture des familles.
  for (const { titre, items } of groupesDeManquements(report)) {
    if (items.length === 0) continue;
    lignes.push("", p.discret(filet(largeur)), "");
    lignes.push(`  ${p.echec(p.fort(titre.toUpperCase()))}`);
    for (const item of items) {
      const { constat, geste } = separerGeste(item.message);
      lignes.push("");
      const [premiere, ...suite] = replier(constat, largeur, CORPS);
      // La puce reprend le symbole du sommaire : le lecteur retrouve d'un coup
      // d'œil la ligne qui l'a amené ici.
      lignes.push(
        p.echec(
          `  ${symbole("echec")}  ${surlignerCode((premiere ?? "").trimStart(), p, couleur)}`,
        ),
      );
      for (const l of suite) lignes.push(surlignerCode(l, p, couleur));
      if (item.file) lignes.push(p.discret(`${CORPS}${item.file}`));
      if (geste) corps(`→ ${geste}`, p.geste);
    }
  }

  const sautes = controlesSautes(report.execution);
  if (sautes.length > 0) {
    // SYSTÉMATIQUE, y compris quand tout le reste est vert : un diagnostic muet
    // sur son angle mort se lit comme un quitus.
    lignes.push("", p.discret(filet(largeur)), "");
    lignes.push(`  ${p.alerte(p.fort("NON CONTRÔLÉ"))}`);
    for (const groupe of grouperParRaison(sautes)) {
      lignes.push("");
      // Quatre titres joints font vite soixante colonnes : cette ligne se
      // replie comme n'importe quelle autre, sinon elle déborde exactement
      // dans le cas où elle a le plus à dire.
      const [premier, ...reste] = replier(
        groupe.titres.join(", "),
        largeur,
        CORPS,
      );
      lignes.push(
        p.alerte(
          `  ${symbole("non-controle")}  ${(premier ?? "").trimStart()}`,
        ),
      );
      for (const l of reste) lignes.push(p.alerte(l));
      corps(groupe.reason, p.alerte);
      if (groupe.unlock) corps(`→ ${groupe.unlock}`, p.geste);
    }
    if (strict) {
      lignes.push("");
      corps(
        "mode strict : un contrôle sauté fait échouer la commande.",
        p.discret,
      );
    }
  }

  lignes.push("", p.discret(filet(largeur)), "");
  lignes.push(...bilan(report, sautes, p, largeur));
  lignes.push("");
  return lignes;
}

/**
 * L'en-tête : QUI est ausculté.
 *
 * Un rapport qui porte sur un autre dossier que celui qu'on croit se lit de
 * travers, dans les deux sens — et c'est le cas normal, puisque la cible est
 * l'APPLICATION et non le dossier où l'on a tapé.
 */
function enTete(
  report: ICheckReport,
  opts: IOptionsRendu,
  p: IPalette,
): string[] {
  const lignes = ["", `  ${p.fort("nodefony doctor")}`];
  const nom = report.appName;
  if (nom) lignes[1] += p.discret(` · ${nom}`);
  lignes.push(p.discret(`  ${report.root}`));
  if (
    opts.lanceDepuis &&
    path.resolve(report.root) !== path.resolve(opts.lanceDepuis)
  ) {
    lignes.push(p.discret(`  lancé depuis ${opts.lanceDepuis}`));
  }
  lignes.push("");
  return lignes;
}

/**
 * Le sommaire : l'état de chaque famille, d'un coup d'œil.
 *
 * C'est ce qui répond à « y a-t-il un problème, et où ? » sans rien lire
 * d'autre. **L'état d'EXÉCUTION prime toujours sur les trouvailles** : un
 * contrôle qui n'a rien regardé n'a rien trouvé, et l'afficher en vert est le
 * seul mensonge que ce sommaire ne doit jamais dire.
 */
function sommaire(
  report: ICheckReport,
  p: IPalette,
  largeur: number,
): string[] {
  const { freshness, readiness, wiring, findings, scanned, execution } = report;
  const etat = (n: number): EtatSection => (n > 0 ? "echec" : "ok");
  const ligne = (
    famille: CheckFamily,
    n: number,
    detail: string,
  ): ILigneSommaire => {
    // Même garde que `controlesSautes` : un état absent se DIT, il ne se rend
    // pas en vert et ne fait pas lever le rapport.
    const exec = execution[famille] ?? { ran: false, short: "état absent" };
    return exec.ran
      ? { titre: TITRES[famille], etat: etat(n), detail }
      : {
          titre: TITRES[famille],
          etat: "non-controle",
          // Court ICI, complet dans la section dédiée : une raison tronquée
          // par un `…` cache justement ce qu'on aurait besoin de lire.
          detail: exec.short ?? "non contrôlé",
        };
  };
  const detail: Record<CheckFamily, { n: number; texte: string }> = {
    freshness: {
      n: freshness.findings.length,
      texte:
        freshness.findings.length > 0
          ? accord(freshness.findings.length, "écart")
          : "sources et build alignés",
    },
    readiness: {
      n: readiness.findings.length,
      texte:
        readiness.findings.length > 0
          ? accord(readiness.findings.length, "manquement")
          : "environnement, modules, ports",
    },
    // « Variables déclarées » est une RÈGLE de `readiness`, pas une famille à
    // part : elle n'apparaît que lorsqu'elle n'a pas pu jouer, sans quoi le
    // sommaire dirait deux fois la même chose.
    envCatalog: { n: 0, texte: "" },
    deps: {
      n: findings.length,
      texte:
        findings.length > 0
          ? `${accord(findings.length, "manquement")} sur ${accord(scanned, "paquet")}`
          : accord(scanned, "paquet"),
    },
    wiring: {
      n: wiring.findings.length,
      texte:
        wiring.findings.length > 0
          ? `${accord(wiring.findings.length, "manquement")} sur ${accord(wiring.scanned, "classe")}`
          : `${accord(wiring.scanned, "classe")} déclarée${wiring.scanned > 1 ? "s" : ""}`,
    },
    // Étage 2 : le compte vient des findings de CETTE famille, filtrés par leur
    // origine. Un manquement de migration ne doit pas grossir la ligne du
    // firewall — le sommaire perdrait sa seule vertu, dire OÙ regarder.
    migrations: {
      n: manquementsLive(report, "migrations-not-ok").length,
      texte:
        manquementsLive(report, "migrations-not-ok").length > 0
          ? accord(manquementsLive(report, "migrations-not-ok").length, "écart")
          : "schéma et historique alignés",
    },
    firewall: {
      n: manquementsLive(report, "firewall-config-invalid").length,
      texte:
        manquementsLive(report, "firewall-config-invalid").length > 0
          ? "configuration INVALIDE"
          : "zones et authentificateurs cohérents",
    },
  };
  // L'ordre est celui de FAMILLES, le MÊME que la section « non contrôlé » plus
  // bas : deux ordres différents pour les mêmes contrôles, et le lecteur cesse
  // de faire le lien entre le sommaire et le détail.
  const lignes: ILigneSommaire[] = FAMILLES.filter(
    (f) =>
      f !== "envCatalog" ||
      (!execution.envCatalog?.ran && execution.readiness?.ran === true),
  ).map((f) => ligne(f, detail[f].n, detail[f].texte));

  const largeurTitre = Math.max(...lignes.map((l) => l.titre.length));
  return lignes.map((l) => {
    const teinte =
      l.etat === "echec" ? p.echec : l.etat === "ok" ? p.ok : p.alerte;
    return teinte(ligneSommaire(l, largeurTitre, largeur));
  });
}

/**
 * Les manquements de l'étage 2 d'une espèce donnée.
 *
 * Le rapport porte UNE liste ; le sommaire et le détail la découpent par
 * famille. Filtrer ici plutôt que tenir deux listes évite qu'un jour l'une
 * contienne ce que l'autre ignore.
 *
 * @param report - le rapport, dont `live` peut être absent (aucun boot)
 * @param kind - l'espèce de manquement cherchée
 * @returns les manquements de cette espèce, vide si l'étage 2 n'a pas eu lieu
 */
function manquementsLive(
  report: ICheckReport,
  kind: ILiveFinding["kind"],
): ILiveFinding[] {
  return (report.live?.findings ?? []).filter((f) => f.kind === kind);
}

/** Les familles de manquements, dans l'ordre où elles se lisent. */
function groupesDeManquements(
  report: ICheckReport,
): { titre: string; items: { message: string; file?: string }[] }[] {
  // La fraîcheur d'abord : un build en retard rend faux tout ce qui suit — une
  // classe « non câblée » peut l'être dans le dist et pas dans les sources
  // qu'on vient d'éditer. Puis ce qui empêche de DÉMARRER : une variable
  // absente explique souvent le reste.
  return [
    { titre: TITRES.freshness, items: report.freshness.findings },
    { titre: TITRES.readiness, items: report.readiness.findings },
    { titre: TITRES.deps, items: report.findings },
    { titre: TITRES.wiring, items: report.wiring.findings },
    // L'étage 2 en dernier : il n'existe que sur une application qui a démarré,
    // et le geste qu'il propose vient du PRODUCTEUR — il est rendu tel quel,
    // sous le constat, parce qu'une commande à taper se copie.
    {
      titre: TITRES.migrations,
      items: manquementsLive(report, "migrations-not-ok").map((f) => ({
        message: f.action ? `${f.message}\n  → ${f.action}` : f.message,
      })),
    },
    {
      titre: TITRES.firewall,
      items: manquementsLive(report, "firewall-config-invalid").map((f) => ({
        message: f.message,
      })),
    },
  ];
}

/**
 * QUI a démarré, en toutes lettres.
 *
 * « Le dernier démarrage a ÉCHOUÉ » désignait le serveur quel que soit le
 * coupable : un `nodefony inspect` lancé sans son environnement produisait la
 * même phrase, et envoyait chercher là où il n'y a rien. Nommer le profil ET
 * la commande donne les deux choses qui manquaient — qui accuser, et quoi
 * relancer pour reproduire.
 *
 * @param entry - le bilan.
 * @returns « `nodefony inspect` (console) », ou « Le dernier démarrage ».
 */
export function qui(entry: ILastBoot): string {
  const profil =
    entry.profile === "console"
      ? "console"
      : entry.profile === "cluster"
        ? "maître de cluster"
        : entry.profile === "server"
          ? "serveur"
          : "";
  if (!entry.command && !profil) return "Le dernier démarrage";
  if (!entry.command) return `Le dernier démarrage (${profil})`;
  return `\`nodefony ${entry.command}\`${profil ? ` (${profil})` : ""}`;
}

/**
 * Le bilan du dernier démarrage, quand il a une mauvaise nouvelle à donner.
 *
 * Placé haut, parce que c'est l'information la plus utile de tout le rapport
 * quand elle existe : celui qui lance `doctor` sur une application qui ne
 * démarre plus cherche exactement ça, et la faire suivre une liste de
 * manquements de câblage reviendrait à la cacher.
 *
 * Il n'entre PAS dans le code de sortie : `doctor` contrôle le CODE, l'état
 * d'un démarrage est un fait d'exécution, souvent déjà réparé au moment où on
 * lit.
 */
function dernierDemarrage(
  entry: ILastBoot,
  now: number,
  p: IPalette,
  largeur: number,
): string[] {
  const lignes: string[] = [];
  const age = formatAge(entry.timestamp, now);
  const etat: EtatSection =
    entry.status === "failed" ? "echec" : "avertissement";
  /**
   * Un couple « libellé — valeur », la valeur repliée SOUS elle-même.
   *
   * Une cause de démarrage échoué fait couramment trois cents caractères
   * (message d'erreur, URL de connecteur, cause native). Laissée sur une seule
   * ligne, elle déborde le terminal et se replie sur la marge : la moitié du
   * message se retrouve alignée avec les libellés, et on ne distingue plus ce
   * qui est un champ de ce qui est du texte.
   */
  const champ = (nom: string, valeur: string): string[] => {
    // Assez large pour le PLUS LONG libellé (« briques ignorées », 16), plus
    // une colonne de respiration : en deçà, un libellé long colle sa valeur et
    // la colonne saute d'une ligne à l'autre.
    const colonne = 18;
    const indent = CORPS + " ".repeat(colonne);
    const lignesValeur = replier(valeur, largeur, indent);
    // Un chemin ou une URL ne se coupe PAS (le couper le rendrait incopiable).
    // Sur un terminal étroit, la colonne d'alignement ne laisse alors pas assez
    // de place : la valeur passe SOUS son libellé plutôt que de déborder.
    const deborde = lignesValeur.some((l) => l.length > largeur);
    if (deborde) {
      return [
        `${CORPS}${p.discret(nom)}`,
        ...replier(valeur, largeur, `${CORPS}  `),
      ];
    }
    const [premiere, ...suite] = lignesValeur;
    return [
      `${CORPS}${p.discret(nom.padEnd(colonne, " "))}${(premiere ?? "").trimStart()}`,
      ...suite,
    ];
  };

  /** Le titre du bloc, replié comme n'importe quelle autre phrase. */
  const titre = (texte: string, teinte: (t: string) => string): string[] => {
    const [premiere, ...suite] = replier(texte, largeur, CORPS);
    return [
      teinte(`  ${symbole(etat)}  ${(premiere ?? "").trimStart()}`),
      ...suite.map(teinte),
    ];
  };

  if (entry.status === "failed") {
    lignes.push(...titre(`${qui(entry)} a ÉCHOUÉ (${age})`, p.echec));
    lignes.push(...champ("phase atteinte", entry.phase ?? "inconnue"));
    lignes.push(...champ("environnement", entry.environment));
    if (entry.error) {
      lignes.push(
        ...champ("cause", `${entry.error.name}: ${entry.error.message}`),
      );
      if (entry.error.exitCode !== undefined) {
        lignes.push(...champ("code de sortie", String(entry.error.exitCode)));
      }
    }
  } else {
    // Le cas que personne ne diagnostique : ça DÉMARRE, donc ça a l'air sain.
    lignes.push(
      ...titre(
        `${qui(entry)} a abouti mais il MANQUE des briques (${age})`,
        p.alerte,
      ),
    );
    lignes.push(...champ("environnement", entry.environment));
    if (entry.healthy === false) {
      lignes.push(
        ...champ(
          "verdict",
          p.echec("un profil serveur a fini SANS aucun serveur en écoute"),
        ),
      );
    }
  }

  if (entry.bricksSkipped?.length) {
    lignes.push(
      ...champ("briques ignorées", String(entry.bricksSkipped.length)),
    );
    for (const b of entry.bricksSkipped) {
      lignes.push(
        `${CORPS}  · ${b.module}${b.phase ? p.discret(` (${b.phase})`) : ""} — ${b.reason}`,
      );
    }
  }
  if (entry.bricksGated?.length) {
    // VOLONTAIRE — mais un module écarté en silence se diagnostique comme un
    // module perdu, et on cherche longtemps un défaut qui n'existe pas.
    lignes.push(...champ("écartées exprès", String(entry.bricksGated.length)));
    for (const b of entry.bricksGated) {
      lignes.push(`${CORPS}  · ${b.module} — ${b.reason}`);
    }
  }
  if (entry.warnings || entry.errors) {
    lignes.push(
      ...champ(
        "journal du boot",
        `${accord(entry.warnings ?? 0, "avertissement")}, ${accord(entry.errors ?? 0, "erreur")}`,
      ),
    );
  }
  if (entry.criticals?.length) {
    // Le compte disait qu'il s'était passé quelque chose ; ceci dit QUOI.
    for (const message of entry.criticals) {
      // La suite s'aligne SOUS le texte, pas sous la puce : une deuxième ligne
      // rendue à la même colonne que le `·` se lit comme un deuxième message.
      const [premiere, ...suite] = replier(message, largeur, `${CORPS}    `);
      lignes.push(p.echec(`${CORPS}  · ${(premiere ?? "").trimStart()}`));
      for (const l of suite) lignes.push(p.echec(l));
    }
  }
  if (entry.remediation) {
    for (const l of replier(`→ ${entry.remediation}`, largeur, CORPS)) {
      lignes.push(p.geste(l));
    }
  }
  // SON fichier, pas celui du serveur : avec deux bilans affichés, un
  // chemin unique enverrait lire le mauvais.
  lignes.push(...champ("bilan complet", lastBootFileFor(entry.profile)));
  return lignes;
}

/**
 * La dernière ligne — celle qu'on retient.
 *
 * Elle doit rester VRAIE dans les trois situations, y compris la plus piégeuse :
 * quand aucun contrôle n'a pu tourner. « Rien à signaler · 0 contrôle passé »
 * s'y lisait comme un succès alors que rien n'avait été regardé.
 */
function bilan(
  report: ICheckReport,
  sautes: readonly IControleSaute[],
  p: IPalette,
  largeur: number,
): string[] {
  // ⚠️ La MÊME fonction que le code de sortie et que le serveur MCP. Recompter
  // ici a produit un bilan qui contredisait le sommaire juste au-dessus.
  const total = countFindings(report);
  const passes = nombreDeControlesPasses(report);

  /**
   * Un segment du bilan : ce qu'il MESURE, et ce qui s'AFFICHE.
   *
   * Les deux diffèrent dès qu'il y a de la couleur — une séquence ANSI compte
   * pour zéro colonne mais pour plusieurs caractères. Mesurer la version peinte
   * ferait passer une ligne courte pour trop longue, et l'inverse.
   */
  const seg = (texte: string, teinte: (t: string) => string) => ({
    mesure: texte,
    peint: teinte(texte),
  });

  const segments: { mesure: string; peint: string }[] = [];
  if (total > 0) {
    segments.push(seg(accord(total, "manquement"), p.echec));
    segments.push(
      seg(accord(passes, "contrôle passé", "contrôles passés"), (t) => t),
    );
  } else if (passes === 0) {
    // Hors d'une application : dire « rien à signaler » serait un quitus rendu
    // sans avoir rien ouvert.
    segments.push(seg("Aucun contrôle n'a pu être fait ici", p.alerte));
  } else {
    const exceptions =
      report.exceptions > 0
        ? ` (${accord(report.exceptions, "exception")} déclarée${report.exceptions > 1 ? "s" : ""})`
        : "";
    const phrase =
      sautes.length > 0
        ? `Rien à signaler parmi les ${accord(passes, "contrôle effectué", "contrôles effectués")}`
        : `Rien à signaler sur ${accord(passes, "contrôle", "contrôles")}`;
    segments.push({
      mesure: phrase + exceptions,
      peint: p.ok(phrase) + p.discret(exceptions),
    });
  }
  if (sautes.length > 0) {
    segments.push(
      seg(accord(sautes.length, "non contrôlé", "non contrôlés"), p.alerte),
    );
  }

  // Sur un terminal étroit, les segments s'EMPILENT au lieu de déborder. Une
  // dernière ligne coupée par le terminal est celle qu'on retient de travers.
  const surUneLigne = `  ${segments.map((s) => s.mesure).join(" · ")}`;
  if (surUneLigne.length <= largeur) {
    return [`  ${segments.map((s) => s.peint).join(" · ")}`];
  }
  return segments.map((s) => `  ${s.peint}`);
}

/** Combien de familles ont réellement regardé — la moitié utile du bilan. */
function nombreDeControlesPasses(report: ICheckReport): number {
  let n = 0;
  // Dérivé de la source unique : une famille ajoutée est comptée sans qu'on ait
  // à y penser — la liste écrite en dur ici ignorait l'étage 2.
  for (const famille of COUNTED_FAMILIES) {
    if (report.execution[famille]?.ran) n++;
  }
  return n;
}
