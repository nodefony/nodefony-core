/**
 * `doctor --live` — l'étage 2, celui qui DEMANDE à l'application.
 *
 * Ce que ces tests protègent : **rien n'est recalculé ici**. Les verdicts de
 * migration et la cohérence du firewall ont déjà des producteurs, et le dépôt
 * interdit d'en écrire une seconde version — une seconde vérité qui diverge est
 * pire qu'aucune. Chaque cas vérifie donc que la phrase et le geste RENDUS sont
 * exactement ceux que le producteur a écrits.
 *
 * L'autre moitié est plus importante encore : **l'absence d'un producteur n'est
 * pas un quitus.** Une application sans ORM ne « n'a pas de problème de
 * migration » — on ne lui a pas demandé, et ça doit se lire dans le rapport.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  collectLiveReport,
  liveNotRun,
  LIVE_FAMILIES,
} from "../kernel/checks/live";
import { attachLive, type ICheckReport } from "../kernel/checks/runCheck";
import { countFindings, controlesSautes } from "../kernel/checks/report";
import type { IAdminApi, IAdminEndpoint } from "../types/IAdminApi";
import { localOperatorCaller } from "../kernel/adminPlane/adminCaller";

/** Un producteur d'administration réduit à ce que la lecture en attend. */
const producteur = (
  espace: string,
  chemin: string,
  reponse: unknown,
): IAdminApi =>
  ({
    adminNamespace: espace,
    adminDescriptor: () => ({ name: espace, title: espace }),
    adminEndpoints: (): IAdminEndpoint[] => [
      { path: chemin, method: "GET", handler: () => reponse },
    ],
  }) as unknown as IAdminApi;

const brokerDe = (...apis: IAdminApi[]) => ({ list: () => apis });

/** Un firewall cohérent — le décor « rien à signaler » de la sécurité. */
const firewallSain = producteur("security", "firewall", {
  configValid: true,
  configError: null,
});

/**
 * Des migrations à jour — le décor « rien à signaler » de l'ORM.
 *
 * 🔴 `"up-to-date"`, le mot que le producteur rend VRAIMENT. Ce décor posait
 * `"ok"` — une valeur qui n'existe dans aucune énumération du produit — et le
 * contrôle comparait à `"ok"` lui aussi : les deux erreurs se validaient l'une
 * l'autre. Une base parfaitement à jour était donc rapportée comme un
 * manquement pendant que le décor jurait le contraire. Un décor qui parle une
 * autre langue que le produit valide n'importe quoi.
 */
const VERDICT_SAIN = "up-to-date";
const VERDICT_DERIVE = "divergent";

const migrationsSaines = producteur("orm", "migrations", {
  formatVersion: 1,
  connector: "default",
  verdict: VERDICT_SAIN,
  summary: "tout est appliqué",
  nextActions: [],
  sources: [],
});

const lire = (broker: ReturnType<typeof brokerDe> | undefined) =>
  collectLiveReport(broker, localOperatorCaller());

describe("doctor --live — le vocabulaire du producteur", () => {
  it("🔴 les verdicts du décor sont ceux que le module ORM rend VRAIMENT", () => {
    // Le contrôle comparait le verdict à « ok », et ce décor posait « ok » :
    // les deux inventaient le même mot, qui n'existe nulle part dans le
    // produit. Une base à jour était donc rapportée comme un manquement, en
    // portant sa propre phrase — « le connecteur est à jour » — sous un ✗.
    //
    // Le cœur ne peut pas IMPORTER l'énumération (elle vit dans un module
    // qu'il ne connaît pas : la dépendance va dans l'autre sens). On la LIT
    // donc au source, quand le module est là. Absent, le cas se SAUTE en le
    // disant : un contrôle muet vaudrait quitus, et c'est précisément ainsi
    // qu'on n'a rien vu.
    const source = path.resolve(
      import.meta.dirname,
      "../../../packages/@nodefony/drizzle/nodefony/src/migrator/explain.ts",
    );
    if (!existsSync(source)) {
      console.warn(
        "SAUTÉ — le module @nodefony/drizzle n'est pas dans cet arbre : " +
          "le vocabulaire des verdicts n'a PAS été confronté à sa source.",
      );
      return;
    }
    const texte = readFileSync(source, "utf8");
    const bloc = texte.slice(
      texte.indexOf("export type MigrationVerdictName"),
      texte.indexOf(";", texte.indexOf("export type MigrationVerdictName")),
    );
    const connus = new Set(
      [...bloc.matchAll(/"([a-z-]+)"/gu)].map((m) => m[1] as string),
    );
    // Un motif qui ne trouve rien rendrait ce contrôle vert à vide.
    assert.isAbove(
      connus.size,
      3,
      "l'énumération n'a pas été reconnue — ce contrôle ne prouve plus rien",
    );
    // Les verdicts que CE fichier emploie, nommés — pas devinés par un
    // `JSON.stringify` du décor : la donnée y vit derrière un handler, et le
    // motif ne trouvait rien. Ce garde-fou était donc vert à vide, exactement
    // le défaut qu'il prétend interdire.
    for (const mot of [VERDICT_SAIN, VERDICT_DERIVE, "failed"]) {
      assert.isTrue(
        connus.has(mot),
        `« ${mot} » n'est pas un verdict du migrateur — connus : ${[...connus].join(", ")}`,
      );
    }
  });
});

describe("doctor --live — ce que seule l'application démarrée sait", () => {
  it("une base à jour et un firewall cohérent : les deux ont TOURNÉ, rien à dire", async () => {
    const live = await lire(brokerDe(migrationsSaines, firewallSain));
    assert.deepEqual(live.findings, []);
    assert.isTrue(live.execution.migrations.ran);
    assert.isTrue(live.execution.firewall.ran);
  });

  it("🔴 un verdict de migration rend la phrase ET le geste du PRODUCTEUR, tels quels", async () => {
    const live = await lire(
      brokerDe(
        producteur("orm", "migrations", {
          verdict: VERDICT_DERIVE,
          summary:
            "Le connecteur « default » ne concorde plus avec son historique",
          nextActions: [
            { command: "git checkout -- migrations/", args: ["checkout"] },
          ],
        }),
        firewallSain,
      ),
    );
    assert.lengthOf(live.findings, 1);
    assert.equal(live.findings[0]?.kind, "migrations-not-ok");
    // Ni reformulée ni résumée : c'est le producteur qui sait pourquoi.
    assert.equal(
      live.findings[0]?.message,
      "Le connecteur « default » ne concorde plus avec son historique",
    );
    assert.equal(live.findings[0]?.action, "git checkout -- migrations/");
    assert.equal(live.findings[0]?.source, "orm/migrations");
  });

  it("⭐ une ZONE CONTRADICTOIRE est remontée — le firewall la connaît, personne ne la lit", async () => {
    // Le firewall pose son erreur au boot et loggue en CRITIC pendant que le
    // boot CONTINUE : sans cette porte, la contradiction reste dans un journal
    // que personne ne rouvre, et l'application sert en repli fermé.
    const live = await lire(
      brokerDe(
        migrationsSaines,
        producteur("security", "firewall", {
          configValid: false,
          configError: 'zone "api" : authenticator "does-not-exist" inconnu',
        }),
      ),
    );
    assert.lengthOf(live.findings, 1);
    assert.equal(live.findings[0]?.kind, "firewall-config-invalid");
    assert.include(live.findings[0]?.message ?? "", "does-not-exist");
    assert.include(live.findings[0]?.message ?? "", "repli fermé");
  });

  it("les deux familles sont INDÉPENDANTES : l'une tombe, l'autre parle", async () => {
    const live = await lire(
      brokerDe(
        producteur("orm", "migrations", {
          verdict: "failed",
          summary: "cassé",
        }),
        producteur("security", "firewall", {
          configValid: false,
          configError: "zone incohérente",
        }),
      ),
    );
    assert.lengthOf(live.findings, 2);
  });
});

describe("doctor --live — une absence n'est JAMAIS un quitus", () => {
  it("aucun ORM chargé : la famille est NON CONTRÔLÉE, pas « sans problème »", async () => {
    const live = await lire(brokerDe(firewallSain));
    assert.deepEqual(live.findings, []);
    assert.isFalse(live.execution.migrations.ran);
    assert.include(live.execution.migrations.reason ?? "", "aucun ORM chargé");
    assert.isTrue(live.execution.firewall.ran);
  });

  it("aucun module de sécurité : idem, et l'ORM continue de répondre", async () => {
    const live = await lire(brokerDe(migrationsSaines));
    assert.isFalse(live.execution.firewall.ran);
    assert.include(
      live.execution.firewall.reason ?? "",
      "aucun module de sécurité",
    );
    assert.isTrue(live.execution.migrations.ran);
  });

  it("aucun broker du tout : les deux familles se taisent, en le DISANT", async () => {
    const live = await lire(undefined);
    assert.isFalse(live.execution.migrations.ran);
    assert.isFalse(live.execution.firewall.ran);
  });

  it("🔴 une base SANS migrations versionnées n'est pas une panne — et se distingue", async () => {
    // Une base NoSQL résorbe l'écart autrement. Compter ça comme un manquement
    // ferait passer une architecture pour un défaut.
    const live = await lire(
      brokerDe(
        producteur("orm", "migrations", {
          status: 501,
          body: {
            formatVersion: 1,
            connector: "default",
            error: {
              code: "NF_MIGRATE_NO_MIGRATIONS",
              summary: "MongoDB ne se met pas à jour par migrations de schéma.",
              nextActions: [],
            },
          },
        }),
        firewallSain,
      ),
    );
    assert.deepEqual(live.findings, []);
    assert.isFalse(live.execution.migrations.ran);
    assert.include(live.execution.migrations.reason ?? "", "MongoDB");
    assert.equal(live.execution.migrations.short, "sans migrations");
  });

  it("🔴 un producteur qui répond SANS le champ attendu ne vaut pas quitus", async () => {
    // Le silence d'un format inattendu se lisait comme « valide ». C'est la
    // même règle que partout : un contrôle qui n'a rien compris n'a rien vu.
    const live = await lire(
      brokerDe(
        producteur("orm", "migrations", { formatVersion: 99 }),
        producteur("security", "firewall", { zones: [] }),
      ),
    );
    assert.deepEqual(live.findings, []);
    assert.isFalse(live.execution.migrations.ran);
    assert.equal(live.execution.migrations.short, "format inattendu");
    assert.isFalse(live.execution.firewall.ran);
    assert.equal(live.execution.firewall.short, "format inattendu");
  });
});

describe("doctor --live — la greffe sur le rapport statique", () => {
  /** Un rapport statique minimal, tel que la lecture pure le produit. */
  const statique = (): ICheckReport => ({
    root: "/app",
    appName: "app",
    scanned: 1,
    findings: [],
    wiring: { scanned: 1, findings: [] },
    readiness: {
      findings: [],
      catalogUnreadable: false,
      portsProbed: [],
      trackedUnknown: null,
    },
    freshness: { findings: [], notComparable: false },
    // Le décor de surface : rien d'ouvert, rien à contredire. Il est EXPLICITE
    // parce que le rapport le porte — un champ absent faisait lever le compteur
    // de manquements, et le test accusait la mise en page.
    surface: {
      findings: [],
      openings: [],
      scanned: 1,
      dialect: "sqlite" as const,
      dialectFrom: "défaut du connecteur",
      entitiesScanned: 0,
    },
    guards: {
      findings: [],
      armed: 5,
      linterUnreadable: false,
      manifestUnreadable: false,
    },
    lastBoots: [],
    exceptions: 0,
    execution: {
      freshness: { ran: true },
      readiness: { ran: true },
      envCatalog: { ran: true },
      envTracked: { ran: true },
      deps: { ran: true },
      wiring: { ran: true },
      surface: { ran: true },
      guards: { ran: true },
      dialect: { ran: true },
      migrations: { ran: false, reason: "non demandé", short: "non demandé" },
      firewall: { ran: false, reason: "non demandé", short: "non demandé" },
      gating: { ran: false, reason: "non demandé", short: "non demandé" },
    },
    // 🔴 Pas de `as unknown as` : il ANNULE le typecheck, et c'est lui qui a
    // laissé ce décor incomplet quand une famille est née — le rendu tombait
    // alors sur un `undefined.findings`, et le test accusait le rendu.
  });

  it("🔴 la greffe REMPLACE les familles ayant tourné, elle ne s'ajoute pas à côté", async () => {
    const live = await lire(brokerDe(migrationsSaines, firewallSain));
    const greffe = attachLive(statique(), live);
    assert.isTrue(greffe.execution.migrations.ran);
    assert.isTrue(greffe.execution.firewall.ran);
    // Deux états pour un même contrôle, et le sommaire cesserait de dire vrai :
    // aucune des deux familles interrogées ne doit rester dans les sautés.
    const sautes = controlesSautes(greffe.execution).map((c) => c.famille);
    assert.notInclude(sautes, "migrations");
    assert.notInclude(sautes, "firewall");
    // `gating` reste sautée, et c'est EXACT : ce décor ne vise aucun
    // environnement, donc il n'y a rien à comparer. Le dire ici évite qu'un
    // « 0 sauté » écrit en dur transforme un angle mort en quitus.
    assert.include(sautes, "gating");
  });

  it("l'entrée n'est pas modifiée — le rapport statique reste ce qu'il était", async () => {
    const avant = statique();
    attachLive(avant, await lire(brokerDe(migrationsSaines, firewallSain)));
    assert.isFalse(avant.execution.migrations.ran);
  });

  it("⭐ un manquement de l'étage 2 PÈSE dans le compte — même fonction que le rendu", async () => {
    const live = await lire(
      brokerDe(
        producteur("orm", "migrations", {
          verdict: "failed",
          summary: "cassé",
        }),
        firewallSain,
      ),
    );
    // C'est ce compte qui décide du code de sortie ET du bilan chiffré : deux
    // additions écrites à deux endroits avaient déjà divergé.
    assert.equal(countFindings(attachLive(statique(), live)), 1);
    assert.equal(countFindings(statique()), 0);
  });

  it("sans boot, TOUTES les familles d'étage 2 sont annoncées « non contrôlé » avec leur geste", () => {
    const absent = liveNotRun(
      "il faut démarrer l'application",
      "`doctor --live`",
    );
    const sautes = controlesSautes(attachLive(statique(), absent).execution);
    // Dérivé : une famille d'étage 2 ajoutée sans état serait affichée en vert
    // sans que rien ne l'ait regardée — exactement ce que ce module combat.
    assert.lengthOf(sautes, LIVE_FAMILIES.length);
    assert.equal(sautes[0]?.unlock, "`doctor --live`");
  });
});
