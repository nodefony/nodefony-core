/**
 * Blocs « Mon compte » (catégorie `account`) — self-service, visibles par TOUS
 * (aucun `roles` → pas dans `CATEGORY_ROLES`). Ils alimentent le bureau par
 * défaut d'un simple utilisateur (template « Mon compte »).
 *
 * Sources self-service (session BFF, pas de RBAC admin) :
 *  - identité : `GET /nodefony/security/api/auth/me` (rôles frais) ;
 *  - clés     : `GET /nodefony/security/api/keys` (MES clés) ;
 *  - sessions : `GET /nodefony/http/api/sessions/mine` (MES sessions, anti-IDOR).
 */
import { Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconKey, IconUserCircle, IconDevices } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { keyStatus, type ApiKey } from "../../routes/apikeys/apiKeysModel";
import type { SessionListResponse } from "../../routes/sessions/sessionsModel";
import { BigMetric } from "./_kit";

/** Projection légère de l'identité (miroir de la réponse `/auth/me`). */
interface MeResponse {
  user: { id: number | string; username: string; roles: string[] };
}

// ───────────────────────────── account.profile ─────────────────────────
function ProfileBody({ source }: WidgetRenderProps<MeResponse>) {
  const u = source.data?.user;
  if (!u) return null;
  const roles = u.roles ?? [];
  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" color="brand" size={42} radius="xl">
          <IconUserCircle size={26} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text fw={700} size="lg" truncate>
            {u.username}
          </Text>
          <Text size="xs" c="dimmed">
            ID {String(u.id)}
          </Text>
        </div>
      </Group>
      <div>
        <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb={4}>
          Mes rôles
        </Text>
        {roles.length ? (
          <Group gap={4}>
            {roles.map((r) => (
              <Badge key={r} variant="light" radius="sm">
                {r}
              </Badge>
            ))}
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            Aucun rôle attribué.
          </Text>
        )}
      </div>
    </Stack>
  );
}

// ───────────────────────────── account.apikeys ─────────────────────────
function MyApiKeysBody({ source }: WidgetRenderProps<{ keys: ApiKey[] }>) {
  const keys = source.data?.keys ?? [];
  const active = keys.filter((k) => keyStatus(k) === "active").length;
  return (
    <Group gap="xl" wrap="nowrap" align="flex-start">
      <BigMetric label="Clés actives" value={active} color="teal" />
      <BigMetric
        label="Total"
        value={keys.length}
        color="gray"
        sub={keys.length ? "incl. expirées / révoquées" : "aucune clé"}
      />
    </Group>
  );
}

// ───────────────────────────── account.sessions ────────────────────────
function MySessionsBody({ source }: WidgetRenderProps<SessionListResponse>) {
  const items = source.data?.items ?? [];
  const total = source.data?.total ?? items.length;
  return (
    <Group gap="xl" wrap="nowrap" align="flex-start">
      <BigMetric label="Sessions actives" value={items.length} color="teal" />
      <BigMetric
        label="Total"
        value={total}
        color="gray"
        sub={
          total > items.length ? "fenêtre tronquée" : "mes appareils / onglets"
        }
      />
    </Group>
  );
}

// ─────────────────────────────── registrations ─────────────────────────
registerWidget<MeResponse>({
  id: "account.profile",
  title: "Mon profil",
  description: "Mon identité et mes rôles (session courante).",
  category: "account",
  icon: IconUserCircle,
  tags: ["compte", "identite", "panneau"],
  source: { kind: "snapshot", endpoint: "/nodefony/security/api/auth/me" },
  defaultSpan: 5,
  minSpan: 4,
  render: ProfileBody,
});

registerWidget<{ keys: ApiKey[] }>({
  id: "account.apikeys",
  title: "Mes clés API",
  description: "Nombre de mes clés d'API actives (jetons personnels).",
  category: "account",
  icon: IconKey,
  tags: ["compte", "kpi"],
  source: { kind: "snapshot", endpoint: "/nodefony/security/api/keys" },
  defaultSpan: 4,
  minSpan: 3,
  render: MyApiKeysBody,
});

registerWidget<SessionListResponse>({
  id: "account.sessions",
  title: "Mes sessions",
  description: "Mes sessions actives (appareils / onglets connectés).",
  category: "account",
  icon: IconDevices,
  tags: ["compte", "kpi"],
  source: { kind: "snapshot", endpoint: "/nodefony/http/api/sessions/mine" },
  defaultSpan: 4,
  minSpan: 3,
  render: MySessionsBody,
});
