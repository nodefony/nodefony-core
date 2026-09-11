import { describe, expect, it } from "vitest";
import {
  citeLeTicket,
  lintBoard,
  parseBefore,
  parseDependsOn,
} from "./board-lint.mjs";

/** Un item sain : jalon, ordre, estimation, priorité, aucun statut menteur. */
const sain = (n, extra = {}) => ({
  n,
  title: `fix(x): ticket ${n}`,
  milestone: "10.0.0",
  parent: null,
  ordre: n,
  jours: 1,
  prio: "P1 — figé à la création",
  status: "Todo",
  ...extra,
});
const issueSaine = (n, extra = {}) => ({
  n,
  title: `fix(x): ticket ${n}`,
  milestone: "10.0.0",
  labels: [],
  dependsOn: [],
  ...extra,
});
const codes = (findings) => findings.map((f) => f.code);
const MAINTENANT = new Date("2026-09-04T12:00:00Z");

describe("parseDependsOn", () => {
  it("lit les numéros du bloc, quelle que soit la graisse du libellé", () => {
    expect(parseDependsOn("**Dépend de** : #12, #13")).toEqual([12, 13]);
    expect(parseDependsOn("Depend de: #7")).toEqual([7]);
  });

  it("rend vide quand le bloc dit « rien », manque, ou que le corps est absent", () => {
    expect(parseDependsOn("**Dépend de** : rien")).toEqual([]);
    expect(parseDependsOn("**Estimation : 2 j**")).toEqual([]);
    expect(parseDependsOn(undefined)).toEqual([]);
  });

  it("ne compte pas deux fois le même ticket", () => {
    expect(parseDependsOn("Dépend de : #9, #9")).toEqual([9]);
  });

  it("« rien — mais à faire AVANT #175 » ne dépend de rien", () => {
    expect(
      parseDependsOn(
        "**Dépend de** : rien — mais à faire AVANT la publication (#175 beta)",
      ),
    ).toEqual([]);
  });
});

describe("parseBefore", () => {
  it("lit la contrainte inverse, que le tableau n'a aucun champ pour exprimer", () => {
    expect(
      parseBefore(
        "**Dépend de** : rien — mais à faire AVANT la publication (#175 beta)",
      ),
    ).toEqual([175]);
  });

  it("ne confond pas une dépendance amont avec une contrainte inverse", () => {
    expect(parseBefore("**Dépend de** : #181")).toEqual([]);
  });
});

describe("citeLeTicket — la borne que `git --grep` ne sait pas exprimer", () => {
  it("reconnaît le ticket cité, dans le sujet comme dans le corps", () => {
    expect(citeLeTicket("fix(x): corrige #53", 53)).toBe(true);
    expect(citeLeTicket("sujet\n\nvoir #53 pour le contexte", 53)).toBe(true);
  });

  it("🔴 #9 ne ramène PAS le travail de #95", () => {
    expect(citeLeTicket("feat: ferme #95", 9)).toBe(false);
    expect(citeLeTicket("feat: ferme #9", 9)).toBe(true);
  });

  it("un numéro qui n'y est pas ne s'invente pas", () => {
    expect(citeLeTicket("refactor: rien à voir", 53)).toBe(false);
  });

  it("le ticket collé à une ponctuation reste reconnu — c'est le cas courant", () => {
    // Vécu : « (#53=8, #83=5) » dans un compte rendu. Une borne trop stricte
    // rendrait « aucun commit » sur un commit qui existe.
    expect(citeLeTicket("board: estimations posées (#53=8, #83=5)", 53)).toBe(
      true,
    );
    expect(citeLeTicket("board: estimations posées (#53=8, #83=5)", 83)).toBe(
      true,
    );
  });
});

describe("lintBoard — un tableau cohérent ne produit rien", () => {
  it("reste muet quand jalons, ordres, statuts et dépendances se tiennent", () => {
    const findings = lintBoard({
      items: [sain(1), sain(2)],
      issues: [issueSaine(1), issueSaine(2)],
      now: MAINTENANT,
    });
    expect(findings).toEqual([]);
  });
});

describe("lintBoard — chaque incohérence est vue", () => {
  it("HORS-TABLEAU : un jalon promis mais aucun item au tableau", () => {
    const findings = lintBoard({
      items: [],
      issues: [issueSaine(187)],
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("HORS-TABLEAU");
    expect(findings[0].unlock).toContain("item-add");
  });

  it("NI-JALON-NI-BACKLOG : ni promesse de date, ni absence assumée", () => {
    const findings = lintBoard({
      items: [],
      issues: [issueSaine(5, { milestone: null })],
      now: MAINTENANT,
    });
    expect(codes(findings)).toEqual(["NI-JALON-NI-BACKLOG"]);
  });

  it("le label backlog suffit à assumer l'absence de jalon", () => {
    const findings = lintBoard({
      items: [],
      issues: [issueSaine(5, { milestone: null, labels: ["backlog"] })],
      now: MAINTENANT,
    });
    expect(findings).toEqual([]);
  });

  it("SANS-ORDRE : l'item tombe en fin de tri et n'est jamais proposé", () => {
    const findings = lintBoard({
      items: [sain(1, { ordre: undefined })],
      issues: [issueSaine(1)],
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("SANS-ORDRE");
  });

  it("ORDRE-DOUBLON : deux items au même rang, l'ordre ne tranche plus", () => {
    const findings = lintBoard({
      items: [sain(1, { ordre: 4 }), sain(2, { ordre: 4 })],
      issues: [issueSaine(1), issueSaine(2)],
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("ORDRE-DOUBLON");
  });

  it("le même rang dans DEUX jalons distincts n'est pas un doublon", () => {
    const findings = lintBoard({
      items: [sain(1, { ordre: 4 }), sain(2, { ordre: 4, milestone: "10.1" })],
      issues: [issueSaine(1), issueSaine(2, { milestone: "10.1" })],
      now: MAINTENANT,
    });
    expect(codes(findings)).not.toContain("ORDRE-DOUBLON");
  });

  it("DEPENDANCE-INVERSEE : le socle est rangé après ce qui s'y branche", () => {
    const findings = lintBoard({
      items: [sain(10, { ordre: 1 }), sain(20, { ordre: 5 })],
      issues: [issueSaine(10, { dependsOn: [20] }), issueSaine(20)],
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("DEPENDANCE-INVERSEE");
  });

  it("une dépendance déjà FERMÉE (hors tableau ouvert) ne déclenche rien", () => {
    const findings = lintBoard({
      items: [sain(10, { ordre: 1 })],
      issues: [issueSaine(10, { dependsOn: [181] })],
      now: MAINTENANT,
    });
    expect(codes(findings)).not.toContain("DEPENDANCE-INVERSEE");
  });

  it("CONTRAINTE-INVERSEE : rangé après ce qu'il doit précéder", () => {
    const findings = lintBoard({
      items: [sain(187, { ordre: 9 }), sain(175, { ordre: 5 })],
      issues: [issueSaine(187, { before: [175] }), issueSaine(175)],
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("CONTRAINTE-INVERSEE");
  });

  it("la contrainte inverse respectée ne dit rien", () => {
    const findings = lintBoard({
      items: [sain(187, { ordre: 4.5 }), sain(175, { ordre: 5 })],
      issues: [issueSaine(187, { before: [175] }), issueSaine(175)],
      now: MAINTENANT,
    });
    expect(codes(findings)).not.toContain("CONTRAINTE-INVERSEE");
  });

  it("STATUT-MENTEUR : « en cours » sans aucun commit de travail", () => {
    const findings = lintBoard({
      items: [sain(172, { status: "In Progress" })],
      issues: [issueSaine(172)],
      commits: { 172: [] },
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("STATUT-MENTEUR");
  });

  it("un commit de PILOTAGE ne vaut pas travail — c'est ce qui remonte le statut tout seul", () => {
    const findings = lintBoard({
      items: [sain(172, { status: "In Progress" })],
      issues: [issueSaine(172)],
      commits: {
        172: [
          {
            sha: "d24c7d2",
            date: "2026-09-04T11:24:00Z",
            subject: "docs(session): retex 09-04d",
          },
        ],
      },
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("STATUT-MENTEUR");
  });

  it("un commit de TRAVAIL récent justifie le statut", () => {
    const findings = lintBoard({
      items: [sain(172, { status: "In Progress" })],
      issues: [issueSaine(172)],
      commits: {
        172: [
          {
            sha: "abc1234",
            date: "2026-09-03T10:00:00Z",
            subject: "fix(pilotage): #172 borner le motif",
          },
        ],
      },
      now: MAINTENANT,
    });
    expect(codes(findings)).not.toContain("STATUT-MENTEUR");
  });

  it("un commit de travail TROP VIEUX ne le justifie plus", () => {
    const findings = lintBoard({
      items: [sain(172, { status: "In Progress" })],
      issues: [issueSaine(172)],
      commits: {
        172: [
          {
            sha: "abc1234",
            date: "2026-07-01T10:00:00Z",
            subject: "fix(pilotage): #172 borner le motif",
          },
        ],
      },
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("STATUT-MENTEUR");
  });

  it("SANS-JOURS et SANS-PRIORITE sont des avertissements, pas des erreurs", () => {
    const findings = lintBoard({
      items: [sain(1, { jours: undefined, prio: null })],
      issues: [issueSaine(1)],
      now: MAINTENANT,
    });
    expect(codes(findings).sort()).toEqual(["SANS-JOURS", "SANS-PRIORITE"]);
    expect(findings.every((f) => f.severity === "avertissement")).toBe(true);
  });

  it("PARENT-SOMME : le parent n'affiche pas la somme de ses enfants", () => {
    const findings = lintBoard({
      items: [
        sain(178, { jours: 5 }),
        sain(182, { parent: 178, jours: 2 }),
        sain(183, { parent: 178, jours: 1 }),
      ],
      issues: [issueSaine(178), issueSaine(182), issueSaine(183)],
      now: MAINTENANT,
    });
    const f = findings.find((x) => x.code === "PARENT-SOMME");
    expect(f).toBeDefined();
    expect(f.message).toContain("totalisent 3");
  });

  it("PRIORITE-ORDRE : un P0 rangé derrière un P2", () => {
    const findings = lintBoard({
      items: [
        sain(1, { ordre: 1, prio: "P3 — fin de cycle" }),
        sain(2, { ordre: 2, prio: "P0 — bloque le reste" }),
      ],
      issues: [issueSaine(1), issueSaine(2)],
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("PRIORITE-ORDRE");
  });

  it("un P0 précédé de ses PRÉREQUIS (P1, P2) ne crie pas — l'ordre encode les dépendances", () => {
    const findings = lintBoard({
      items: [
        sain(26, { ordre: 3, prio: "P2 — décision" }),
        sain(175, { ordre: 5, prio: "P0 — bloque le reste" }),
      ],
      issues: [issueSaine(26), issueSaine(175)],
      now: MAINTENANT,
    });
    expect(codes(findings)).not.toContain("PRIORITE-ORDRE");
  });

  it("un P0 en tête ne déclenche rien", () => {
    const findings = lintBoard({
      items: [
        sain(1, { ordre: 1, prio: "P0 — bloque le reste" }),
        sain(2, { ordre: 2, prio: "P2 — décision" }),
      ],
      issues: [issueSaine(1), issueSaine(2)],
      now: MAINTENANT,
    });
    expect(codes(findings)).not.toContain("PRIORITE-ORDRE");
  });
});

describe("lintBoard — la frise", () => {
  // MAINTENANT = 2026-09-04. La frise se périme dans les DEUX sens : le vécu qui
  // fonde ce contrôle était un départ dans le FUTUR (frise au 21 septembre lue un
  // 11 septembre), la dérive symétrique est un départ resté dans le passé.
  it("FRISE-DECALEE : un départ dans le futur au-delà de la tolérance", () => {
    const findings = lintBoard({
      items: [
        sain(1, { debut: "2026-09-21", cible: "2026-09-22" }),
        sain(2, { debut: "2026-09-22", cible: "2026-09-23" }),
      ],
      issues: [issueSaine(1), issueSaine(2)],
      now: MAINTENANT,
    });
    const f = findings.find((x) => x.code === "FRISE-DECALEE");
    expect(f).toBeDefined();
    expect(f.n).toBe(1); // porté par le ticket le plus ancien, une seule fois
    expect(f.message).toContain("dans 17 jours");
    expect(findings.filter((x) => x.code === "FRISE-DECALEE")).toHaveLength(1);
  });

  it("FRISE-DECALEE : un départ resté dans le passé", () => {
    const findings = lintBoard({
      items: [sain(1, { debut: "2026-08-20" })],
      issues: [issueSaine(1)],
      now: MAINTENANT,
    });
    const f = findings.find((x) => x.code === "FRISE-DECALEE");
    expect(f.message).toContain("il y a 15 jours");
  });

  it("reste muet dans la tolérance, et quand aucune date n'est posée", () => {
    const proche = lintBoard({
      items: [sain(1, { debut: "2026-09-07" })],
      issues: [issueSaine(1)],
      now: MAINTENANT,
    });
    expect(codes(proche)).not.toContain("FRISE-DECALEE");
    const sansDate = lintBoard({
      items: [sain(1), sain(2)],
      issues: [issueSaine(1), issueSaine(2)],
      now: MAINTENANT,
    });
    expect(sansDate).toEqual([]);
  });

  it("CIBLE-AVANT-DEBUT : la barre part à l'envers", () => {
    const findings = lintBoard({
      items: [sain(1, { debut: "2026-09-03", cible: "2026-09-01" })],
      issues: [issueSaine(1)],
      now: MAINTENANT,
    });
    expect(codes(findings)).toContain("CIBLE-AVANT-DEBUT");
  });

  it("FRISE-A-TROUS : un jalon daté à moitié — mais pas un jalon non planifié", () => {
    const findings = lintBoard({
      items: [
        sain(1, { debut: "2026-09-03" }),
        sain(2),
        sain(3, { milestone: "10.2.0" }),
        sain(4, { milestone: "10.2.0" }),
      ],
      issues: [
        issueSaine(1),
        issueSaine(2),
        issueSaine(3, { milestone: "10.2.0" }),
        issueSaine(4, { milestone: "10.2.0" }),
      ],
      now: MAINTENANT,
    });
    const trous = findings.filter((x) => x.code === "FRISE-A-TROUS");
    expect(trous).toHaveLength(1); // 10.2.0 n'est pas daté du tout : il se tait
    expect(trous[0].message).toContain("10.0.0");
    expect(trous[0].message).toContain("#2");
  });

  // Frise et estimation sont posées SÉPARÉMENT dans le tableau de bord : rien ne
  // les rapproche, si bien qu'un ticket de 6,5 jours pouvait porter une fenêtre
  // d'un seul jour sans que personne ne le voie (mesuré : 13 items sur 86).
  // Un plan qui promet moins de temps qu'il n'en a estimé ne tient pas.
  it("FRISE-TROP-COURTE : une fenêtre qui ne couvre pas l'estimation", () => {
    const findings = lintBoard({
      items: [
        sain(1, { debut: "2026-09-03", cible: "2026-09-03", jours: 6.5 }),
        sain(2, { debut: "2026-09-04", cible: "2026-09-04", jours: 2 }),
      ],
      issues: [issueSaine(1), issueSaine(2)],
      now: MAINTENANT,
    });
    const courts = findings.filter((x) => x.code === "FRISE-TROP-COURTE");
    // UN seul constat, porté par le plus gros écart : treize avertissements pour
    // une seule cause apprendraient à passer outre (même raison que FRISE-DECALEE).
    expect(courts).toHaveLength(1);
    expect(courts[0].n).toBe(1);
    expect(courts[0].severity).toBe("avertissement");
    expect(courts[0].message).toContain("6.5");
  });

  it("une fenêtre qui couvre l'estimation, week-end compris, se tait", () => {
    const findings = lintBoard({
      items: [
        // 4 jours calendaires de fenêtre pour 2 jours estimés.
        sain(1, { debut: "2026-09-03", cible: "2026-09-06", jours: 2 }),
        // Un ticket d'un jour tenant dans une fenêtre d'un jour : exact, donc muet.
        sain(2, { debut: "2026-09-04", cible: "2026-09-04", jours: 1 }),
        // Ni date ni estimation : rien à confronter.
        sain(3, { jours: 9 }),
      ],
      issues: [issueSaine(1), issueSaine(2), issueSaine(3)],
      now: MAINTENANT,
    });
    expect(codes(findings)).not.toContain("FRISE-TROP-COURTE");
  });
});

describe("lintBoard — les erreurs sortent avant les avertissements", () => {
  it("trie par gravité, puis par numéro", () => {
    const findings = lintBoard({
      items: [sain(9, { jours: undefined }), sain(3, { ordre: undefined })],
      issues: [issueSaine(9), issueSaine(3)],
      now: MAINTENANT,
    });
    expect(findings[0].severity).toBe("erreur");
    expect(findings.at(-1).severity).toBe("avertissement");
  });
});
