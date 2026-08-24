import { describe, it, expect } from "vitest";
import { createTestModule } from "nodefony/testing";
import <%= it.pascal %>Service from "../nodefony/service/<%= it.pascal %>Service";
<% if (it.inject) { %>import <%= it.inject.pascal %> from "../nodefony/service/<%= it.inject.pascal %>";
<% } %>
/**
 * <%= it.pascal %>Service, éprouvé SEUL — sans serveur, sans base, sans port.
 *
 * `createTestModule()` (sous-chemin `nodefony/testing`) rend le module jetable
 * qu'un service réclame en argument. C'est ce qui permet d'éprouver une règle
 * métier en quelques millisecondes, là où passer par HTTP exerce toute la
 * chaîne sans rien dire de CETTE responsabilité.
 *
 * ⚠️ Les assertions ci-dessous ne portent QUE sur ce qui survit à ta logique
 * (le nom du service, son état). Le gabarit t'invite à remplacer sa méthode
 * d'exemple : un test écrit sur elle serait rouge à ta première modification.
 * **Ajoute tes propres cas** au dernier `describe` — c'est là que ce fichier
 * devient utile.
 */

/**
 * Construit le service sur un module neuf.
<% if (it.inject) { %> *
 * La dépendance est passée À LA MAIN : la résolution par le conteneur
 * (`@inject`) réclame un kernel vivant, absent d'un test unitaire. C'est tout
 * l'intérêt de l'injection par constructeur — et c'est ce qui te permettra d'y
 * glisser un objet qui joue le rôle du vrai service pour éprouver un cas limite.
<% } %> */
const build = (): <%= it.pascal %>Service => {
  const module = createTestModule();
  return new <%= it.pascal %>Service(module<% if (it.inject) { %>, new <%= it.inject.pascal %>(module)<% } %>);
};

describe("<%= it.pascal %>Service", () => {
  it("se construit sur un module jetable et porte sa clé de conteneur", () => {
    const service = build();
    // La clé d'instance vient de `super("<%= it.camel %>", …)` : c'est elle
    // qu'on écrit dans `container.get("…")`.
    expect(service.name).toBe("<%= it.camel %>");
    expect(service.status()).toEqual({ ready: true });
  });

  it("deux instances sont ISOLÉES — un test ne pollue pas le suivant", () => {
    const a = build();
    const b = build();
    expect(a).not.toBe(b);
    expect(a.container).not.toBe(b.container);
  });

  describe("ta logique métier", () => {
    it.todo("décrit ce que ton service doit garantir");
  });
});
