import {
  SegmentedControl,
  Tooltip,
  Center,
  type MantineSize,
} from "@mantine/core";
import {
  IconCode,
  IconServer2,
  IconActivityHeartbeat,
  IconShieldCheck,
  type Icon,
} from "@tabler/icons-react";

/* ════════════════════════════════════════════════════════════════════════
 * RoleSwitch — sélecteur de persona/rôle ERGONOMIQUE (choix exclusif visible).
 *
 * SegmentedControl (tous les choix visibles, 1 clic) plutôt qu'un Select (menu
 * caché, 2 clics, options invisibles) — bon pour 2-5 options mutuellement
 * exclusives. Icône + tooltip = compact ET explicite (pas d'icône à deviner).
 * Réutilisé par le portail Documentation et l'onglet Docs des modules.
 * ════════════════════════════════════════════════════════════════════════ */

export const ROLE_OPTIONS: { value: string; label: string; icon: Icon }[] = [
  { value: "developer", label: "Développeur", icon: IconCode },
  { value: "devops", label: "DevOps", icon: IconServer2 },
  { value: "supervisor", label: "Superviseur", icon: IconActivityHeartbeat },
  { value: "admin", label: "Admin", icon: IconShieldCheck },
];

export interface RoleSwitchProps {
  value: string;
  onChange: (value: string) => void;
  size?: MantineSize;
}

export function RoleSwitch({ value, onChange, size = "xs" }: RoleSwitchProps) {
  return (
    <SegmentedControl
      size={size}
      value={value}
      onChange={onChange}
      aria-label="Voir la doc en tant que (rôle)"
      data={ROLE_OPTIONS.map((o) => {
        const I = o.icon;
        return {
          value: o.value,
          label: (
            <Tooltip label={o.label} withinPortal>
              <Center style={{ gap: 6 }}>
                <I size={16} aria-hidden />
              </Center>
            </Tooltip>
          ),
        };
      })}
    />
  );
}

export default RoleSwitch;
