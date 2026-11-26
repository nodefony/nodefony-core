/**
 * `/status` en panneau à rubriques (#538, D9, D10) : il REND le rapport de
 * `nodefony status` (`collectDevStatus`), jamais un second relevé — même
 * topologie, mêmes ports, mêmes avertissements, mêmes formats.
 *
 * Pur : le rapport est passé par l'appelant.
 */
import Cli from "../../Cli";
import { formatUptime } from "./devProcess";
import type { IPanelPage, IPanelSpec, PanelRow } from "./devPanel";
import type { DevStatusReport } from "./devStatusReport";

/** L'identifiant de l'onglet : relancer `/status` le rafraîchit. */
export const STATUS_PANEL_ID = "status";

/**
 * Le rapport d'état en rubriques : résumé (et avertissements), process,
 * ports, puis les runtimes d'autres projets s'il y en a.
 *
 * @param report - le rapport de `collectDevStatus`.
 * @returns le panneau.
 */
export function buildStatusPanel(report: DevStatusReport): IPanelSpec {
  const pages: IPanelPage[] = [
    { title: "Résumé", rows: summaryRows(report) },
    { title: "Process", rows: processRows(report) },
    { title: "Ports", rows: portRows(report) },
  ];
  if (report.foreign.length > 0) {
    pages.push({
      title: "Ailleurs",
      rows: [
        {
          kind: "text",
          text: "Runtimes d'autres projets du poste — jamais comptés ici.",
        },
        {
          kind: "table",
          head: ["rôle", "pid", "dossier"],
          rows: report.foreign.map((p) => [
            p.label,
            String(p.pid),
            p.cwd ?? "(inconnu)",
          ]),
        },
      ],
    });
  }
  return { id: STATUS_PANEL_ID, label: "status", pages };
}

function summaryRows(report: DevStatusReport): PanelRow[] {
  const s = report.summary;
  const counts = [
    `${s.supervisors} superviseur`,
    `${s.servers} serveur`,
    `${s.vites} Vite`,
  ];
  if (s.masters > 0) counts.push(`${s.masters} master`);
  if (s.workers > 0) counts.push(`${s.workers} worker`);
  const rows: PanelRow[] = [
    {
      kind: "entry",
      key: "état",
      value: report.running
        ? `en marche${report.mode === null ? "" : ` (${report.mode})`}`
        : report.inProject
          ? "aucune instance"
          : "hors d'un projet Nodefony",
    },
    { kind: "entry", key: "process", value: counts.join(" · ") },
    {
      kind: "entry",
      key: "ports",
      value: `${s.portsUp}/${s.portsTotal} en écoute`,
    },
    { kind: "entry", key: "disponibilité", value: readinessText(report) },
    {
      kind: "entry",
      key: "pidfile",
      value: `${report.pidfile.path} · ${
        report.pidfile.pid === null
          ? "aucun pid"
          : `pid ${report.pidfile.pid}${report.pidfile.alive ? "" : " (mort)"}`
      }`,
    },
  ];
  if (report.warnings.length > 0) {
    rows.push({ kind: "heading", text: "Avertissements" });
    for (const warning of report.warnings) {
      rows.push({ kind: "text", text: `⚠ ${warning}` });
    }
  }
  return rows;
}

/** La disponibilité, sans jamais lire « non sondée » comme « prête ». */
function readinessText(report: DevStatusReport): string {
  const readiness = report.readiness;
  if (readiness === null) return "non sondée";
  if (readiness.ready) return "prête";
  const names = (readiness.blockedBy ?? []).map((b) =>
    b.reason === undefined ? b.name : `${b.name} (${b.reason})`,
  );
  return names.length > 0
    ? `retenue par ${readiness.blocked} : ${names.join(", ")}`
    : `retenue par ${readiness.blocked} composant(s)`;
}

function processRows(report: DevStatusReport): PanelRow[] {
  if (report.processes.length === 0) {
    return [{ kind: "text", text: "Aucun process de ce projet ne tourne." }];
  }
  // Le détail (bundles d'une instance Vite) suit le rôle dans sa cellule :
  // une ligne de tableau à une seule cellule élargirait toute la colonne.
  const rows = report.processes.map((p) => [
    p.detail ? `${p.label} (${p.detail.replace(/\+/g, ", ")})` : p.label,
    String(p.pid),
    String(p.ppid),
    formatUptime(p.uptimeSec),
    Cli.niceBytes(p.rssKb * 1024),
    p.cpu.toFixed(1),
  ]);
  return [
    {
      kind: "table",
      head: ["rôle", "pid", "ppid", "uptime", "rss", "%cpu"],
      rows,
    },
  ];
}

function portRows(report: DevStatusReport): PanelRow[] {
  const rows: PanelRow[] = [
    {
      kind: "table",
      head: ["port", "état", "tenu par"],
      rows: report.ports.map((p) => {
        const owner = report.portOwners[p.port];
        return [
          String(p.port),
          p.listening ? "en écoute" : "fermé",
          owner ?? (p.listening ? "ce projet" : ""),
        ];
      }),
    },
  ];
  if (report.portShift !== null) {
    rows.push({
      kind: "text",
      text: `Ports décalés : la configuration demande ${report.portShift.desired.join(", ")}, l'application sert ${report.portShift.served.join(", ")}.`,
    });
  }
  return rows;
}
