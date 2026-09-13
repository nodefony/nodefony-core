import { describe, it } from "vitest";
import { expect } from "chai";
import { defineConfig, isConfigDescriptor } from "../config/defineConfig";
import {
  isForeignDescriptor,
  diagnoseEmptyManifest,
  foreignPackageWarning,
} from "../kernel/bootConfigDiagnosis";

/**
 * SPEC — « la marque d'un descripteur de config doit traverser DEUX instances du
 * module `nodefony` chargées dans le même process ».
 *
 * Ce n'est pas un cas de laboratoire, c'est le poste de travail de l'auteur du
 * framework : un binaire lié globalement vers le dépôt (`npm link`, ou un lien
 * dans `~/.local/bin`) exécute le Kernel depuis les sources, pendant que la
 * configuration de l'application importe `nodefony` depuis SON `node_modules`.
 * Deux instances, deux fois le même fichier, et une marque posée par l'une que
 * l'autre doit reconnaître.
 *
 * Vécu le 2026-09-13 : avec un `Symbol()` privé, `nodefony dev` échouait
 * systématiquement (`modules: []`, aucun serveur, sortie 69) là où `npm run dev`
 * réussissait, sur la MÊME application — et le diagnostic accusait une
 * configuration qui était juste. Le remède est le registre GLOBAL de symboles
 * (`Symbol.for`), partagé par tout le process.
 */
describe("descripteur de config — la marque traverse deux instances du module", () => {
  it("la marque vit dans le registre GLOBAL, pas dans l'instance", () => {
    const desc = defineConfig({ modules: [] });
    const marques = Object.getOwnPropertySymbols(desc);
    expect(marques.length, "le descripteur porte une marque").to.be.greaterThan(
      0,
    );
    // `Symbol.keyFor` ne rend une clé QUE pour un symbole du registre global.
    // Avec `Symbol()`, il rend `undefined` — et la marque meurt à la frontière
    // de l'instance, sans qu'aucune erreur ne soit levée.
    const clés = marques.map((s) => Symbol.keyFor(s));
    expect(
      clés,
      "aucune marque n'est dans le registre global : une AUTRE instance du " +
        "module ne pourra pas la lire, et le Kernel repliera en silence sur " +
        "defaultAppConfig (modules: [])",
    ).to.include("nodefony.configDescriptor");
  });

  it("un descripteur marqué par une AUTRE instance est reconnu", () => {
    // Simule l'instance distante : elle pose la marque par le registre global,
    // sans passer par le `defineConfig` de CETTE instance.
    const marqueDistante = Symbol.for("nodefony.configDescriptor");
    const venuDAilleurs = {
      [marqueDistante]: true,
      resolve: () => ({}) as never,
    };
    expect(
      isConfigDescriptor(venuDAilleurs),
      "un descripteur produit par une autre instance du module doit être reconnu",
    ).to.equal(true);
  });

  it("un objet nu n'est toujours PAS un descripteur", () => {
    // Le registre global ne doit pas ouvrir la porte à n'importe quoi : la
    // marque reste non exportée, donc indevinable depuis du code applicatif.
    expect(isConfigDescriptor({})).to.equal(false);
    expect(isConfigDescriptor({ resolve: () => ({}) })).to.equal(false);
    expect(isConfigDescriptor(null)).to.equal(false);
  });
});

/*
 *   La GARDE — ce qui reste debout même si le remède ci-dessus est défait.
 *
 *   `Symbol.for` referme le cas connu, mais un `Symbol()` privé réintroduit un
 *   jour, ou une dualité venue d'ailleurs, produirait le même silence. La garde
 *   reconnaît la SIGNATURE du problème à l'exécution — une marque à la bonne
 *   description, d'une identité étrangère — et fait NOMMER la cause au boot au
 *   lieu de laisser replier sur `defaultAppConfig`.
 */
describe("isForeignDescriptor — la garde reconnaît une marque venue d'ailleurs", () => {
  /** Simule l'autre instance : même NOM de marque, symbole DIFFÉRENT. */
  const marqueÉtrangère = Symbol("nodefony.configDescriptor");
  const venuDUneAutreCopie = {
    [marqueÉtrangère]: true,
    resolve: () => ({}) as never,
  };

  it("marque à la bonne description mais identité étrangère → détectée", () => {
    // C'est exactement l'objet que le Kernel recevait le 2026-09-13 : un vrai
    // descripteur, illisible parce que marqué par un autre paquet.
    expect(isConfigDescriptor(venuDUneAutreCopie)).to.equal(false);
    expect(isForeignDescriptor(venuDUneAutreCopie)).to.equal(true);
  });

  it("le nom de marque de la garde est CELUI que defineConfig pose", () => {
    // La garde duplique le littéral (elle ne peut pas importer notre symbole,
    // qui est justement celui qui ne correspond pas). Ce test confronte les deux
    // : renommer la marque sans toucher la garde la rendrait aveugle en silence.
    const vrai = defineConfig({ modules: [] });
    const nôtre = Object.getOwnPropertySymbols(vrai)[0];
    expect(nôtre?.description).to.be.a("string");
    expect(
      isForeignDescriptor({ [Symbol(nôtre!.description!)]: true }),
      "la garde ne reconnaît plus le nom de marque posé par defineConfig",
    ).to.equal(true);
  });

  it("un objet ordinaire n'est PAS pris pour un descripteur étranger", () => {
    expect(isForeignDescriptor({})).to.equal(false);
    expect(isForeignDescriptor({ modules: [] })).to.equal(false);
    expect(isForeignDescriptor({ [Symbol("autre.chose")]: true })).to.equal(
      false,
    );
    expect(isForeignDescriptor(null)).to.equal(false);
    expect(isForeignDescriptor("texte")).to.equal(false);
  });

  it("un descripteur étranger reste EXPLOITABLE — il porte son resolve", () => {
    // C'est ce qui permet de démarrer EN DÉVELOPPEMENT au lieu de refuser
    // partout : la seule chose qui manquait était de reconnaître la marque, pas
    // la capacité à résoudre. Le verdict, lui, appartient au Kernel.
    const résolu = (venuDUneAutreCopie as { resolve: () => unknown }).resolve();
    expect(résolu).to.be.an("object");
  });

  it("le constat ne PROMET plus un démarrage — c'est le Kernel qui tranche", () => {
    const dit = foreignPackageWarning();
    expect(dit).to.match(/DEUX paquets/);
    // 🔴 Ce texte a longtemps affirmé « L'application DÉMARRE ». C'est devenu
    // FAUX le jour où la production a commencé à refuser (`packageDualityVerdict`)
    // : promettre un démarrage à qui vient de lire un refus est pire que se
    // taire. Le constat DÉCRIT, il ne décide pas.
    expect(
      dit,
      "le constat ne doit plus promettre que l'application démarre",
    ).to.not.match(/DÉMARRE/);
    // Fail-loud sur la dégradation : dire ce qui peut différer…
    expect(dit).to.match(/défauts et la validation/);
    // …y compris le fait qui coûte le plus cher, et qu'il taisait.
    expect(dit).to.match(/perdent leur container/);
    // Et donner les gestes qui tranchent — un par famille de cause.
    expect(dit).to.match(/NF_CLI_DEBUG/);
    expect(
      dit,
      "`npm ls` est le seul geste pour un doublon d'arbre npm",
    ).to.match(/npm ls nodefony/);
  });

  it("le diagnostic de manifeste vide ne parle plus d'un boot REFUSÉ", () => {
    // Depuis qu'on démarre malgré la dualité, ce message ne sort QUE si la
    // config résolue est elle-même vide : il doit donc parler des DEUX faits.
    const dit = diagnoseEmptyManifest({
      serversExpected: true,
      manifestEntries: 0,
      origin: "foreign-descriptor",
    });
    expect(dit).to.match(/manifeste `modules` est VIDE/);
    expect(dit).to.match(/deux paquets/i);
  });
});
