/**
 * Onglet Décors de la page Configuration — modèle PUR (0 JSX).
 *
 * Types MIROIRS du rapport `GET /nodefony/test/api/testbed` (producteur :
 * `scripts/test/lib/testbed.ts` du dépôt) : le bundle client n'importe rien du
 * serveur, le contrat est le JSON. Seuls les champs lus ici sont déclarés.
 */

/** État d'un conteneur, tel que le serveur l'a constaté. */
export type TestbedContainerState =
  | "healthy"
  | "running"
  | "starting"
  | "unhealthy"
  | "stopped"
  | "absent"
  | "unknown";

export type TestbedFamily =
  "database" | "cache" | "observability" | "identity" | "network";

export interface TestbedBox {
  id: string;
  label: string;
  family: TestbedFamily;
  purpose: string;
  state: "ready" | "partial" | "down" | "unknown";
  services: Array<{ name: string; state: TestbedContainerState }>;
  vars: Array<{ name: string; value: string }>;
  sharedWith: string[];
  server: { required: string[]; missing: string[] } | null;
  suites: Array<{ label: string; config: string; proofs: number }>;
  playedBy: "default" | "phase" | "manual";
  phase: string | null;
  upCommand: string | null;
  note: string | null;
}

export interface TestbedBlindSpot {
  kind: string;
  subject: string;
  detail: string;
}

export interface TestbedReport {
  supported: true;
  generatedAt: string;
  docker: boolean;
  testbeds: TestbedBox[];
  switches: Array<{
    env: string;
    what: string;
    open: boolean;
    suites: string[];
  }>;
  tools: Array<{
    service: string;
    label: string;
    what: string;
    oneShot: boolean;
    state: TestbedContainerState;
  }>;
  blindSpots: TestbedBlindSpot[];
}

/** Verdict de capacité : l'onglet n'existe que sur `supported: true`. */
export type TestbedCapability =
  { supported: true } | { supported: false; reason: string };

/** Réponse du rapport : le rapport, ou le refus constaté. */
export type TestbedResponse =
  TestbedReport | { supported: false; reason: string };

/** Familles dans l'ordre d'affichage, avec leur titre. */
export const FAMILY_TITLES: ReadonlyArray<readonly [TestbedFamily, string]> = [
  ["database", "Bases de données"],
  ["cache", "Cache et messagerie"],
  ["observability", "Observabilité"],
  ["identity", "Identité"],
  ["network", "Réseau"],
];

/** Filtre des boîtes. */
export type TestbedFilter = "all" | "todo" | "ready";

/** Libellé et couleur Mantine d'un état de décor. */
export const STATE_BADGE: Record<
  TestbedBox["state"],
  { label: string; color: string }
> = {
  ready: { label: "Prêt", color: "teal" },
  partial: { label: "Partiel", color: "orange" },
  down: { label: "Arrêté", color: "orange" },
  unknown: { label: "Inconnu", color: "gray" },
};

/** Libellé d'un état de conteneur, dit simplement. */
export const CONTAINER_TEXT: Record<TestbedContainerState, string> = {
  healthy: "sain",
  running: "tourne",
  starting: "démarre",
  unhealthy: "en mauvaise santé",
  stopped: "arrêté",
  absent: "absent",
  unknown: "état inconnu",
};

/** Qui lève le décor, dit simplement. */
export function playedByText(box: TestbedBox): string {
  if (box.playedBy === "default") return "levé par npm run test:all";
  if (box.playedBy === "phase")
    return `levé par npm run test:all -- ${box.phase ?? ""}`.trim();
  return "levé par personne : à monter à la main";
}

/** Un décor « à monter » : tout ce qui n'est pas prêt, inconnu compris. */
export function needsWork(box: TestbedBox): boolean {
  return box.state !== "ready" || (box.server?.missing.length ?? 0) > 0;
}

/**
 * Les boîtes à afficher, rangées par famille, filtre appliqué.
 *
 * @returns les familles non vides, dans l'ordre de {@link FAMILY_TITLES}
 */
export function groupTestbeds(
  boxes: readonly TestbedBox[],
  filter: TestbedFilter,
): Array<{ family: TestbedFamily; title: string; boxes: TestbedBox[] }> {
  const keep = (b: TestbedBox): boolean =>
    filter === "all" || (filter === "todo" ? needsWork(b) : !needsWork(b));
  return FAMILY_TITLES.map(([family, title]) => ({
    family,
    title,
    boxes: boxes.filter((b) => b.family === family && keep(b)),
  })).filter((g) => g.boxes.length > 0);
}

/** Compteurs de la synthèse, lus dans le rapport — jamais écrits à la main. */
export function summarize(report: TestbedReport): {
  ready: number;
  total: number;
  todo: number;
  switchesOpen: number;
  switchesTotal: number;
  toolsUp: number;
  toolsTotal: number;
} {
  const tools = report.tools.filter((t) => !t.oneShot);
  return {
    ready: report.testbeds.filter((b) => b.state === "ready").length,
    total: report.testbeds.length,
    todo: report.testbeds.filter(needsWork).length,
    switchesOpen: report.switches.filter((s) => s.open).length,
    switchesTotal: report.switches.length,
    toolsUp: tools.filter((t) => t.state === "healthy" || t.state === "running")
      .length,
    toolsTotal: tools.length,
  };
}
