/**
 * Helpers de RENDU de la console Users — badges (icône + couleur + texte, jamais
 * la couleur seule = a11y WCAG). Données non maîtrisées (identifier, rôles,
 * provider, tenant) rendues en TEXTE/Code/Badge, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Group, Text, Tooltip } from "@mantine/core";
import {
  IconShieldCheck,
  IconUser,
  IconUserCheck,
  IconUserOff,
  IconLock,
  IconBuildingCommunity,
  IconWorld,
  IconBrandGoogle,
  IconBrandGithub,
  IconKey,
} from "@tabler/icons-react";
import { ADMIN_ROLE } from "./usersModel";

/**
 * Badge d'état d'un compte (actif / verrouillé / désactivé) — l'icône double la
 * couleur (a11y). Le verrouillage prime sur la désactivation (info la plus forte).
 */
export function StatusBadge({
  enabled,
  locked,
  size = "sm",
}: {
  enabled: boolean;
  locked: boolean;
  size?: string;
}): ReactNode {
  if (locked) {
    return (
      <Badge
        variant="light"
        color="orange"
        size={size}
        leftSection={<IconLock size={12} />}
        style={{ textTransform: "none" }}
      >
        Verrouillé
      </Badge>
    );
  }
  return enabled ? (
    <Badge
      variant="light"
      color="teal"
      size={size}
      leftSection={<IconUserCheck size={12} />}
      style={{ textTransform: "none" }}
    >
      Actif
    </Badge>
  ) : (
    <Badge
      variant="outline"
      color="gray"
      size={size}
      leftSection={<IconUserOff size={12} />}
      style={{ textTransform: "none" }}
    >
      Désactivé
    </Badge>
  );
}

/**
 * Rôles d'un utilisateur sous forme de badges. `ROLE_NODEFONY_ADMIN` est mis en
 * exergue (bouclier rouge — le rôle critique gardé par l'anti-lockout). Au-delà
 * de `max`, un badge « +N » regroupe le reste (liste complète en tooltip).
 */
export function RoleBadges({
  roles,
  max = 3,
}: {
  roles: string[];
  max?: number;
}): ReactNode {
  if (roles.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        aucun rôle
      </Text>
    );
  }
  const shown = roles.slice(0, max);
  const rest = roles.slice(max);
  return (
    <Group gap={4} wrap="wrap">
      {shown.map((role) => {
        const admin = role === ADMIN_ROLE;
        return (
          <Badge
            key={role}
            variant="light"
            color={admin ? "red" : "blue"}
            size="sm"
            leftSection={
              admin ? <IconShieldCheck size={12} /> : <IconUser size={12} />
            }
            style={{ textTransform: "none" }}
          >
            {role}
          </Badge>
        );
      })}
      {rest.length > 0 && (
        <Tooltip label={rest.join(", ")} withArrow multiline maw={320}>
          <Badge
            variant="default"
            size="sm"
            style={{ textTransform: "none", fontWeight: 400 }}
          >
            +{rest.length}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

/** Icône du fournisseur OAuth (par nom), repli clé générique. */
function providerIcon(provider: string): ReactNode {
  const p = provider.toLowerCase();
  if (p.includes("google")) return <IconBrandGoogle size={12} />;
  if (p.includes("github")) return <IconBrandGithub size={12} />;
  return <IconKey size={12} />;
}

/**
 * Comptes externes liés (OAuth) sous forme de chips — jamais de jeton, seulement
 * le fournisseur. « local » (discret) si aucun lien social (compte mot de passe).
 */
export function ProviderChips({
  providers,
}: {
  providers: { provider: string; providerId: string }[];
}): ReactNode {
  if (providers.length === 0) {
    return (
      <Badge
        variant="default"
        size="sm"
        leftSection={<IconKey size={12} />}
        style={{ textTransform: "none", fontWeight: 400 }}
        c="dimmed"
      >
        local
      </Badge>
    );
  }
  return (
    <Group gap={4} wrap="wrap">
      {providers.map((p) => (
        <Tooltip
          key={`${p.provider}:${p.providerId}`}
          label={`${p.provider} · ${p.providerId}`}
          withArrow
          openDelay={300}
        >
          <Badge
            variant="light"
            color="grape"
            size="sm"
            leftSection={providerIcon(p.provider)}
            style={{ textTransform: "none" }}
          >
            {p.provider}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

/**
 * Tenant porteur du compte. En mono-tenant (`tenantId === null`), affiche
 * « global » (discret) — la colonne **réserve** l'axe multi-tenant (P17).
 */
export function TenantChip({
  tenantId,
}: {
  tenantId: string | null;
}): ReactNode {
  if (!tenantId) {
    return (
      <Badge
        variant="default"
        size="sm"
        leftSection={<IconWorld size={12} />}
        style={{ textTransform: "none", fontWeight: 400 }}
        c="dimmed"
      >
        global
      </Badge>
    );
  }
  return (
    <Badge
      variant="light"
      color="indigo"
      size="sm"
      leftSection={<IconBuildingCommunity size={12} />}
      style={{ textTransform: "none" }}
    >
      {tenantId}
    </Badge>
  );
}
