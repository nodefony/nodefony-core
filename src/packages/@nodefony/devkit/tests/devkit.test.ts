import { describe, it, expect } from "vitest";
import { defineDevkitConfig } from "../nodefony/config/defineModuleConfig";
import DevkitModule from "../index";
import { buildCard, renderCard } from "../nodefony/src/card";

/**
 * Ce que ce test prouve (et pourquoi il existe dès la naissance du module) :
 *  1. le module s'IMPORTE sans kernel — donc il reste testable hors serveur
 *     (un module qui déréférence le kernel au chargement est intestable) ;
 *  2. sa config a des défauts sûrs et REFUSE ce qui est invalide — la panne
 *     arrive au boot, nommée, pas en production sur un `undefined`.
 */
describe("devkit", () => {
  it("s'importe sans kernel", () => {
    expect(DevkitModule).toBeTypeOf("function");
  });

  it("applique ses défauts", () => {
    expect(defineDevkitConfig({}).enabled).toBe(true);
  });

  it("refuse une config invalide", () => {
    expect(() => defineDevkitConfig({ enabled: "oui" } as never)).toThrow(
      /enabled/u,
    );
  });
});

/**
 * La carte est PURE : elle ne rend que ce qu'on lui donne.
 *
 * C'est la propriété qui compte — un outil de découverte qui invente une porte
 * inexistante est pire que pas d'outil : il fait perdre le temps qu'il promet de
 * faire gagner.
 */
describe("devkit — carte de visite", () => {
  const base = {
    appName: "ma-boutique",
    appVersion: "2.4.0",
    nodefonyVersion: "10.0.0",
    environment: "development",
    modules: ["http", "framework"],
  };

  it("rend l'identité qu'on lui passe, sans rien inventer", () => {
    const card = buildCard(base);
    expect(card.app).toEqual({
      name: "ma-boutique",
      version: "2.4.0",
      environment: "development",
    });
    expect(card.nodefony.version).toBe("10.0.0");
  });

  it("trie les modules sans muter l'entrée", () => {
    const modules = ["studio", "http", "framework"];
    const card = buildCard({ ...base, modules });
    expect(card.modules).toEqual(["framework", "http", "studio"]);
    expect(modules).toEqual(["studio", "http", "framework"]);
  });

  it("n'ouvre une porte que si le module qui la sert est CHARGÉ", () => {
    const sans = buildCard(base).portes.map((p) => p.ou);
    expect(sans).not.toContain("/nodefony");
    expect(sans).not.toContain("/nodefony/documentation/api/tree");

    const avec = buildCard({
      ...base,
      modules: [...base.modules, "studio", "documentation"],
    }).portes.map((p) => p.ou);
    expect(avec).toContain("/nodefony");
    expect(avec).toContain("/nodefony/documentation/api/tree");
  });

  it("adresse les instructions de l'app en PREMIER", () => {
    // La tête est la ressource rare : un lecteur qui s'arrête au premier item
    // doit être tombé sur celui qui compte.
    expect(buildCard(base).portes[0].ou).toBe("AGENTS.md");
  });

  it("se rend lisible au terminal, sans rien perdre", () => {
    // Le rendu humain est la porte qu'un agent utilise VRAIMENT (la route HTTP
    // est derrière le pare-feu). S'il laissait tomber une porte ou un verbe, la
    // carte mentirait par omission — le pire mode de défaillance d'un outil de
    // découverte.
    const card = buildCard({ ...base, modules: [...base.modules, "studio"] });
    const rendu = renderCard(card);
    for (const porte of card.portes) {
      expect(rendu).toContain(porte.ou);
    }
    for (const verbe of card.verbes) {
      expect(rendu).toContain(verbe.commande);
    }
    expect(rendu).toContain("ma-boutique 2.4.0 — development");
  });

  it("préfixe TOUTES les commandes par npx", () => {
    // `nodefony` nu rend 127 — le binaire vit dans les node_modules de l'app.
    // Un agent recopie la forme qu'on lui montre : une seule commande nue
    // suffit à l'envoyer dans le mur au premier geste.
    const nodefonyVerbs = buildCard(base)
      .verbes.map((v) => v.commande)
      .filter((c) => c.includes("nodefony"));
    expect(nodefonyVerbs.length).toBeGreaterThan(0);
    for (const commande of nodefonyVerbs) {
      expect(commande).toMatch(/^npx nodefony /u);
    }
  });
});
