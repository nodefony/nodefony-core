/**
 * Onglet « Utilisation & aide » de la console Users — pédagogie déportée hors de
 * l'écran factuel (divulgation progressive). Explique le modèle utilisateur, la
 * redaction du hash, les garde-fous anti-verrouillage et la réserve multi-tenant.
 * Texte uniquement.
 */
import { Stack, Card, Text, Title, List, Code, Alert } from "@mantine/core";
import {
  IconUsers,
  IconShieldLock,
  IconShieldCheck,
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

export function UsersHelp() {
  return (
    <Stack gap="md">
      <Section
        icon={<IconUsers size={18} />}
        title="Qu'est-ce qu'un utilisateur ?"
      >
        <Text size="sm">
          Un utilisateur est un compte porté par le service <Code>users</Code> —
          la <strong>source d'identité</strong> du firewall. C'est l'application
          qui décide <em>qui</em> sont ses utilisateurs et <em>où</em> ils sont
          stockés (annuaire en mémoire, SQL via Drizzle, ou MongoDB). Cette
          console liste les comptes, leur état et leurs rôles, et permet de les
          gouverner.
        </Text>
      </Section>

      <Section
        icon={<IconShieldLock size={18} />}
        title="Le hash de mot de passe n'est jamais exposé"
      >
        <Text size="sm">
          Le DTO d'administration est <strong>redacté par construction</strong>{" "}
          (allowlist côté serveur) : il ne porte que l'identité, les rôles,
          l'état et les liens sociaux. Le <Code>password</Code> (hash) et les{" "}
          <Code>metadata</Code> (potentiellement sensibles) ne sortent jamais de
          l'API. Les comptes OAuth sont montrés <strong>sans jeton</strong>{" "}
          (fournisseur + référence seulement).
        </Text>
        <Alert variant="light" color="gray">
          <Text size="xs">
            Un compte « local » s'authentifie par mot de passe ; un compte{" "}
            <Code>google</Code>/<Code>github</Code> est un{" "}
            <strong>Shadow User</strong> (ligne locale liée à un compte externe,
            sans mot de passe stocké).
          </Text>
        </Alert>
      </Section>

      <Section
        icon={<IconShieldCheck size={18} />}
        title="Garde-fous anti-verrouillage"
      >
        <List size="sm" spacing="xs">
          <List.Item>
            <strong>Pas d'auto-suppression</strong> : le serveur refuse de
            supprimer le compte de l'administrateur connecté.
          </List.Item>
          <List.Item>
            <strong>Pas de suppression du dernier admin</strong> : si un seul
            administrateur actif reste, sa suppression (ou déchéance) est
            refusée — sinon plus personne ne pourrait administrer.
          </List.Item>
          <List.Item>
            Ces refus reviennent en <strong>erreur explicite (409)</strong>{" "}
            affichée dans Studio. Chaque suppression est{" "}
            <strong>auditée</strong> et passe en HTTP (pipeline CSRF complet).
          </List.Item>
          <List.Item>
            Supprimer un compte <strong>révoque en cascade</strong> ses sessions
            et ses jetons d'accès (PAT) — déconnexion immédiate.
          </List.Item>
        </List>
      </Section>

      <Section
        icon={<IconBuildingCommunity size={18} />}
        title="Multi-tenant (P17) — réservé"
      >
        <Text size="sm">
          La colonne <strong>Tenant</strong> prépare le mode multi-organisations
          : aujourd'hui <Code>global</Code> (mono-tenant), demain le filtrage
          par organisation porteuse du compte. Le contrat porte déjà le champ{" "}
          <Code>tenantId</Code> — aucun changement d'API ne sera nécessaire pour
          l'activer.
        </Text>
      </Section>
    </Stack>
  );
}
