/**
 * Helpers de RENDU de la console Sessions — badges (icône + couleur + texte,
 * jamais la couleur seule = a11y WCAG). Données non maîtrisées (user, ip, ua,
 * tenant) rendues en TEXTE/Code/Badge, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconUserCheck,
  IconUserOff,
  IconBuildingCommunity,
  IconWorld,
  IconRobot,
  IconDeviceDesktop,
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
 * Rend une durée en secondes sous forme lisible (`30 min`, `8 h`, `7 j`).
 * `null` → `—` : un délai absent n'est pas un délai de zéro.
 */
function formatDelay(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return "—";
  }
  if (seconds < 60) {
    return `${seconds} s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }
  if (seconds < 86400) {
    return `${Math.round(seconds / 360) / 10} h`;
  }
  return `${Math.round(seconds / 8640) / 10} j`;
}

/**
 * Badge de POLITIQUE de session — ce que le registre des stores ne porte pas :
 * le garde-fou de révocation et les deux délais d'expiration côté serveur.
 *
 * Distinct de `BrickStoreChip` (« où on écrit », source unique
 * `/nodefony/kernel/api/stores`) : ici on montre « sous quelles règles », qui
 * est propre à la brique sessions. Les deux se complètent sans se doubler.
 *
 * Le garde-fou est affiché DANS LES DEUX ÉTATS, à dessein : une protection dont
 * on ne voit l'état que lorsqu'elle manque n'est pas vérifiable — un admin doit
 * pouvoir constater qu'elle est active, pas seulement être alerté qu'elle ne
 * l'est pas.
 */
export function SessionPolicyBadge({
  revocationHardened,
  idleTimeoutS,
  absoluteTimeoutS,
}: {
  revocationHardened: boolean;
  idleTimeoutS?: number | null;
  absoluteTimeoutS?: number | null;
}): ReactNode {
  const idle = formatDelay(idleTimeoutS);
  const absolute = formatDelay(absoluteTimeoutS);
  return (
    <Tooltip
      withArrow
      openDelay={150}
      multiline
      w={300}
      label={
        <Stack gap={2}>
          <Text size="xs">
            {revocationHardened
              ? "Révocation durcie : une session révoquée ne peut pas ressusciter, quel que soit le backend."
              : "⚠ Révocation NON durcie : le garde-fou anti-résurrection n'est pas posé sur ce store."}
          </Text>
          <Text size="xs">
            Inactivité : {idle} — rafraîchie à chaque requête.
          </Text>
          <Text size="xs">
            Durée absolue : {absolute} — depuis la création, ré-authentification
            forcée ensuite.
          </Text>
        </Stack>
      }
    >
      <Badge
        variant="light"
        color={revocationHardened ? "teal" : "orange"}
        size="sm"
        leftSection={
          revocationHardened ? (
            <IconShieldCheck size={12} />
          ) : (
            <IconShieldOff size={12} />
          )
        }
        style={{ textTransform: "none", cursor: "help" }}
        tabIndex={0}
        aria-label={
          `Politique de session. ` +
          (revocationHardened
            ? "Révocation durcie."
            : "Révocation non durcie.") +
          ` Inactivité ${idle}, durée absolue ${absolute}.`
        }
      >
        {revocationHardened ? "Révocation durcie" : "Révocation non durcie"}
        {idleTimeoutS ? ` · ${idle}` : ""}
      </Badge>
    </Tooltip>
  );
}
