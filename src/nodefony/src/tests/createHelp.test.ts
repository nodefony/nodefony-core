/**
 * L'aide de `nodefony create` — une page par type, éprouvée sur son RENDU.
 *
 * Ce que ces contrôles protègent, par ordre d'importance :
 *
 * 1. **La dérivation MORD.** Les options viennent de la spec du scaffold, pas
 *    d'une recopie. Un choix ajouté à `spec.ts` doit apparaître dans l'aide
 *    sans que personne y pense — c'était le défaut d'avant, où la section « CE
 *    QUE CHAQUE TYPE ACCEPTE » recopiait sept listes à la main.
 * 2. **Rien ne déborde.** Une page qui dépasse la largeur se replie sur la
 *    marge du terminal, et l'aide devient illisible au moment précis où on la
 *    demande. La mesure se fait en CARACTÈRES : un `awk` compterait des octets,
 *    et une page en français « déborderait » à chaque accent.
 * 3. **Une page parle de SON type.** `create app --help` rendait les sept.
 *
 * Le socle (`usageReport`) n'avait AUCUN test alors qu'il sert dix commandes :
 * c'est ici qu'il en gagne un.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import {
  usageCatalog,
  usagePageFor,
  optionsFor,
  type TScaffoldType,
} from "../cli/scaffold/help";
import { renderUsage } from "../cli/usageReport";
import { createPalette } from "../kernel/checks/report";
import { getScaffoldSpec, flagFor } from "../cli/scaffold/spec";

const TYPES: readonly TScaffoldType[] = [
  "app",
  "module",
  "controller",
  "service",
  "front",
  "entity",
  "command",
];

/** Le rendu SANS couleur, découpé en lignes — ce qu'un journal de CI reçoit. */
const rendu = (page: ReturnType<typeof usageCatalog>, largeur = 80): string[] =>
  renderUsage(page, createPalette(false), largeur).split("\n");

describe("create --help — une page par type, dérivée de la spec", () => {
  it("🔴 chaque question de la spec apparaît dans l'aide de son type", () => {
    // LE contrôle anti-dérive. Il tombe si l'aide se remet à recopier, ou si
    // une question naît sans que l'aide la serve — les deux sont arrivés.
    const manquants: string[] = [];
    for (const type of TYPES) {
      const [spec] = getScaffoldSpec(type);
      const page = rendu(usagePageFor(type)).join("\n");
      for (const q of spec.questions) {
        if (q.key === "name") continue; // positionnel, il est au synopsis
        if (!page.includes(flagFor(q))) manquants.push(`${type}.${q.key}`);
      }
    }
    assert.deepEqual(
      manquants,
      [],
      "questions absentes de l'aide de leur type",
    );
  });

  it("🔴 les valeurs permises viennent de la spec, pas d'une recopie", () => {
    // Le cas concret : les moteurs frontend. Si l'un est ajouté à `spec.ts` et
    // que l'aide ne bouge pas, c'est qu'une seconde liste est réapparue.
    const [spec] = getScaffoldSpec("app");
    const frontend = spec.questions.find((q) => q.key === "frontend");
    assert.isDefined(frontend);
    const terme = optionsFor("app").find((o) =>
      o.term.startsWith("--frontend"),
    );
    assert.isDefined(terme);
    for (const c of frontend!.choices ?? []) {
      assert.include(terme!.term, c.value, `valeur absente : ${c.value}`);
    }
  });

  it("🔴 le DÉFAUT de chaque option est dit — sinon il faut lancer pour le voir", () => {
    const preset = optionsFor("app").find((o) => o.term.startsWith("--preset"));
    assert.isDefined(preset);
    assert.include(preset!.text, "défaut : complete");
  });

  it("🔴 aucun drapeau n'apparaît deux fois", () => {
    // Vécu : `--git-hooks` sortait de la spec ET d'une liste écrite à la main,
    // et la page le montrait deux fois de suite.
    for (const type of TYPES) {
      const flags = rendu(usagePageFor(type))
        .map((l) => /^ {2}(--[a-z-]+)/u.exec(l)?.[1])
        .filter((f): f is string => f !== undefined);
      const doublons = flags.filter((f, i) => flags.indexOf(f) !== i);
      assert.deepEqual(doublons, [], `drapeaux en double dans ${type}`);
    }
  });

  it("🔴 un booléen VRAI par défaut se nomme `--no-…`, sinon l'aide ment", () => {
    // Un drapeau qui ne change rien n'est pas une option, c'est un piège :
    // `--controller` sur `create entity` annonçait un geste alors que le
    // controller est posé de toute façon. Le drapeau CANONIQUE est celui qui
    // agit — et c'est lui que l'aide doit montrer.
    const fautifs: string[] = [];
    for (const type of TYPES) {
      const [spec] = getScaffoldSpec(type);
      for (const q of spec.questions) {
        if (q.type !== "boolean") continue;
        const nie = flagFor(q).startsWith("--no-");
        if ((q.default === true) !== nie) {
          fautifs.push(`${type}.${q.key} (${flagFor(q)}, défaut ${q.default})`);
        }
      }
    }
    assert.deepEqual(fautifs, [], "drapeau booléen qui contredit son défaut");
  });

  it("🔴 le texte du défaut suit la SPEC, pas la forme du drapeau", () => {
    const controller = optionsFor("entity").find((o) =>
      o.term.startsWith("--no-controller"),
    );
    assert.isDefined(controller);
    assert.include(controller!.text, "actif par défaut");
    assert.notInclude(controller!.text, "inactif");
  });

  it("🔴 une page ne parle QUE de son type", () => {
    const page = rendu(usagePageFor("app"));
    assert.include(page[1] ?? "", "nodefony create app");
    // Le catalogue nomme les sept types en colonne de gauche ; la page d'un
    // type ne doit pas les redonner.
    const autres = TYPES.filter((t) => t !== "app");
    for (const t of autres) {
      assert.notMatch(
        page.join("\n"),
        new RegExp(`^ {2}${t} {2,}`, "mu"),
        `la page de app liste ${t}`,
      );
    }
  });

  it("🔴 le catalogue, lui, nomme les sept et renvoie à leur page", () => {
    const page = rendu(usageCatalog()).join("\n");
    for (const t of TYPES) {
      assert.match(
        page,
        new RegExp(`^ {2}${t} {2,}`, "mu"),
        `type absent : ${t}`,
      );
    }
    assert.include(page, "nodefony create <type> --help");
  });

  it("🔴 rien ne déborde, à toutes les largeurs — mesuré en CARACTÈRES", () => {
    // 🔴 Le socle bornait la COLONNE, pas la LIGNE : `--database
    // <sqlite|postgres|mariadb|mysql>` fait 42 caractères et poussait sa glose
    // vingt colonnes au-delà du terminal.
    for (const largeur of [80, 60, 48]) {
      for (const page of [
        usageCatalog(),
        ...TYPES.map((t) => usagePageFor(t)),
      ]) {
        // Une section PRÉ-COMPOSÉE (`lines`) est alignée en colonnes : la
        // replier lui ferait perdre son sens, et c'est précisément pourquoi le
        // socle la rend telle quelle. Elle tient à 80 — la largeur de
        // référence — et pas en dessous, ce qui est assumé.
        let preComposee = false;
        for (const l of rendu(page, largeur)) {
          if (/^ {2}[A-ZÀ-Ý].*─/u.test(l)) {
            preComposee = l.includes("GRAMMAIRE DES CHAMPS");
          }
          if (preComposee && largeur < 80) continue;
          // Un terme d'un seul tenant ne se coupe pas : le couper le rendrait
          // incopiable. Seul le texte doit tenir.
          if (/^\s*\S+$/u.test(l)) continue;
          // Une COMMANDE non plus ne se replie pas — la couper la rendrait
          // fausse, et c'est pour être collée telle quelle qu'elle est là. Elle
          // doit tenir dans un terminal ORDINAIRE (80) ; en dessous, c'est la
          // PROSE qu'on mesure, c'est-à-dire le repli.
          // Un DRAPEAU et ses valeurs ne se coupent pas davantage qu'une
          // commande : le socle lui donne sa ligne quand il est long, et cette
          // ligne fait la taille qu'elle fait.
          // Et une commande CITÉE entre accents graves non plus : `wrap` la
          // tient pour une unité (`unbreakableUnits`), délibérément — une
          // commande coupée en deux n'est plus une commande.
          const insecable =
            /^\s*(usage : |          )?nodefony /u.test(l) ||
            /^ {2}-\S*( [<[][^\]>]*[\]>])?$/u.test(l) ||
            /^\s*`/u.test(l);
          if (insecable && largeur < 80) continue;
          assert.isAtMost(
            [...l].length,
            largeur,
            `ligne trop longue à ${largeur} : ${l}`,
          );
        }
      }
    }
  });

  it("🔴 chaque page porte un exemple COMPLET et ses codes de sortie", () => {
    for (const type of TYPES) {
      const page = usagePageFor(type);
      assert.isNotEmpty(page.examples, `${type} : aucun exemple`);
      for (const e of page.examples) {
        assert.include(
          e.term,
          `nodefony create ${type}`,
          `${type} : exemple partiel`,
        );
      }
      assert.isNotEmpty(page.exitCodes ?? [], `${type} : aucun code de sortie`);
    }
  });
});
