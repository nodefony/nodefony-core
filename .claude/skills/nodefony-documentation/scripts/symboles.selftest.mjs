#!/usr/bin/env node
// Éprouve le contrôle de dérive des symboles : il doit ATTRAPER un symbole que
// le code ne porte plus, et ne PAS crier sur ce qui est vivant, externe ou
// hors grammaire. Un gate qu'on n'a jamais vu échouer n'est pas un gate.
//
// `@usage` node .claude/skills/nodefony-documentation/scripts/symboles.selftest.mjs
import { symbolesFantomes, EXCEPTIONS } from "./symboles.mjs";

const index = new Set(["UserService", "onBoot", "createdAt", "FileClass"]);
let echecs = 0;

/** @type {Array<[string, string[], string]>} */
const cas = [
  // [ce qu'on écrit, ce qui doit être signalé, pourquoi ce cas existe]
  [
    "Primitives PURES : `controlesSautes`, `preventedChecks`.",
    ["controlesSautes (renommé en `checksSkipped` ?)"],
    "un identifiant FRANÇAIS absent du code est signalé, avec son nom probable",
  ],
  [
    "`separerGeste` le détache du reste.",
    ["separerGeste (renommé en `splitAction` ?)"],
    "le dictionnaire est celui de check:lang — jamais une copie qui divergerait",
  ],
  [
    "moteur Eta — pas de `renderTwig` ni de `renderEjs`, tous deux retirés.",
    [],
    "un symbole ANGLAIS absent est presque toujours un retrait énoncé : 49/55 mesurés",
  ],
  [
    "`UserService` expose `onBoot` et le champ `createdAt`.",
    [],
    "un symbole vivant ne déclenche rien, quelle que soit sa forme",
  ],
  [
    "Une méthode `onBoot()` et un champ `createdAt:` n'ont aucun mot-clé de déclaration.",
    [],
    "chercher `class X`/`const X` les raterait : 1140 faux positifs mesurés",
  ],
  [
    "`AskUserQuestion` est un outil du harnais.",
    [],
    "une exception DÉCLARÉE est tue, et son motif est lisible",
  ],
  [
    "Le `kernel` lit `config` et `tmp` au `boot`.",
    [],
    "un mot d'une seule casse n'est pas un candidat symbole",
  ],
  [
    "`abcde` est court, `MAJUSCULES` et `minuscules` n'ont pas de casse interne.",
    [],
    "moins de six caractères, ou casse uniforme : hors périmètre",
  ],
  [
    "`argvListe` puis encore `argvListe`.",
    ["argvListe (renommé en `argvList` ?)"],
    "un symbole cité deux fois n'est signalé qu'une",
  ],
];

for (const [markdown, attendu, pourquoi] of cas) {
  const obtenu = symbolesFantomes(markdown, index);
  const ok =
    obtenu.length === attendu.length &&
    obtenu.every((n, i) => n === attendu[i]);
  if (!ok) {
    echecs++;
    console.error(`❌ ${pourquoi}`);
    console.error(
      `   attendu [${attendu.join(",")}] · obtenu [${obtenu.join(",")}]`,
    );
  } else console.log(`✅ ${pourquoi}`);
}

// L'exception se déclare AVEC son motif : une liste de noms nus se périmerait
// sans que personne sache pourquoi chacun y est.
for (const [nom, motif] of EXCEPTIONS) {
  if (typeof motif === "string" && motif.trim().length > 10) continue;
  echecs++;
  console.error(`❌ l'exception \`${nom}\` n'énonce pas son motif`);
}

console.log(
  `\n${cas.length - echecs}/${cas.length} cas + ${EXCEPTIONS.size} exception(s) motivée(s).`,
);
process.exit(echecs ? 1 : 0);
