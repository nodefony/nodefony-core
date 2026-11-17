/**
 * `advisoriesOf` / `auditVerdicts` — la garde d'audit de la forge. Vécu : l'avis
 * picomatch GHSA-fc5q-39xc-vjpf élargi à `<= 4.0.7`, dernière version publiée,
 * a rougi la forge sans qu'aucun `overrides` puisse rien y faire. L'exception
 * nommée le tolère tant qu'aucun correctif n'existe, et seulement jusque-là.
 */
import { describe, it, expect } from "vitest";
import { advisoriesOf, auditVerdicts } from "./lib/audit.mjs";

const picomatch = {
  source: 1117000,
  name: "picomatch",
  title:
    "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  severity: "high",
  range: "<=4.0.7",
};

/** Extrait du rapport réel : une source, et des paquets qui en héritent. */
const report = {
  vulnerabilities: {
    picomatch: { via: [picomatch] },
    vite: { via: ["picomatch", "tinyglobby"] },
    tinyglobby: { via: ["picomatch"] },
  },
};

const accepted = { "GHSA-fc5q-39xc-vjpf": "aucun correctif publié" };
const verdicts = (advs, latest, acc = accepted) =>
  Object.fromEntries(
    auditVerdicts(advs, latest, acc).map((v) => [v.id, v.verdict]),
  );

describe("advisoriesOf — les avis SOURCES d'un rapport npm audit", () => {
  it("un avis hérité par 19 paquets se compte UNE fois, les héritiers ne disent rien", () => {
    const advs = advisoriesOf({
      vulnerabilities: {
        ...report.vulnerabilities,
        autre: { via: [picomatch] },
      },
    });
    expect(advs).toEqual([
      {
        id: "GHSA-fc5q-39xc-vjpf",
        name: "picomatch",
        title: picomatch.title,
        severity: "high",
        range: "<=4.0.7",
      },
    ]);
  });
  it("rapport sans vulnérabilité → rien", () => {
    expect(advisoriesOf({})).toEqual([]);
  });
});

describe("auditVerdicts — une faille bloque, sauf exception nommée et sans correctif", () => {
  const advs = advisoriesOf(report);

  it("vécu : picomatch inscrit, 4.0.7 dernière version publiée → toléré", () => {
    expect(verdicts(advs, () => "4.0.7")).toEqual({
      "GHSA-fc5q-39xc-vjpf": "toléré",
    });
  });
  it("non inscrit → VULNÉRABLE, la forge rougit", () => {
    expect(verdicts(advs, () => "4.0.7", {})).toEqual({
      "GHSA-fc5q-39xc-vjpf": "VULNÉRABLE",
    });
  });
  it("une version hors plage est publiée → CORRECTIF-PUBLIÉ : l'exception expire seule", () => {
    expect(verdicts(advs, () => "4.0.8")).toEqual({
      "GHSA-fc5q-39xc-vjpf": "CORRECTIF-PUBLIÉ",
    });
  });
  it("dernière version illisible → CORRECTIF-INCONNU, jamais un verdict supposé", () => {
    expect(verdicts(advs, () => null)).toEqual({
      "GHSA-fc5q-39xc-vjpf": "CORRECTIF-INCONNU",
    });
  });
  it("l'avis a disparu du rapport (overrides posé) → EXCEPTION-SANS-OBJET : la retirer", () => {
    expect(verdicts([], () => "4.0.8")).toEqual({
      "GHSA-fc5q-39xc-vjpf": "EXCEPTION-SANS-OBJET",
    });
  });
  it("une gravité modérée ne bloque pas, même non inscrite", () => {
    const mod = advisoriesOf({
      vulnerabilities: {
        x: {
          via: [
            {
              ...picomatch,
              url: "https://github.com/advisories/GHSA-x",
              severity: "moderate",
            },
          ],
        },
      },
    });
    expect(verdicts(mod, () => "4.0.7", {})).toEqual({});
  });
});
