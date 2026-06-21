/**
 * Helpers de RENDU de la console Sessions — badges (icône + couleur + texte,
 * jamais la couleur seule = a11y WCAG). Données non maîtrisées (user, ip, ua,
 * tenant) rendues en TEXTE/Code/Badge, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconUserCheck,
  IconUserOff,
  IconBuildingCommunity,
  IconWorld,
  IconRobot,
  IconDeviceDesktop,
  IconDatabase,
  IconShieldCheck,
  IconShieldOff,
} from "@tabler/icons-react";
import { parseUserAgent } from "./sessionsModel";

/** Badge d'authentification d'une session (authentifiée vs anonyme). */
export function AuthBadge({
  authenticated,
  size = "sm",
}: {
  authenticated: boolean;
  size?: string;
}): ReactNode {
  return authenticated ? (
    <Badge
      variant="light"
      color="teal"
      size={size}
      leftSection={<IconUserCheck size={12} />}
      style={{ textTransform: "none" }}
    >
      Authentifiée
    </Badge>
  ) : (
    <Badge
      variant="outline"
      color="gray"
      size={size}
      leftSection={<IconUserOff size={12} />}
      style={{ textTransform: "none" }}
    >
      Anonyme
    </Badge>
  );
}

/**
 * Tenant porteur de la session. En mono-tenant (`tenantId === null`), affiche
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

/**
 * Client de la session = User-Agent **parsé** (navigateur · OS), ou badge robot
 * pour un client non-navigateur (script/outil/bot). UA brut en tooltip. « — » si
 * non capturé.
 */
export function ClientChip({ ua }: { ua: string | null }): ReactNode {
  const parsed = parseUserAgent(ua);
  if (!parsed) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    );
  }
  const label = parsed.os ? `${parsed.browser} · ${parsed.os}` : parsed.browser;
  return (
    <Tooltip label={ua} multiline maw={360} withArrow openDelay={300}>
      <Badge
        variant="light"
        color={parsed.machine ? "cyan" : "blue"}
        size="sm"
        leftSection={
          parsed.machine ? (
            <IconRobot size={12} />
          ) : (
            <IconDeviceDesktop size={12} />
          )
        }
        style={{ textTransform: "none", maxWidth: 220 }}
      >
        {label}
      </Badge>
    </Tooltip>
  );
}

/**
 * Badge **« où on écrit »** : le driver de persistance des sessions
 * (drizzle/files/redis/mongo) + un bouclier ✓ si la révocation est durcie
 * (garde-fou anti-résurrection actif). Chemin relatif (store fichier) en
 * tooltip. Info MAJEURE : savoir quel backend porte réellement les sessions —
 * et donc quelles garanties s'appliquent.
 */
export function StorageBadge({
  driver,
  storage,
  revocationHardened,
  savePath,
}: {
  driver: string | null;
  storage: string;
  revocationHardened: boolean;
  savePath: string | null;
}): ReactNode {
  const label = driver ?? storage;
  return (
    <Tooltip
      withArrow
      openDelay={150}
      multiline
      label={
        <Stack gap={2}>
          <Text size="xs">Store : {storage}</Text>
          {savePath ? <Text size="xs">Chemin : {savePath}</Text> : null}
          <Text size="xs">
            {revocationHardened
              ? "Révocation durcie (anti-résurrection) ✓"
              : "⚠ Révocation NON durcie sur ce backend"}
          </Text>
        </Stack>
      }
    >
      <Badge
        variant="light"
        color={revocationHardened ? "grape" : "orange"}
        size="sm"
        leftSection={<IconDatabase size={12} />}
        rightSection={
          revocationHardened ? (
            <IconShieldCheck size={12} />
          ) : (
            <IconShieldOff size={12} />
          )
        }
        style={{ textTransform: "none" }}
      >
        {label}
        {savePath ? ` · ${savePath}` : ""}
      </Badge>
    </Tooltip>
  );
}
