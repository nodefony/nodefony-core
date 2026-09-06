import { describe, it, expect } from "vitest";
import CliKernel from "../kernel/CliKernel";
import { descriptionWidth, type IHelpCommand } from "../cli/helpReport";

/**
 * 🔴 Une description de commande est un TITRE D'INDEX, et rien ne le disait.
 *
 * Ces chaînes ont trois lecteurs — l'aide, le menu interactif et la page de
 * manuel — et chacun les met en colonne. Une seule qui déborde replie la page
 * entière : l'œil ne lit plus un index, il lit un pavé. Vingt-quatre des
 * trente-neuf descriptions tenaient sur deux lignes à 80 colonnes, et neuf
 * étaient en anglais télégraphique dans une interface française.
 *
 * Rien ne l'empêchait, parce que rien ne les MESURAIT : une description est une
 * chaîne passée à un constructeur, et une chaîne trop longue compile. Ce gate
 * la mesure — contre la place RÉELLEMENT offerte, dérivée de la mise en page,
 * jamais contre un nombre écrit ici (cf {@link descriptionWidth}).
 *
 * ⚠️ Il ne couvre que les commandes du FRAMEWORK : les vingt qu'apportent les
 * modules d'une application (`http:network`, `orm:migrate`, `security:user:add`…)
 * vivent hors de ce workspace, et le cœur ne peut pas les lire. La règle vaut
 * pour elles — elle est écrite dans le CLAUDE.md du CLI — mais elle n'est pas
 * gardée ici.
 */

/** La largeur de référence : le terminal étroit qu'on rencontre partout. */
const LARGEUR = 80;

/**
 * Les commandes intégrées, telles que l'aide les recevra.
 *
 * On passe par le manifeste et non par les fichiers source : c'est la seule
 * façon de mesurer la VALEUR d'une description composée à l'exécution
 * (`completion` interpole la liste des shells). Lire le littéral du source
 * mesurerait le gabarit, pas ce que l'utilisateur lit.
 */
function commandesIntegrees(): IHelpCommand[] {
  const manifest = new CliKernel("development").buildBuiltinManifest();
  return manifest.commands.map((c) => ({
    name: c.name,
    aliases: c.aliases ?? [],
    description: c.description,
    group: c.group,
  }));
}

describe("descriptions des commandes — un index, pas un pavé", () => {
  const commandes = commandesIntegrees();
  const place = descriptionWidth(commandes, LARGEUR);

  it("aucune ne déborde de la place que la mise en page lui laisse", () => {
    const trop = commandes
      .filter((c) => c.description.length > place)
      .map((c) => `${c.name} (${c.description.length} > ${place})`)
      .sort();
    expect(
      trop,
      `à ${LARGEUR} colonnes, ces descriptions passent sur deux lignes : ${trop.join(", ")}`,
    ).toEqual([]);
  });

  it("chacune commence par une minuscule — c'est une glose, pas une phrase", () => {
    // Une majuscule initiale fait lire chaque ligne comme le début d'une
    // phrase, et la colonne cesse d'être une liste. Les noms propres restent
    // possibles ailleurs dans la ligne ; seule l'initiale est contrainte.
    const capitales = commandes
      .filter((c) => {
        const premiere = c.description.charAt(0);
        return premiere !== "" && premiere === premiere.toLocaleUpperCase("fr");
      })
      .map((c) => `${c.name} : « ${c.description} »`)
      .sort();
    expect(
      capitales,
      `descriptions capitalisées : ${capitales.join(" · ")}`,
    ).toEqual([]);
  });

  it("aucune n'est vide", () => {
    const vides = commandes.filter((c) => c.description.trim() === "");
    expect(vides.map((c) => c.name)).toEqual([]);
  });
});
