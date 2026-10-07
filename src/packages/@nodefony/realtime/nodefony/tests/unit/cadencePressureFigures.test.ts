import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdaptiveRate } from "nodefony/client";
import { decideSend } from "@nodefony/http";

/**
 * Les courbes de `docs/cadence-et-contre-pression.md` sont CALCULÉES par le vrai
 * code, pas dessinées : ce test rejoue chaque scénario avec `AdaptiveRate` et
 * `decideSend`, puis compare chaque valeur à celle que la page publie.
 *
 * Pourquoi un test et pas un script : une figure de documentation recopiée une
 * fois devient fausse au premier réglage qui change (un seuil, une fenêtre de
 * reprise), et rien ne le signale. Ici, la page et le code ne peuvent plus
 * diverger sans qu'une suite rougisse — et l'échec imprime les nouvelles
 * valeurs, prêtes à recopier dans la page.
 */

const PAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/cadence-et-contre-pression.md",
);
const md = readFileSync(PAGE, "utf8");

/** Les valeurs de la série `line [...]` du xychart dont le titre est donné. */
function figure(title: string): number[] {
  const bloc = md
    .split("```mermaid")
    .find((b) => b.includes(`title "${title}"`));
  if (!bloc) throw new Error(`figure absente de la page : « ${title} »`);
  const line = /^\s*line \[(.*)\]\s*$/m.exec(bloc);
  if (!line?.[1]) throw new Error(`série absente de la figure « ${title} »`);
  return line[1].split(",").map((v) => Number(v.trim()));
}

/** Scénario AIMD : cadence désirée 1 s ; de 20 s à 70 s, 4,5 s pour absorber une trame. */
function aimdScenario(): { cadences: number[]; decisions: string[] } {
  const ar = new AdaptiveRate({ intervalMs: 1000 });
  const service = (t: number): number => (t >= 20000 && t < 70000 ? 4500 : 200);
  const trace: Array<[number, number]> = [];
  const decisions: string[] = [];
  let lastEmit = 0;
  let lastArrival = 0;
  let cur = ar.current();
  while (lastArrival < 130000) {
    const emit = lastEmit + cur;
    const arrival = Math.max(emit, lastArrival + service(emit));
    lastEmit = emit;
    lastArrival = arrival;
    const d = ar.noteFrame(arrival);
    if (d) {
      decisions.push(
        `${Math.round(arrival / 1000)}:${d.reason}:${d.intervalMs}`,
      );
      cur = d.intervalMs;
      lastEmit = arrival;
    }
    trace.push([arrival, ar.current()]);
  }
  const at = (s: number): number => {
    let v = 1000;
    for (const [ts, c] of trace) if (ts <= s * 1000) v = c;
    return v;
  };
  const cadences: number[] = [];
  for (let s = 0; s <= 125; s += 5) cadences.push(at(s));
  return { cadences, decisions };
}

/**
 * Scénario contre-pression : 100 trames de 32 Kio par seconde ; le client draine
 * 8 Mo/s, puis 1 Mo/s de `slowFrom` à `slowTo`. Défauts de production.
 */
function pressureScenario(slowFrom: number, slowTo: number, endMs: number) {
  const sock: {
    bufferedAmount: number;
    _nfDropStreak?: number;
    closedCode: number | null;
    close(code?: number): void;
  } = {
    bufferedAmount: 0,
    closedCode: null,
    close(code) {
      this.closedCode = code ?? null;
    },
  };
  const MAX = 4 * 1024 * 1024;
  const FRAME = 32 * 1024;
  const drain = (t: number): number =>
    t >= slowFrom && t < slowTo ? 1_000_000 : 8_000_000;
  const mib: number[] = [];
  const balance: number[] = [];
  let sent = 0;
  let dropped = 0;
  let closedAt: number | null = null;
  for (let t = 0; t <= endMs; t += 10) {
    sock.bufferedAmount = Math.max(0, sock.bufferedAmount - drain(t) / 100);
    if (sock.closedCode !== null) break;
    const d = decideSend(sock, MAX, "drop", 1000);
    if (d === "send") {
      sock.bufferedAmount += FRAME;
      sent++;
    } else if (d === "drop") dropped++;
    else closedAt = t;
    if (t % 1000 === 0) {
      mib.push(Number((sock.bufferedAmount / 1048576).toFixed(2)));
      balance.push(sock._nfDropStreak ?? 0);
    }
  }
  return { mib, balance, sent, dropped, closedAt, closedCode: sock.closedCode };
}

describe("docs/cadence-et-contre-pression.md — les courbes sont celles du code", () => {
  it("la cadence AIMD de la page est celle que produit AdaptiveRate", () => {
    const { cadences, decisions } = aimdScenario();
    expect(figure("Cadence AIMD — dégradation de 20 s à 70 s")).toEqual(
      cadences,
    );
    // La table « décision par décision » de la page.
    expect(decisions).toEqual([
      "24:decrease:2000",
      "33:decrease:4000",
      "55:increase:2000",
      "64:decrease:4000",
      "84:increase:2000",
      "94:increase:1000",
    ]);
  });

  it("un client mort : la file plafonne, le solde monte, fermeture 1013", () => {
    const r = pressureScenario(2000, Number.POSITIVE_INFINITY, 60000);
    expect(
      figure("File d'envoi d'un client qui ne suit plus (seuil 4 Mio)"),
    ).toEqual(r.mib);
    expect(
      figure("Solde de refus d'un client mort — fermeture à 1000"),
    ).toEqual(r.balance);
    expect(r.closedCode).toBe(1013);
    expect(r.closedAt).toBe(29470);
    expect(md).toContain(
      `après ${r.dropped} trames refusées et ${r.sent} envoyées`,
    );
  });

  it("un pic passager : le solde redescend, aucune fermeture", () => {
    const r = pressureScenario(2000, 9000, 15000);
    expect(
      figure("Solde de refus d'un pic passager — aucune fermeture"),
    ).toEqual(r.balance);
    expect(r.closedCode).toBeNull();
  });
});
