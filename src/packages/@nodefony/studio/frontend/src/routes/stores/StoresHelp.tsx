/**
 * Onglet « Utilisation & aide » de la console Stores — pédagogie déportée hors de
 * l'écran factuel (divulgation progressive). Explique le modèle « infra déclarée »,
 * la résolution `auto`, la provenance, la durabilité/volatilité, et pourquoi les
 * backends disponibles reflètent les adapters RÉELLEMENT chargés. Texte uniquement.
 */
import { Stack, Card, Text, Title, List, Code, Alert } from "@mantine/core";
import {
  IconDatabase,
  IconWand,
  IconPlugConnected,
  IconAlertTriangle,
  IconArchive,
  IconRoute,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

function Section({
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

export function StoresHelp() {
  return (
    <Stack gap="md">
      <Section
        icon={<IconDatabase size={18} />}
        title="Qu'est-ce qu'un store de persistance ?"
      >
        <Text size="sm">
          Chaque <strong>brique</strong> du framework (sessions, jetons JWT/API,
          passkeys, 2FA, audit, webhooks, idempotence, utilisateurs) doit écrire
          ses données quelque part. Le <strong>store</strong> est le backend qui
          les persiste : <Code>memory</Code> (RAM), <Code>file</Code> (disque
          local), <Code>drizzle</Code> (SQL), <Code>mongoose</Code> (MongoDB) ou{" "}
          <Code>redis</Code>. Cette console montre, <strong>au runtime</strong>,
          quel store porte réellement chaque brique — pas la théorie.
        </Text>
      </Section>

      <Section
        icon={<IconWand size={18} />}
        title="Infra déclarée + résolution « auto »"
      >
        <Text size="sm">
          Tu ne configures pas onze backends un par un : tu{" "}
          <strong>déclares ton infra</strong> par des URLs (pattern
          Rails/Django) — <Code>NF_DATABASE_URL</Code> (base durable),{" "}
          <Code>NF_REDIS_URL</Code> (cache partagé). Les briques dont le store
          vaut <Code>auto</Code> <strong>suivent l'infra déclarée</strong> ; une
          valeur explicite gagne toujours (moindre surprise).
        </Text>
        <List size="sm" spacing="xs">
          <List.Item>
            <strong>défaut-infra</strong> : la brique était en <Code>auto</Code>{" "}
            — le framework a choisi le backend depuis l'infra (ou le repli si
            rien n'est déclaré). La <strong>raison</strong> exacte est au survol
            de l'icône ⓘ.
          </List.Item>
          <List.Item>
            <strong>explicite</strong> : un backend a été nommé dans la config
            ou l'environnement de l'app — il est respecté tel quel.
          </List.Item>
        </List>
      </Section>

      <Section
        icon={<IconPlugConnected size={18} />}
        title="« Backends dispo » = adapters réellement chargés"
      >
        <Text size="sm">
          La colonne <strong>Backends dispo</strong> ne liste PAS tous les
          backends imaginables : elle reflète ceux{" "}
          <strong>réellement enregistrés au boot</strong> par les adapters
          présents dans le manifeste (<Code>nodefony.config.ts</Code>). Un
          adapter n'enregistre ses stores que s'il est <strong>chargé</strong>.
        </Text>
        <Alert variant="light" color="gray">
          <Text size="xs">
            Exemple : si <Code>@nodefony/mongoose</Code> est commenté dans le
            manifeste, <Code>mongoose</Code> n'apparaît nulle part — c'est le
            vrai gréement, pas une matrice théorique. Charge l'adapter (+
            l'infra correspondante) et il apparaît. Certaines briques déclarent
            en plus un factory par le cœur (ex. <Code>redis</Code> pour
            l'idempotence) : disponible par son nom, mais qui échoue franc si
            l'infra manque.
          </Text>
        </Alert>
        <Text size="sm">
          Dans la section <strong>Moteurs</strong>, chaque carte affiche{" "}
          <strong>ce qu'elle couvre ET ce qui lui manque</strong>. Les deux se
          lisent différemment : un moteur <strong>durable</strong> (SQL, Mongo)
          devrait être un chemin complet — on choisit une base de données, pas
          de perdre une brique — donc ses cases vides sont des{" "}
          <strong>manques</strong> (badge orange). Un <strong>cache</strong>
          (Redis) est borné par nature : ses cases vides sont affichées en
          neutre (« non porté »). Dans les deux cas elles sont montrées : les
          taire ferait passer une couverture partielle pour une couverture
          close.
        </Text>
      </Section>

      <Section
        icon={<IconRoute size={18} />}
        title="Stores et fonds de panier : deux choses différentes"
      >
        <Text size="sm">
          Un <strong>store</strong> répond à « <em>où dort cette donnée ?</em>{" "}
          ». Un <strong>fond de panier</strong> répond à «{" "}
          <em>par où passe ce flux entre mes serveurs ?</em> ». Quand une
          application tourne sur plusieurs serveurs (ou plusieurs processus),
          chacun ne voit que ce qui se passe chez lui : le fond de panier est le
          passage par lequel ils se rejoignent.
        </Text>
        <Text size="sm">
          Nodefony en a <strong>deux, indépendants</strong>, réglés séparément —
          l'onglet <strong>Fonds de panier</strong> montre l'état réel de chacun
          :
        </Text>
        <List size="sm" spacing="xs">
          <List.Item>
            <strong>Temps réel</strong> — répète aux autres serveurs les
            messages qui viennent d'arriver, pour que leurs clients les voient
            aussi. <strong>Il ne conserve rien</strong> : un message part vers
            ceux qui écoutent à cet instant, et un client déconnecté ne le
            rattrapera jamais (ni historique, ni rejeu). Mécanismes :{" "}
            <Code>loopback</Code> (tout reste dans le processus),{" "}
            <Code>cluster</Code> (relie les processus d'une machine),{" "}
            <Code>redis</Code> (relie des serveurs différents).
          </List.Item>
          <List.Item>
            <strong>Journaux</strong> — rassemble les journaux de tous les
            serveurs pour qu'on puisse les relire au même endroit.{" "}
            <strong>Celui-ci conserve</strong> : les lignes restent à la
            destination et se relisent des heures après. Les journaux sont
            toujours ÉCRITS sur la sortie standard ; ce réglage décide seulement
            d'où la console va les RELIRE.
          </List.Item>
        </List>
        <Alert variant="light" color="orange">
          <Text size="xs">
            La panne la plus discrète du temps réel : à plusieurs serveurs sans
            fond de panier partagé, chacun ne prévient que ses propres clients.
            Deux personnes ne se voient que si elles sont tombées sur le même
            serveur — <strong>sans erreur, sans log</strong>. L'onglet le
            signale explicitement quand le cas se présente.
          </Text>
        </Alert>
      </Section>

      <Section
        icon={<IconAlertTriangle size={18} />}
        title="Durabilité & volatilité"
      >
        <List size="sm" spacing="xs">
          <List.Item>
            <strong>durable</strong> (jetons, passkeys, audit, webhooks,
            utilisateurs) : la donnée doit survivre au redémarrage. Un store{" "}
            <Code>memory</Code> ici est <strong>volatil</strong> (⚠) — perdu au
            reboot et non partagé entre pods.
          </List.Item>
          <List.Item>
            <strong>éphémère</strong> (idempotence) : tolère la volatilité
            per-pod, mais en multi-pod un rejeu routé ailleurs n'est plus
            dédupliqué → préférer une infra partagée.
          </List.Item>
          <List.Item>
            <strong>session</strong> : cookie opaque + store révocable ;{" "}
            <Code>files</Code> convient en solo, un store partagé en cluster.
          </List.Item>
        </List>
        <Alert variant="light" color="orange">
          <Text size="xs">
            L'alerte orange en tête de page compte les briques durables tombées
            en <Code>memory</Code> : déclarer <Code>NF_DATABASE_URL</Code> (ou
            un store explicite persistant) pour les rendre durables.
          </Text>
        </Alert>
      </Section>

      <Section icon={<IconArchive size={18} />} title="Audit ≠ logs">
        <Text size="sm">
          Deux flux à ne pas confondre : l'<strong>audit</strong> (journal de
          conformité, durable) vit dans la base ; la{" "}
          <strong>relecture des logs</strong> (télémétrie) passe par l'infra
          logs (<Code>loki</Code>/<Code>opensearch</Code>), le sink d'écriture
          restant <Code>stdout</Code>. Le bandeau du haut montre l'infra logs
          déclarée pour la relecture, pas le journal d'audit.
        </Text>
      </Section>
    </Stack>
  );
}
