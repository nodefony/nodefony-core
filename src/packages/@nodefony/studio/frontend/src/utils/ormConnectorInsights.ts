/**
 * Lecture d'UN connecteur ORM : à qui appartiennent les briques des stores, et
 * ce que les mesures du data plane disent de lui.
 *
 * Fonctions PURES (0 JSX, 0 fetch) : l'écran les rend, les tests les
 * éprouvent. Chaque verdict rendu par {@link analyzeConnector} naît d'une
 * mesure présente dans l'entrée — aucun n'est affirmé sans elle, et un
 * verdict dont la mesure manque n'apparaît pas (ne rien dire vaut mieux
 * qu'annoncer faux).
 */
import type {
  ConnHealth,
  EntityNode,
  FlowDetail,
  MigrationReply,
  OrmSummary,
  StoreBrick,
} from "../types/orm";
import { fmtBytes, fmtMs, fmtNum } from "./ormFormat";

/**
 * Rattache chaque brique du registre des stores au CONNECTEUR qui la porte.
 *
 * 🔴 Jamais par moteur : deux connecteurs sqlite (le `default` sur fichier et
 * un connecteur dédié `:memory:`) recevaient alors TOUS DEUX les mêmes
 * briques, et le dédié s'annonçait comme la base applicative — celle qui
 * s'efface au redémarrage. La preuve d'appartenance est la `location` que le
 * registre publie, comparée à la cible du connecteur. Un moteur qui n'a qu'UN
 * connecteur lui rend ses briques sans autre preuve ; entre plusieurs, une
 * brique sans correspondance n'est attribuée à personne.
 *
 * @param stores - briques du registre (`/nodefony/kernel/api/stores`).
 * @param connectors - connecteurs déclarés (`/nodefony/orm/api/orms`).
 * @returns nom du connecteur → briques qu'il porte (absent = aucune).
 */
export function attributeBricks(
  stores: readonly StoreBrick[],
  connectors: readonly OrmSummary[],
): Map<string, StoreBrick[]> {
  const by = new Map<string, StoreBrick[]>();
  for (const s of stores) {
    const candidates = connectors.filter((o) => o.vendor === s.resolved);
    const owner =
      candidates.length === 1
        ? candidates[0]
        : candidates.find(
            (o) =>
              s.location !== undefined && o.connection?.target === s.location,
          );
    if (owner === undefined) continue;
    const list = by.get(owner.name) ?? [];
    list.push(s);
    by.set(owner.name, list);
  }
  return by;
}

/** Gravité d'un verdict, de la plus haute à la plus basse. */
export type FindingLevel = "critical" | "warning" | "info" | "ok";

/** Onglet de la page connecteur où se lit le détail d'un verdict. */
export type ConnectorTab =
  "analyse" | "donnees" | "stores" | "requetes" | "connexion" | "migrations";

/** Un verdict sur le connecteur, avec la mesure qui le fonde. */
export interface ConnectorFinding {
  /** Identifiant stable (clé React, test). */
  id: string;
  level: FindingLevel;
  title: string;
  /** Le constat chiffré — la mesure qui fonde le verdict. */
  detail: string;
  /** Onglet où se trouve le détail. */
  tab?: ConnectorTab;
  /** Commande ou geste proposé, à copier tel quel. */
  command?: string;
}

/** Ce que {@link analyzeConnector} lit — tout est facultatif sauf le résumé. */
export interface ConnectorInput {
  orm: OrmSummary;
  health?: ConnHealth | null;
  bricks?: readonly StoreBrick[];
  entities?: readonly EntityNode[];
  /** Compte par entité de CE connecteur (`-1` = non comptable). */
  rows?: ReadonlyMap<string, number>;
  flow?: FlowDetail | null;
  /** Flux désactivé côté serveur (production) : pas de verdict de requêtes. */
  flowEnabled?: boolean;
  /** Seuil de lenteur publié par le flux (ms). */
  slowMs?: number;
  migrations?: MigrationReply | null;
}

/** Part des pages libres d'une base sqlite au-delà de laquelle `VACUUM` paie. */
export const FREE_PAGES_RATIO = 0.25;
/** Volume récupérable minimal pour mériter un verdict (octets). */
export const RECLAIM_MIN_BYTES = 10 * 1024 * 1024;
/** Part des lignes au-delà de laquelle une table « domine » la base. */
export const DOMINANT_SHARE = 0.8;
/** Nombre de lignes minimal pour qu'une table dominante soit un sujet. */
export const DOMINANT_MIN_ROWS = 10_000;
/** Ping moyen au-delà duquel la base répond lentement (ms). */
export const SLOW_PING_MS = 20;

const LEVEL_RANK: Record<FindingLevel, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  ok: 3,
};

/**
 * Gravité la plus haute d'une liste de verdicts.
 *
 * @param findings - verdicts rendus par {@link analyzeConnector}.
 * @returns le niveau le plus grave, `ok` pour une liste vide.
 */
export function worstLevel(
  findings: readonly ConnectorFinding[],
): FindingLevel {
  let worst: FindingLevel = "ok";
  for (const f of findings) {
    if (LEVEL_RANK[f.level] < LEVEL_RANK[worst]) worst = f.level;
  }
  return worst;
}

/** Pourcentage lisible (`99,9 %`, `12 %`). */
function pct(ratio: number): string {
  const v = ratio * 100;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} %`;
}

/**
 * Analyse un connecteur à partir de ce que le data plane publie de lui.
 *
 * @param input - résumé, santé, briques, entités et comptes, flux, migrations.
 * @returns les verdicts, du plus grave au moins grave.
 */
export function analyzeConnector(input: ConnectorInput): ConnectorFinding[] {
  const out: ConnectorFinding[] = [];
  const { orm, health } = input;
  const target = orm.connection?.target ?? health?.target;
  const driver = orm.connection?.driver ?? health?.driver ?? "";
  const volatile = target === ":memory:";
  const bricks = input.bricks ?? [];
  const durable = bricks.filter((b) => b.nature === "durable");

  // ── Joignabilité ─────────────────────────────────────────────────────────
  if (!orm.connected) {
    out.push({
      id: "disconnected",
      level: "critical",
      title: "Connecteur déconnecté",
      detail: health?.lastError
        ? `Dernière erreur : ${health.lastError.message}`
        : "Le registre le déclare hors ligne ; aucune erreur n'a été retenue.",
      tab: "connexion",
    });
  } else if (health && !health.pingOk) {
    out.push({
      id: "ping-failed",
      level: "critical",
      title: "La base ne répond pas au ping",
      detail: health.pingError ?? "Ping en échec, sans message.",
      tab: "connexion",
    });
  }

  // ── Ce que porte le connecteur ───────────────────────────────────────────
  if (volatile && durable.length > 0) {
    out.push({
      id: "volatile-durable",
      level: "critical",
      title: "Des données durables vivent dans une base volatile",
      detail: `${durable.length} brique(s) durable(s) (${durable
        .map((b) => b.brick)
        .join(
          ", ",
        )}) sont résolues sur une base \`:memory:\` : tout est perdu au redémarrage.`,
      tab: "stores",
    });
  } else if (volatile) {
    out.push({
      id: "volatile",
      level: "info",
      title: "Base en mémoire, vidée à chaque redémarrage",
      detail:
        "Cible `:memory:` : adaptée à un banc, une démo ou un état jetable. Aucune brique durable du framework n'y est résolue.",
      tab: "connexion",
    });
  }
  if (!volatile && durable.length > 0) {
    out.push({
      id: "carries-stores",
      level: "ok",
      title: `Porte ${durable.length} brique(s) durable(s) du framework`,
      detail: `${durable.map((b) => b.brick).join(", ")} — sessions, comptes, jetons et audit vivent ici.`,
      tab: "stores",
    });
  } else if (orm.default && durable.length === 0 && input.bricks) {
    out.push({
      id: "default-empty",
      level: "info",
      title: "Connecteur par défaut, mais aucune brique n'y vit",
      detail:
        "Le drapeau `default` vient de l'ORM : l'infrastructure déclarée place les données du framework sur un autre connecteur.",
      tab: "stores",
    });
  }

  // ── Stabilité ────────────────────────────────────────────────────────────
  if (health && health.reconnectCount > 0) {
    out.push({
      id: "reconnects",
      level: "warning",
      title: `${health.reconnectCount} reconnexion(s) depuis le démarrage`,
      detail:
        "La connexion est tombée puis revenue : réseau, redémarrage du serveur de base ou délai d'inactivité trop court.",
      tab: "connexion",
    });
  }
  if (health && health.errorCount > 0) {
    out.push({
      id: "errors",
      level: "warning",
      title: `${health.errorCount} erreur(s) de connexion retenue(s)`,
      detail: health.lastError
        ? `Dernière : ${health.lastError.message}`
        : "Voir l'historique des erreurs.",
      tab: "connexion",
    });
  }
  const avgPing = health?.latency.avg ?? null;
  if (avgPing !== null && avgPing > SLOW_PING_MS) {
    out.push({
      id: "slow-ping",
      level: "warning",
      title: "La base répond lentement",
      detail: `Ping moyen ${fmtMs(avgPing)} sur ${health?.latency.samples ?? 0} mesure(s) — au-delà de ${SLOW_PING_MS} ms, chaque requête paie ce délai.`,
      tab: "connexion",
    });
  }

  // ── Stockage (sqlite sur fichier) ────────────────────────────────────────
  const st = health?.storage;
  if (st?.pages && st.freePages !== undefined && st.pageSize) {
    const ratio = st.freePages / st.pages;
    const reclaim = st.freePages * st.pageSize;
    if (ratio >= FREE_PAGES_RATIO && reclaim >= RECLAIM_MIN_BYTES) {
      out.push({
        id: "vacuum",
        level: "warning",
        title: `${fmtBytes(reclaim)} récupérables sur le disque`,
        detail: `${pct(ratio)} des pages du fichier sont libres (${fmtNum(st.freePages)} sur ${fmtNum(st.pages)}) : des lignes ont été supprimées, le fichier ne rétrécit pas seul. \`VACUUM\` réécrit la base — il la verrouille le temps de l'opération.`,
        tab: "connexion",
        command: "VACUUM;",
      });
    }
  }
  if (
    driver === "sqlite" &&
    !volatile &&
    st?.journalMode &&
    st.journalMode !== "wal"
  ) {
    out.push({
      id: "journal-mode",
      level: "info",
      title: `Journal en mode « ${st.journalMode} »`,
      detail:
        "En mode WAL, les lectures ne bloquent plus les écritures : c'est le réglage attendu d'une base sqlite servie par un serveur web.",
      tab: "connexion",
      command: "PRAGMA journal_mode=WAL;",
    });
  }

  // ── Données ──────────────────────────────────────────────────────────────
  const rows = input.rows;
  if (rows && rows.size > 0) {
    let total = 0;
    let top: [string, number] | null = null;
    const empty: string[] = [];
    const uncountable: string[] = [];
    for (const [name, n] of rows) {
      if (n < 0) {
        uncountable.push(name);
        continue;
      }
      total += n;
      if (n === 0) empty.push(name);
      if (top === null || n > top[1]) top = [name, n];
    }
    if (top && total >= DOMINANT_MIN_ROWS && top[1] / total >= DOMINANT_SHARE) {
      out.push({
        id: "dominant-table",
        level: "info",
        title: `« ${top[0]} » porte ${pct(top[1] / total)} des lignes`,
        detail: `${fmtNum(top[1])} ligne(s) sur ${fmtNum(total)}. Une table qui ne fait que croître appelle une politique de rétention ou de purge — et chaque \`COUNT(*)\` sur elle parcourt tout.`,
        tab: "donnees",
      });
    }
    if (empty.length > 0) {
      out.push({
        id: "empty-tables",
        level: "info",
        title: `${empty.length} table(s) vide(s)`,
        detail: `${empty.join(", ")} — normal pour une fonction que l'application n'emploie pas encore.`,
        tab: "donnees",
      });
    }
    if (uncountable.length > 0) {
      out.push({
        id: "uncountable",
        level: "warning",
        title: `${uncountable.length} table(s) impossible(s) à compter`,
        detail: `${uncountable.join(", ")} — table absente de la base, ou connecteur hors ligne au moment du comptage.`,
        tab: "donnees",
      });
    }
  }

  // ── Requêtes ─────────────────────────────────────────────────────────────
  const flow = input.flow;
  if (input.flowEnabled === false) {
    out.push({
      id: "flow-disabled",
      level: "info",
      title: "Flux des requêtes non mesuré",
      detail:
        "La mesure du flux est coupée sur ce serveur (c'est le cas en production) : ni débit ni requêtes lentes à montrer.",
      tab: "requetes",
    });
  } else if (flow && flow.slowTotal > 0) {
    const counts = flow.slow.filter((q) =>
      /count\s*\(\s*\*\s*\)/i.test(q.sql ?? ""),
    );
    out.push({
      id: "slow-queries",
      level: "warning",
      title: `${flow.slowTotal} requête(s) lente(s)`,
      detail: `Au-delà de ${input.slowMs ?? "?"} ms, sur ${fmtNum(flow.total)} requête(s) ; la pire a pris ${fmtMs(flow.maxMs)}.${
        counts.length > 0
          ? ` Dont ${counts.length} \`COUNT(*)\` — le coût d'un comptage exact croît avec la table.`
          : ""
      }`,
      tab: "requetes",
    });
  }

  // ── Migrations ───────────────────────────────────────────────────────────
  const mig = input.migrations;
  if (mig && "error" in mig) {
    out.push({
      id: "migrations-unavailable",
      level:
        mig.error.code === "NF_MIGRATE_NOT_CONFIGURED" ? "info" : "warning",
      title: "Migrations non suivies",
      detail: mig.error.summary,
      tab: "migrations",
      command: mig.error.nextActions[0]?.command,
    });
  } else if (mig && mig.verdict !== "up-to-date") {
    out.push({
      id: "migrations-pending",
      level: "warning",
      title: "Le schéma n'est pas à jour",
      detail: mig.summary,
      tab: "migrations",
      command: mig.nextActions[0]?.command,
    });
  } else if (mig) {
    out.push({
      id: "migrations-ok",
      level: "ok",
      title: "Migrations à jour",
      detail: mig.summary,
      tab: "migrations",
    });
  }

  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}
