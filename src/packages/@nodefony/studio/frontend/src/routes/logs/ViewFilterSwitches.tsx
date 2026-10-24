/**
 * **ViewFilterSwitches** — les filtres d'affichage COMMUNS aux onglets Journaux
 * et Direct : un seul état (porté par la page), le même rendu des deux côtés.
 */
import { Chip, Switch } from "@mantine/core";
import { InfoHint } from "../../components/ui";
import type { ILogViewFilters } from "./logsTypes";

export interface ViewFilterSwitchesProps {
  value: ILogViewFilters;
  onChange: (next: ILogViewFilters) => void;
}

export function ViewFilterSwitches({
  value,
  onChange,
}: ViewFilterSwitchesProps) {
  return (
    <>
      <Switch
        size="sm"
        checked={value.hideConsole}
        onChange={(e) =>
          onChange({ ...value, hideConsole: e.currentTarget.checked })
        }
        label="Masquer la console et Vite"
      />
      <InfoHint text="Les pages de la console d'administration, ses appels de données (/nodefony/…/api/), son WebSocket et le relais /_vite/ écrivent chacun des lignes ; Vite y ajoute son démarrage et son rechargement à chaud. Masquées, il ne reste que l'application. Avertissements et erreurs de Vite restent visibles. Réglage commun aux onglets Journaux et Direct." />
      <Chip
        size="xs"
        color="gray"
        checked={value.hideFramework}
        onChange={(on) => onChange({ ...value, hideFramework: on })}
        aria-label="masquer les lignes du framework (module NODEFONY)"
      >
        Masquer NODEFONY
      </Chip>
      <InfoHint text="Retire ce que le framework écrit pour lui-même (routage, noyau, sessions). Les lignes de requête restent visibles : le framework les signe NODEFONY, mais elles décrivent le trafic de l'application. Réglage commun aux onglets Journaux et Direct." />
    </>
  );
}
