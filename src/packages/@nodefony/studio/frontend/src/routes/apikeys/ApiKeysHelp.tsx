/**
 * Onglet « Utilisation & aide » de la console API Keys — auto-explicatif, valeurs
 * interpolées depuis les capacités RÉELLES du serveur (préfixe, plafond, durée),
 * jamais codées en dur. Contenu rendu en TEXTE/Code (0 HTML injecté).
 */
import {
  Stack,
  Card,
  Group,
  ThemeIcon,
  Text,
  Code,
  List,
  Alert,
} from "@mantine/core";
import {
  IconTerminal2,
  IconListCheck,
  IconClockBolt,
  IconShieldLock,
  IconInfoCircle,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ApiKeyCapabilities } from "./apiKeysModel";

function HelpCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm" wrap="nowrap">
        <ThemeIcon variant="light" color="brand">
          {icon}
        </ThemeIcon>
        <Text fw={700}>{title}</Text>
      </Group>
      {children}
    </Card>
  );
}

export function ApiKeysHelp({
  capabilities,
}: {
  capabilities: ApiKeyCapabilities;
}) {
  const prefix = capabilities.prefix;
  const expiry =
    capabilities.defaultExpiryDays === null
      ? "sans expiration"
      : `${capabilities.defaultExpiryDays} jours`;

  return (
    <Stack gap="md">
      <HelpCard icon={<IconTerminal2 size={18} />} title="Utiliser une clé">
        <Text size="sm" c="dimmed" mb="sm">
          Présentez la clé dans l'en-tête <Code>Authorization</Code> de vos
          requêtes HTTP (schéma Bearer, RFC 6750) — comme un script, un job CI
          ou un agent le ferait :
        </Text>
        <Code block>
          {`curl https://votre-app/api/ressource \\
  -H "Authorization: Bearer ${prefix}_xxxxxxxx………"`}
        </Code>
        <Text size="xs" c="dimmed" mt="sm">
          La clé authentifie avec les droits <em>frais</em> de son porteur (la
          base fait foi à chaque requête, pas un instantané figé).
        </Text>
      </HelpCard>

      <HelpCard icon={<IconListCheck size={18} />} title="Scopes (capacités)">
        <Text size="sm" c="dimmed">
          Les scopes restreignent ce qu'une clé peut faire — un sous-ensemble
          des droits du porteur (principe du moindre privilège).
        </Text>
        <List size="sm" spacing={4} mt="sm">
          <List.Item>
            <strong>Aucun scope</strong> : la clé porte tous les droits du
            porteur.
          </List.Item>
          <List.Item>
            <strong>
              {capabilities.allowedScopes === null
                ? "Catalogue libre"
                : `${capabilities.allowedScopes.length} scope(s) au catalogue`}
            </strong>{" "}
            :{" "}
            {capabilities.allowedScopes === null
              ? "tout scope non vide est accepté à la création."
              : "seuls les scopes du catalogue sont acceptés."}
          </List.Item>
        </List>
      </HelpCard>

      <HelpCard icon={<IconClockBolt size={18} />} title="Expiration & plafond">
        <List size="sm" spacing={4}>
          <List.Item>
            Expiration par défaut : <strong>{expiry}</strong> (réglable à la
            création — une clé qui expire limite l'impact d'une fuite).
          </List.Item>
          <List.Item>
            Plafond : <strong>{capabilities.maxPerSubject}</strong> clés{" "}
            <em>actives</em> par porteur (révoquez-en pour en créer au-delà).
          </List.Item>
          <List.Item>
            Rotation : créez la nouvelle, basculez vos scripts, révoquez
            l'ancienne.
          </List.Item>
        </List>
      </HelpCard>

      <HelpCard icon={<IconShieldLock size={18} />} title="Sécurité">
        <List size="sm" spacing={4}>
          <List.Item>
            Le secret n'est affiché <strong>qu'une fois</strong>, à la création
            : seul son empreinte (sha256) est stockée, jamais le secret en
            clair.
          </List.Item>
          <List.Item>
            Un <Code>{prefix}_…</Code> public permet de repérer une clé sans
            révéler le secret (logs, audit).
          </List.Item>
          <List.Item>
            Révocation immédiate et définitive — toute requête portant la clé
            est ensuite rejetée (401).
          </List.Item>
          <List.Item>
            Traitez une clé comme un mot de passe : jamais dans un dépôt git,
            une URL ou un canal non chiffré.
          </List.Item>
        </List>
      </HelpCard>

      <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />}>
        <Text size="xs">
          Une clé API est une preuve <em>portée par la requête</em> (axe API),
          distincte de la session de navigateur (cookie BFF) et des rôles RBAC.
          La révocation d'une clé n'affecte ni la session ni les autres clés du
          porteur.
        </Text>
      </Alert>
    </Stack>
  );
}
