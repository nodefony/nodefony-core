/**
 * Onglet « Utilisation & aide » de la console Sessions — pédagogie déportée hors
 * de l'écran factuel (divulgation progressive). Explique le modèle de session, la
 * référence HMAC, la révocation et la réserve multi-tenant. Texte uniquement.
 */
import { Stack, Card, Text, Title, List, Code, Alert } from "@mantine/core";
import {
  IconShieldLock,
  IconKey,
  IconLogout,
  IconBuildingCommunity,
} from "@tabler/icons-react";

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="lg">
      <Stack gap="sm">
        <Title
          order={4}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          {icon}
          {title}
        </Title>
        {children}
      </Stack>
    </Card>
  );
}

export function SessionsHelp() {
  return (
    <Stack gap="md">
      <Section
        icon={<IconShieldLock size={18} />}
        title="Qu'est-ce qu'une session ?"
      >
        <Text size="sm">
          Une session relie un client (navigateur ou outil) au serveur via un{" "}
          <strong>cookie opaque</strong> : c'est le mode d'authentification web
          par défaut de Nodefony (BFF — Backend For Frontend). Le serveur garde
          l'état (utilisateur, métadonnées) ; le cookie ne porte qu'un
          identifiant. Cette console liste les sessions <em>persistées</em>{" "}
          (stockage fichier, SQL ou Redis) et permet de les gouverner.
        </Text>
      </Section>

      <Section
        icon={<IconKey size={18} />}
        title="Référence publique (sess_…) — jamais l'id brut"
      >
        <Text size="sm">
          L'identifiant de session réel <strong>n'est jamais exposé</strong> :
          il vaut le cookie lui-même, donc le posséder suffirait à usurper la
          session. À la place, l'API renvoie une référence dérivée{" "}
          <Code>sess_…</Code> = <Code>HMAC(secret, id)</Code> tronquée, stable
          et <strong>non réversible</strong>. C'est le standard « appareils
          connectés » de GitHub/Google : on montre une référence, jamais le
          jeton. La révocation s'appuie sur cette référence (le serveur retrouve
          l'id réel par recalcul).
        </Text>
        <Alert variant="light" color="gray">
          <Text size="xs">
            Les données métier de la session (<Code>Attributes</Code>,{" "}
            <Code>flashBag</Code>) ne sont jamais renvoyées : redaction par
            construction côté serveur.
          </Text>
        </Alert>
      </Section>

      <Section
        icon={<IconLogout size={18} />}
        title="Révocation & déconnexion globale"
      >
        <List size="sm" spacing="xs">
          <List.Item>
            <strong>Révoquer une session</strong> : la détruit immédiatement. La
            prochaine requête du client est traitée comme anonyme (re-login
            requis).
          </List.Item>
          <List.Item>
            <strong>Déconnecter toutes les sessions d'un utilisateur</strong>{" "}
            (logout everywhere) : détruit toutes ses sessions d'un coup — la
            réponse type à une compromission de compte.
          </List.Item>
          <List.Item>
            Chaque révocation est <strong>auditée</strong> (acteur admin ×
            cible) et passe en HTTP (pipeline CSRF complet).
          </List.Item>
        </List>
      </Section>

      <Section
        icon={<IconBuildingCommunity size={18} />}
        title="Multi-tenant (P17) — réservé"
      >
        <Text size="sm">
          La colonne <strong>Tenant</strong> et la portée « Tenant » préparent
          le mode multi-organisations : aujourd'hui <Code>global</Code>{" "}
          (mono-tenant), demain le filtrage par organisation porteuse de la
          session. Le contrat porte déjà le champ <Code>tenantId</Code> — aucun
          changement d'API ne sera nécessaire pour l'activer.
        </Text>
      </Section>
    </Stack>
  );
}
