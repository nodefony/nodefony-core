import {
  createPalette,
  sectionTitle,
  stateSymbol,
  wrap,
  type IPalette,
  type SectionState,
} from "../kernel/checks/report";
import type { IEnvReport, IEnvVarReport } from "./envReport";

/**
 * Rendu humain de `nodefony env` — la grammaire visuelle de `nodefony doctor` :
 * en-tête `nodefony env · <app>`, sections en capitales soulignées d'un filet,
 * lignes `symbole  NOM ···· valeur  provenance`, largeur bornée au terminal,
 * couleurs coupées hors terminal. Une commande qui parle sa propre langue
 * oblige le lecteur à réapprendre où regarder.
 *
 * PUR : reçoit le rapport et le décor (largeur, couleur), rend du texte.
 */

/** Le décor du rendu. */
export interface IEnvRenderOptions {
  /** Racine de l'application, `null` hors projet. */
  projectRoot: string | null;
  /** Nom et version de l'application, pour l'en-tête. */
  app?: { name: string; version?: string } | null;
  /** Largeur utile (cf `usableWidth`). */
  width?: number;
  /** Émettre des séquences ANSI. */
  color?: boolean;
}

/** Une ligne de variable : état, nom, valeur, provenance. */
interface ILine {
  state: SectionState;
  name: string;
  value: string;
  origin: string;
  /** Rendue en retrait : ni posée, ni fautive (un défaut, une absence). */
  quiet?: boolean;
  /** Ce qu'il faut savoir en plus, sous la ligne. */
  note?: string;
}

/** Le nom lisible d'un niveau de la cascade. */
const sourceLabel = (source: string | null): string =>
  source === null ? "" : source === "process.env" ? "terminal" : source;

/** Colonne alignée. */
const pad = (s: string, n: number): string =>
  s.length >= n ? s : s + " ".repeat(n - s.length);

/** Coupe une valeur trop longue pour sa colonne. */
const clip = (s: string, n: number): string =>
  n <= 1 || s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/** Une valeur par défaut telle qu'elle s'écrirait dans `.env`. */
function defaultText(value: unknown, secret: boolean): string {
  if (secret) return "••••••••";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Les remarques d'une variable déclarée : exigence, valeurs admises, masquage. */
function varNote(v: IEnvVarReport): string | undefined {
  const notes: string[] = [];
  if (v.missing)
    notes.push("requise, et absente : l'application ne démarrera pas");
  else if (v.requiredIn?.length) {
    notes.push(`requise en ${v.requiredIn.join("/")}`);
  }
  if (v.values) notes.push(v.values.join(" | "));
  for (const s of v.shadowed) {
    notes.push(`${sourceLabel(s.source)} l'écrit aussi, ignoré`);
  }
  return notes.length ? notes.join(" · ") : undefined;
}

/**
 * Rend une section de lignes, alignées par points de conduite sur une colonne
 * COMMUNE à toute la page — des colonnes qui bougent d'une section à l'autre
 * se lisent comme des tableaux différents.
 */
function renderLines(
  lines: readonly ILine[],
  cols: { name: number; value: number },
  width: number,
  p: IPalette,
): string[] {
  const nameWidth = cols.name;
  const valueWidth = cols.value;
  const out: string[] = [];
  for (const l of lines) {
    const head = `    ${stateSymbol(l.state)}  ${l.name} `;
    const lead = "·".repeat(Math.max(1, 4 + 3 + nameWidth + 2 - head.length));
    const value = pad(clip(l.value, valueWidth), valueWidth);
    const paint =
      l.state === "echec"
        ? p.failure
        : l.state === "avertissement"
          ? p.warning
          : l.quiet
            ? p.dim
            : (t: string) => t;
    const symbol =
      l.state === "ok"
        ? p.ok(stateSymbol(l.state))
        : paint(stateSymbol(l.state));
    out.push(
      (
        `    ${symbol}  ${paint(l.name)} ${p.dim(lead)} ` +
        `${l.quiet ? p.dim(value) : value}  ${p.dim(l.origin)}`
      ).trimEnd(),
    );
    if (l.note) {
      out.push(
        ...wrap(l.note, width, " ".repeat(7)).map((line) => p.dim(line)),
      );
    }
  }
  return out;
}

/**
 * Rendu humain du rapport d'environnement.
 *
 * L'ordre des sections suit l'ordre des questions : d'où viennent les valeurs,
 * ce que l'application lit, ce que lisent les modules et le framework, puis ce
 * qui est SUSPECT — en dernier, là où l'œil termine.
 *
 * @param report - le rapport calculé par `buildEnvReport`.
 * @param options - racine, identité de l'application, largeur, couleur.
 * @returns le texte à écrire sur la sortie standard.
 */
export function renderEnvReport(
  report: IEnvReport,
  options: IEnvRenderOptions,
): string {
  const width = options.width ?? 79;
  const p = createPalette(options.color ?? false);
  const out: string[] = [];
  const section = (title: string, detail = ""): void => {
    const t = sectionTitle(title, width - (detail ? detail.length + 1 : 0));
    out.push(
      "",
      `${p.strong(t.title)}${p.dim(t.divider)}${detail ? ` ${p.dim(detail)}` : ""}`,
      "",
    );
  };

  // ── En-tête : la commande, l'application, le mode ────────────────────────
  const app = options.app
    ? ` · ${options.app.name}${options.app.version ? ` ${options.app.version}` : ""}`
    : "";
  out.push(
    "",
    `  ${p.strong("nodefony env")}${app} · mode ${report.runtimeEnv}` +
      (report.appEnv ? ` · déploiement ${report.appEnv}` : "") +
      // L'environnement ÉVALUÉ s'annonce en tête : un rapport qui exige des
      // variables de production sans dire qu'il regarde la production ferait
      // croire à une panne du poste.
      (report.targetEnv ? ` · exigences de ${report.targetEnv}` : ""),
  );
  if (options.projectRoot) out.push(`  ${p.dim(options.projectRoot)}`);

  const posed = report.vars.filter((v) => v.value !== null);
  const defaulted = report.vars.filter(
    (v) => v.value === null && v.default !== undefined,
  );
  const unset = report.vars.filter(
    (v) => v.value === null && v.default === undefined,
  );
  const missing = report.vars.filter((v) => v.missing);
  const suspects = report.unknown.length + report.inconsistencies.length;
  const tunables = report.reserved.filter((r) => r.tunable);
  const internals = report.reserved.filter((r) => !r.tunable);
  const settingsSet = report.settings.filter((s) => s.value !== null);
  const settingsUnset = report.settings.filter((s) => s.value === null);

  // ── Verdict : la ligne qu'on lit si on ne lit qu'une ligne ───────────────
  const verdict: string[] = [];
  if (missing.length) {
    verdict.push(p.failure(`${missing.length} REQUISE(S) ABSENTE(S)`));
  }
  if (suspects) verdict.push(p.warning(`${suspects} à vérifier`));
  const state: SectionState = missing.length
    ? "echec"
    : suspects
      ? "avertissement"
      : "ok";
  const symbolPaint =
    state === "echec"
      ? p.failure
      : state === "avertissement"
        ? p.warning
        : p.ok;
  out.push(
    "",
    `  ${symbolPaint(stateSymbol(state))}  ` +
      (verdict.length ? verdict.join("   ") : p.ok("rien à signaler")) +
      p.dim(
        `   ${posed.length + settingsSet.length + tunables.length} posées · ` +
          `${defaulted.length} sur leur défaut`,
      ),
  );

  // UNE colonne de noms et UNE colonne de valeurs pour toute la page : des
  // colonnes qui bougent d'une section à l'autre se lisent comme des tableaux
  // différents. La valeur est bornée (40, et ce que laisse le terminal) ; au-delà
  // elle est coupée — entière dans `--json`.
  const nameWidth = Math.max(
    0,
    ...[
      ...report.vars,
      ...report.settings,
      ...report.reserved,
      ...report.unknown,
    ].map((v) => v.name.length),
  );
  const shownValues = [
    ...report.vars.map(
      (v) =>
        v.value ??
        (v.default !== undefined ? defaultText(v.default, v.secret) : ""),
    ),
    ...report.settings.map(
      (s) =>
        s.value ??
        (s.default !== undefined ? defaultText(s.default, s.secret) : ""),
    ),
    ...report.reserved.filter((r) => r.tunable).map((r) => r.value),
  ];
  const cols = {
    name: nameWidth,
    value: Math.max(
      0,
      Math.min(
        40,
        Math.max(0, ...shownValues.map((v) => v.length)),
        width - (4 + 3 + nameWidth + 3 + 12),
      ),
    ),
  };

  // ── Sources ───────────────────────────────────────────────────────────────
  // Le terminal porte des dizaines de variables (PATH, HOME…) dont aucune ne
  // concerne l'application : on compte ce qu'il APPORTE, pas ce qu'il contient.
  const fromShell = [
    ...report.vars,
    ...report.settings,
    ...report.reserved,
    ...report.unknown,
    ...report.overrides,
  ].filter((v) => v.origin === "process.env").length;
  section("SOURCES", "la première qui pose une variable gagne");
  for (const l of report.levels) {
    const count = l.rank === 1 ? fromShell : l.count;
    const label =
      l.rank === 1 ? "terminal / orchestrateur" : sourceLabel(l.source);
    const levelCount = !l.exists
      ? "absent"
      : `${count} variable${count > 1 ? "s" : ""}`;
    out.push(
      (
        `    ${l.rank}  ${pad(label, 26)} ${levelCount}` +
        (l.rank === 1 ? p.dim("   gagne toujours") : "") +
        (l.skipped ? p.dim(`   (${l.skipped})`) : "")
      ).trimEnd(),
    );
  }

  // ── Application ───────────────────────────────────────────────────────────
  if (report.vars.length > 0) {
    section(
      "APPLICATION",
      `env.ts · ${posed.length} posées sur ${report.vars.length}`,
    );
    const lines: ILine[] = [
      // oxlint-disable-next-line no-map-spread -- objet CONSTRUIT champ par champ ; le seul spread est un littéral conditionnel, forme imposée par `exactOptionalPropertyTypes`
      ...posed.map((v): ILine => {
        const note = varNote(v);
        return {
          state: v.shadowed.length ? "avertissement" : "ok",
          name: v.name,
          value: v.value ?? "",
          origin: sourceLabel(v.origin),
          ...(note ? { note } : {}),
        };
      }),
      // oxlint-disable-next-line no-map-spread -- objet CONSTRUIT champ par champ ; le seul spread est un littéral conditionnel, forme imposée par `exactOptionalPropertyTypes`
      ...defaulted.map((v): ILine => {
        const note = varNote(v);
        return {
          state: "non-controle",
          name: v.name,
          value: defaultText(v.default, v.secret),
          origin: "défaut",
          quiet: true,
          ...(note ? { note } : {}),
        };
      }),
      // Une requise absente est un ÉCHEC, rendue en ligne pleine ; les autres
      // absences n'ont rien à dire de plus que leur nom.
      ...unset
        .filter((v) => v.missing || v.requiredIn?.length)
        // oxlint-disable-next-line no-map-spread -- objet CONSTRUIT champ par champ ; le seul spread est un littéral conditionnel, forme imposée par `exactOptionalPropertyTypes`
        .map((v): ILine => {
          const note = varNote(v);
          return {
            state: v.missing ? "echec" : "non-controle",
            name: v.name,
            value: "",
            origin: "",
            quiet: !v.missing,
            ...(note ? { note } : {}),
          };
        }),
    ];
    out.push(...renderLines(lines, cols, width, p));
    const quiet = unset.filter((v) => !v.missing && !v.requiredIn?.length);
    if (quiet.length) {
      out.push(
        "",
        ...wrap(
          `non posées : ${quiet.map((v) => v.name).join(", ")}`,
          width,
          "    ",
        ).map((l) => p.dim(l)),
      );
    }
  }

  // ── Modules : ce que leurs schémas déclarent (`.meta({ env })`) ──────────
  if (report.settings.length > 0) {
    section(
      "MODULES",
      `réglages de leur schéma · ${settingsSet.length} posés sur ${report.settings.length}`,
    );
    out.push(
      ...renderLines(
        [
          ...settingsSet.map((s): ILine => ({
            state: "ok",
            name: s.name,
            value: s.value ?? "",
            origin: `${sourceLabel(s.origin)} · ${s.module}`,
          })),
          ...settingsUnset.map((s): ILine => ({
            state: "non-controle",
            name: s.name,
            value:
              s.default !== undefined ? defaultText(s.default, s.secret) : "",
            origin: s.module,
            quiet: true,
          })),
        ],
        cols,
        width,
        p,
      ),
    );
  }

  // ── Framework : réglages du cœur posés ici ────────────────────────────────
  if (tunables.length > 0) {
    section("FRAMEWORK", "réglages du cœur");
    out.push(
      ...renderLines(
        tunables.map((r): ILine => ({
          state: "ok",
          name: r.name,
          value: r.value,
          origin: sourceLabel(r.origin),
          note: r.role,
        })),
        cols,
        width,
        p,
      ),
    );
  }

  if (report.overrides.length > 0) {
    section("SURCHARGES", "NF__<MODULE>__<CHEMIN>");
    for (const o of report.overrides) {
      out.push(
        `    ${p.ok(stateSymbol("ok"))}  ${o.envKey} ${p.dim("→")} ` +
          `${o.module}.${o.path.join(".")} = ${o.value}` +
          (o.origin ? p.dim(`  ${sourceLabel(o.origin)}`) : ""),
      );
    }
  }

  // ── À vérifier : en dernier, là où l'œil termine ─────────────────────────
  if (suspects > 0) {
    section("À VÉRIFIER");
    out.push(
      ...renderLines(
        [
          ...report.unknown.map((u): ILine => ({
            state: "avertissement",
            name: u.name,
            value: "lue par personne",
            origin: sourceLabel(u.origin),
            note: u.suggestion
              ? `vouliez-vous dire ${u.suggestion} ? sinon cette variable est sans effet`
              : "sans effet : aucune déclaration ne la lit (faute de frappe ?)",
          })),
          ...report.inconsistencies.map((i): ILine => ({
            state: "avertissement",
            name: i.name,
            value: "contredite par le projet",
            origin: "",
            note: i.message,
          })),
        ],
        cols,
        width,
        p,
      ),
    );
  }

  if (internals.length > 0) {
    section("POSÉES PAR LE FRAMEWORK", "à ne pas écrire");
    for (const r of internals) {
      out.push(`    ${p.dim("·")}  ${r.name}`);
      out.push(...wrap(r.role, width, " ".repeat(7)).map((l) => p.dim(l)));
    }
  }

  for (const note of report.notes) {
    out.push("", ...wrap(`! ${note}`, width, "  ").map((l) => p.warning(l)));
  }
  out.push(
    "",
    p.dim(
      "  --json : le rapport entier · --example : la notice .env.example · --help",
    ),
    "",
  );
  return out.join("\n");
}
