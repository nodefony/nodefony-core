#!/usr/bin/env node
/**
 * Auto-contrôle du juge « composant local » — ses causes, AVANT son verdict.
 *
 * Un juge qui rend un rouge unique fait chercher au hasard : ici, quatre
 * situations très différentes produisent un échec, et deux d'entre elles
 * n'accusent PAS l'agent. Chacune reçoit donc un état figé, et l'on vérifie que
 * le juge la distingue — en appelant `judge`, jamais une copie de sa règle.
 *
 *   node gate-module-local.selftest.mjs
 *
 * Sorties : 0 toutes les causes distinguées · 1 au moins une confusion.
 */
import { judge, estComposantLocal } from "./gate-module-local.mjs";

// Un décor réaliste : ce que `inspect modules` rend dans une app générée, relevé
// sur une application réelle plutôt que reconstitué de mémoire.
const FRAMEWORK = [
  {
    key: "core",
    name: "@nodefony/core",
    isApp: false,
    path: "node_modules/nodefony",
  },
  { key: "app", name: "bench-app", isApp: true, path: "." },
  {
    key: "http",
    name: "@nodefony/http",
    isApp: false,
    path: "node_modules/@nodefony/http",
  },
  {
    key: "drizzle",
    name: "@nodefony/drizzle",
    isApp: false,
    path: "node_modules/@nodefony/drizzle",
  },
];
const COMPOSANT = {
  key: "audit",
  name: "@bench-app/audit",
  isApp: false,
  path: "modules/audit",
};
const ROUTE_APP = { name: "hello-index", path: "/api/hello", module: "app" };
const ROUTE_COMPOSANT = {
  name: "audit-index",
  path: "/api/audit",
  module: "audit",
};

const cas = [
  {
    nom: "conforme",
    attendu: 0,
    etat: {
      modules: [...FRAMEWORK, COMPOSANT],
      routes: [ROUTE_APP, ROUTE_COMPOSANT],
      dossierModulesSurDisque: true,
    },
  },
  {
    nom: "aucunModuleLocal",
    attendu: 1,
    etat: {
      modules: FRAMEWORK,
      routes: [ROUTE_APP],
      dossierModulesSurDisque: false,
    },
  },
  {
    // Le demi-travail le plus probable : le générateur a tourné, le câblage
    // manque. Le dépôt a l'air juste, l'application ne sait rien du composant.
    nom: "moduleNonCharge",
    attendu: 2,
    etat: {
      modules: FRAMEWORK,
      routes: [ROUTE_APP],
      dossierModulesSurDisque: true,
    },
  },
  {
    // Satisfait la lettre (un module existe) et rate l'objet : les points
    // d'entrée sont restés dans l'app, le composant n'est pas détachable.
    nom: "composantSansRoute",
    attendu: 3,
    etat: {
      modules: [...FRAMEWORK, COMPOSANT],
      routes: [
        ROUTE_APP,
        { name: "audits", path: "/api/audits", module: "app" },
      ],
      dossierModulesSurDisque: true,
    },
  },
  {
    nom: "inspectionImpossible",
    attendu: 5,
    etat: { modules: null, routes: null, dossierModulesSurDisque: false },
  },
  {
    // Le décor lit les modules mais pas les routes : c'est encore le décor, et
    // surtout pas « le composant n'a pas de route ».
    nom: "routesIllisibles",
    attendu: 5,
    etat: {
      modules: [...FRAMEWORK, COMPOSANT],
      routes: null,
      dossierModulesSurDisque: true,
    },
  },
  {
    // Une DÉPENDANCE npm n'est pas un composant qu'on a isolé — sans quoi toute
    // application passerait la tâche sans rien faire, puisqu'elle installe déjà
    // des paquets qui ne sont ni elle ni `@nodefony/*`.
    nom: "dependanceInstalleeNeComptePas",
    attendu: 1,
    etat: {
      modules: [
        ...FRAMEWORK,
        {
          key: "tiers",
          name: "un-paquet-tiers",
          isApp: false,
          path: "node_modules/un-paquet-tiers",
        },
      ],
      routes: [ROUTE_APP],
      dossierModulesSurDisque: false,
    },
  },
];

let defauts = 0;
for (const c of cas) {
  const { code, message } = judge(c.etat);
  const ok = code === c.attendu;
  if (!ok) defauts += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${c.nom.padEnd(28)} attendu=${c.attendu} obtenu=${code}  ` +
      message.slice(0, 96),
  );
}

// La règle d'appartenance, éprouvée pour elle-même : c'est elle qui décide de
// tout, et une erreur ici se lirait comme un verdict sur l'agent.
const appartenance = [
  [{ name: "@bench-app/audit", path: "modules/audit", isApp: false }, true],
  [{ name: "bench-app", path: ".", isApp: true }, false],
  [
    {
      name: "@nodefony/http",
      path: "node_modules/@nodefony/http",
      isApp: false,
    },
    false,
  ],
  [{ name: "nodefony", path: "node_modules/nodefony", isApp: false }, false],
  // Séparateur Windows : un composant local reste local quel que soit le
  // séparateur que la plateforme emploie pour l'écrire.
  [{ name: "@app/audit", path: "modules\\audit", isApp: false }, true],
  [{ name: "@app/x", path: "node_modules\\@app\\x", isApp: false }, false],
];
for (const [m, attendu] of appartenance) {
  const obtenu = estComposantLocal(m);
  if (obtenu !== attendu) {
    defauts += 1;
    console.log(
      `  ❌ appartenance : ${m.path} attendu=${attendu} obtenu=${obtenu}`,
    );
  }
}

console.log(
  defauts === 0
    ? "\n━━ toutes les causes distinguées, décor et travail de l'agent séparés"
    : `\n━━ ${defauts} DÉFAUT(S)`,
);
process.exit(defauts ? 1 : 0);
