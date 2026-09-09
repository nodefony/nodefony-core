/**
 * Console d'administration — mode de service de son interface.
 *
 * Fragment du manifeste de l'application : `nodefony.config.ts` l'importe et
 * passe le résultat à `use("@nodefony/studio", …)`. Rien ne charge ce fichier
 * tout seul — c'est l'import du manifeste qui le monte, et lui seul.
 *
 * 🔴 `satisfies` n'est PAS décoratif. Écrit dans le manifeste, ce littéral
 * était vérifié au point d'appel : une clé inconnue y était refusée. Rendu par
 * une fonction, il ne l'est plus — la clé compile, puis Zod la retire EN
 * SILENCE au boot, et le module démarre sur son défaut. `satisfies` rétablit
 * ce contrôle, et `nodefony doctor` refuse un fragment qui s'en passe.
 *
 * @module
 */
import type { ConfigContext } from "nodefony";
import type { IStudioConfigInput } from "@nodefony/studio";
import type { env } from "../../env";

/**
 * La configuration de `@nodefony/studio` pour cette application.
 *
 * `ui` reste sur `auto` (→ Vite/HMR dans ce dépôt) sauf décor contraire :
 * `NF_STUDIO_UI=static` sert le pré-bâti, seul mode joignable depuis un
 * navigateur en conteneur (le pourquoi est dans `env.ts`).
 */
export const studioConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    ui: ctx.env.NF_STUDIO_UI,
  }) satisfies IStudioConfigInput;
