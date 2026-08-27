/// <reference types="node" />
/**
 * Les QUATRE vitrines écrivent la même chose — la sentinelle du socle commun.
 *
 * Le dépôt sert quatre pages de démonstration, une par framework de vue
 * (`src/modules/test-frontend-{react,vue,angular,svelte}`). Elles existent pour
 * une seule raison : montrer que la logique de temps réel vit dans
 * `nodefony/client` et non dans la page. Le jour où l'une d'elles a besoin
 * d'une ligne que les trois autres n'ont pas, l'extraction du noyau est
 * incomplète — et rien, autrement, ne le dirait : quatre pages qui divergent
 * s'affichent parfaitement, chacune de son côté.
 *
 * C'est pourquoi ce banc compare les quatre AU LIEU de vérifier chacune : un
 * contrôle par page laisserait passer exactement le défaut qu'on craint.
 *
 * Ce qu'il tient :
 *  1. la feuille de style commune est identique — octet pour octet ;
 *  2. les quatre pages consomment le socle par leur liaison idiomatique — de
 *     minces enveloppes, une par framework de vue, sans une règle en propre ;
 *  3. aucune ne réintroduit la mécanique que le socle porte (socket fabriquée à
 *     la main, nom d'événement local recopié, abonnement apparié à la main) ;
 *  4. les quatre montrent les mêmes sections, et se pointent l'une l'autre.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
/**
 * Racine du dépôt. Sept niveaux, comptés depuis
 * `src/packages/@nodefony/frontend/nodefony/tests/unit` : `unit` → `tests` →
 * `nodefony` → `frontend` → `@nodefony` → `packages` → `src`.
 */
const REPO = path.resolve(ICI, "..", "..", "..", "..", "..", "..", "..");

/** Les quatre vitrines : le module, sa page, et le nom qu'elle affiche. */
const VITRINES = [
  {
    front: "react",
    page: path.join("frontend", "src", "App.tsx"),
    titre: "React 19",
  },
  {
    front: "vue",
    page: path.join("frontend", "src", "App.vue"),
    titre: "Vue 3",
  },
  {
    front: "angular",
    page: path.join("frontend", "src", "app", "app.component.ts"),
    titre: "Angular 22",
  },
  {
    front: "svelte",
    page: path.join("frontend", "src", "App.svelte"),
    titre: "Svelte 5",
  },
] as const;

const moduleDe = (front: string) =>
  path.join(REPO, "src", "modules", `test-frontend-${front}`);

const lire = (front: string, relatif: string) =>
  readFileSync(path.join(moduleDe(front), relatif), "utf8");

describe("vitrines — la feuille de style est la MÊME dans les quatre", () => {
  it("empreintes identiques (une charte par front dériverait en silence)", () => {
    const empreintes = new Map<string, string[]>();
    for (const { front } of VITRINES) {
      const css = lire(front, path.join("frontend", "src", "showcase.css"));
      const somme = createHash("sha256").update(css).digest("hex").slice(0, 12);
      empreintes.set(somme, [...(empreintes.get(somme) ?? []), front]);
    }
    expect(
      [...empreintes.entries()].map(
        ([somme, fronts]) => `${somme}: ${fronts.join(",")}`,
      ),
      "les showcase.css ont divergé",
    ).toHaveLength(1);
  });

  it("la charte reprend les jetons de la page d'accueil du framework", () => {
    // La source, c'est `nodefony/views/index.eta` : trois couleurs, celles du
    // logo. Une palette inventée pour les vitrines aurait fait deux identités
    // visuelles pour un seul produit.
    const accueil = readFileSync(
      path.join(REPO, "nodefony", "views", "index.eta"),
      "utf8",
    );
    const css = lire("react", path.join("frontend", "src", "showcase.css"));
    for (const jeton of ["--blue: #096bbf", "--fg: #0e1726", "--bg: #fafbfd"]) {
      expect(accueil, `l'accueil ne porte plus ${jeton}`).toContain(jeton);
      expect(css, `la vitrine a perdu ${jeton}`).toContain(jeton);
    }
  });
});

/**
 * Par quoi chaque vitrine s'abonne — la grappe #54 est complète, les QUATRE
 * fronts ont leur liaison.
 *
 * Une liaison PUBLIÉE que sa propre vitrine n'emploie pas n'est exercée par
 * personne : elle serait gelée SemVer sans avoir jamais été confrontée à un
 * usage réel. C'est pour cette raison que cette table est une EXIGENCE et non
 * une tolérance — dès que `nodefony/<front>` existe, la vitrine du front doit
 * l'employer, et le socle direct n'y est plus acceptable.
 *
 * Cette table reste, et c'est voulu : elle dit par QUOI chaque page s'abonne.
 * Le jour où une cinquième liaison arrive, ou où l'une des quatre régresse vers
 * un appel direct au socle, c'est ici que ça se voit.
 */
const LIAISONS: Record<
  string,
  { jetons: string[]; instantane: string; cite: string; pourquoi: string }
> = {
  react: {
    jetons: [
      '<NodefonyProvider url="/api/live/realtime">',
      'useNodefonyChannel(\n    "live:salon"',
    ],
    instantane: "observeSnapshot(",
    cite: "useNodefonyState()",
    pourquoi: "React a ses hooks (`nodefony/react`)",
  },
  vue: {
    jetons: [
      "useNodefony()",
      "useNodefonyState()",
      'useNodefonyChannel("live:salon"',
    ],
    instantane: "useNodefonySnapshot()",
    cite: "useNodefonyState()",
    pourquoi: "Vue a ses composables (`nodefony/vue`)",
  },
  angular: {
    jetons: [
      "injectNodefony()",
      "injectNodefonyState()",
      'injectNodefonyChannel("live:salon"',
    ],
    instantane: "injectNodefonySnapshot()",
    cite: "injectNodefonyState()",
    pourquoi: "Angular a ses fonctions d'injection (`nodefony/angular`)",
  },
  svelte: {
    jetons: ["nodefony()", "nodefonyState()", 'nodefonyChannel("live:salon"'],
    instantane: "nodefonySnapshot()",
    cite: "nodefonyState()",
    pourquoi: "Svelte a ses liaisons (`nodefony/svelte`)",
  },
};

describe("vitrines — les quatre consomment le SOCLE, aucune ne le réécrit", () => {
  it("chacune s'abonne par SA liaison quand elle existe, par le socle sinon", () => {
    for (const { front } of VITRINES) {
      const src = lire(front, VITRINES.find((v) => v.front === front)!.page);
      const liaison = LIAISONS[front]!;
      for (const jeton of liaison.jetons) {
        expect(
          src,
          `${front} : attendu \`${jeton}\` — ${liaison.pourquoi}`,
        ).toContain(jeton);
      }
      // L'auto-observation passe par UN contrat, pas par cinq lectures à la
      // main : c'est ce qui empêche les quatre sondes de barre de diverger.
      expect(src, `${front} : la sonde lit un instantané du socle`).toContain(
        liaison.instantane,
      );
      // L'adresse aussi vient de l'instantané. Écrite en dur, elle survivrait
      // au changement d'endpoint et mentirait — c'est le défaut qu'une vitrine
      // portait, et qu'aucun contrôle ne voyait : elle S'AFFICHAIT très bien.
      expect(
        src.replace(/\s+/g, " "),
        `${front} : l'adresse doit venir de l'instantané, pas d'un littéral`,
      ).not.toContain("<dd>/api/live/realtime</dd>");
      for (const brut of [
        "subscribedChannels",
        "framesReceived",
        "lastFrameAt",
        "lastFrameMethod",
      ]) {
        expect(
          src,
          `${front} : ${brut} se lit dans l'instantané, pas sur le client`,
        ).not.toContain(`socket.${brut}`);
      }
      // Ce que les quatre doivent DÉMONTRER, et pas seulement câbler.
      expect(
        src,
        `${front} : le message envoyé doit porter le nom de sa vitrine`,
      ).toContain('emit("live:dire", { texte: dit, front: FRONT })');
      expect(src, `${front} : la même action par les deux portes`).toContain(
        `/${front}/api/data`,
      );
    }
  });

  it("aucune ne réintroduit ce que le socle porte", () => {
    for (const { front, page } of VITRINES) {
      const src = lire(front, page);
      // Les trois recopies que l'extraction a supprimées. Chacune s'affiche
      // parfaitement tant qu'on ne coupe pas le réseau — d'où ce refus écrit.
      expect(src, `${front} : socket fabriquée à la main`).not.toContain(
        "RealtimeClient.shared(",
      );
      expect(src, `${front} : nom d'événement local recopié`).not.toContain(
        "__state__",
      );
      expect(src, `${front} : abonnement apparié à la main`).not.toContain(
        'live.socket.subscribe("live:ticker")',
      );
      expect(src, `${front} : WebSocket brut`).not.toContain("new WebSocket(");
      // La règle en creux, celle qui se perd le plus vite : la socket appartient
      // à la PAGE, pas au composant. Il n'existe donc qu'UNE seule coupure dans
      // toute la page — celle du bouton de démonstration, déclenchée par
      // l'utilisateur. Une seconde ne peut venir que d'un démontage, qui
      // trancherait les requêtes en vol des autres consommateurs.
      //
      // Compter plutôt que localiser : une première version cherchait la
      // coupure « après le démontage », et sa tranche commençait à l'IMPORT de
      // `onDestroy` — donc au fichier entier. Elle n'a jamais pu échouer.
      const coupures = src.split(".disconnect()").length - 1;
      expect(
        coupures,
        `${front} : une seule coupure attendue (le bouton) — une autre couperait les consommateurs de la socket partagée`,
      ).toBe(1);
    }
  });
});

describe("vitrines — le même écran, et de quoi le comparer", () => {
  it("les mêmes sections, mot pour mot", () => {
    // Ces phrases SONT la démonstration : si l'une manque, la page ne raconte
    // plus la même histoire que ses trois sœurs.
    const communes = [
      "Ce que cette socket change",
      // Les deux démonstrations : le fan-out serveur, et l'action bi-transport.
      "Le serveur pousse à TOUS",
      "Une action, deux transports",
      "Couper la connexion",
      "Ce que la page fait quand elle DEMANDE",
      "Rechargement à chaud",
      // La sonde de socket et la bascule de la barre de debug, dans la barre.
      "Barre de debug",
      "sonde-detail",
    ];
    for (const { front, page } of VITRINES) {
      const src = lire(front, page);
      for (const phrase of communes) {
        expect(src, `${front} n'a pas « ${phrase} »`).toContain(phrase);
      }
    }
  });

  it("aucune ne réintroduit un battement périodique", () => {
    // Une trame par seconde et par client, pour ne rien dire, coûte du réseau
    // et du processeur en permanence — et enseigne l'inverse de ce que le
    // framework défend. Le canal a été retiré du serveur ; ce refus empêche
    // qu'il revienne par une page.
    for (const { front, page } of VITRINES) {
      const src = lire(front, page);
      expect(
        src,
        `${front} : un battement périodique est revenu`,
      ).not.toContain("live:ticker");
    }
  });

  it("chacune pointe les TROIS autres — c'est ce qui permet de les comparer", () => {
    for (const { front, page } of VITRINES) {
      const src = lire(front, page);
      for (const autre of VITRINES) {
        // La barre porte les QUATRE (dont la page courante, marquée) ; le pied
        // renvoie aux TROIS autres. Un front étranger doit donc apparaître deux
        // fois — ne compter qu'une occurrence laissait le retirer de la barre
        // sans que rien ne tombe, le pied suffisant à satisfaire la garde.
        const attendu = autre.front === front ? 1 : 2;
        const liens = src.split(`/${autre.front}/app`).length - 1;
        expect(
          liens,
          `${front} : ${attendu === 1 ? "la barre doit se marquer elle-même" : "la barre ET le pied doivent mener à " + autre.front}`,
        ).toBeGreaterThanOrEqual(attendu);
      }
      expect(src, `${front} n'affiche pas son propre nom`).toContain(
        VITRINES.find((v) => v.front === front)!.titre,
      );
    }
  });

  it("chacune montre le code qu'elle EXÉCUTE, pas un extrait décoratif", () => {
    for (const { front, page } of VITRINES) {
      const src = lire(front, page);
      // Le bloc montré à l'écran cite les mêmes appels que ceux plus haut dans
      // le fichier : un extrait qui se périme est pire qu'aucun extrait.
      const cite = LIAISONS[front]!.cite;
      // (l'extrait affiché cite le même appel que le câblage réel, plus haut)
      const occurrences = src.split(cite).length - 1;
      expect(
        occurrences,
        `${front} : l'extrait affiché doit citer un appel réel (${cite})`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
