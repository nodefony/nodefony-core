import { StubPage } from "../components/StubPage";

export const Sessions = () => (
  <StubPage
    title="Sessions"
    description="Liste + invalidation des sessions actives. Lecture via IAdminApi de @nodefony/http."
    phase="P10.3 + P5.11"
    legacyRef="monitoring-bundle/views/sessions/"
  />
);

export const Users = () => (
  <StubPage
    title="Users"
    description="CRUD utilisateurs, rôles, MFA. Lecture via IUserProvider (@nodefony/user)."
    phase="P10.4 + P5.5"
    legacyRef="monitoring-bundle/views/users/"
  />
);

export const Firewall = () => (
  <StubPage
    title="Firewall"
    description="SecuredAreas + factories + statistiques auth (success/failure/locked)."
    phase="P10.4 + P6.3"
    legacyRef="monitoring-bundle/views/firewall/"
  />
);

export const Services = () => (
  <StubPage
    title="Services"
    description="Container DI — services enregistrés, scope, dépendances."
    phase="P10.10"
    legacyRef="monitoring-bundle/views/service/"
  />
);

export const Modules = () => (
  <StubPage
    title="Modules"
    description="Modules Nodefony chargés (ex-bundles), versions, état boot/ready."
    phase="P10.5"
    legacyRef="monitoring-bundle/views/bundles/"
  />
);

export const Npm = () => (
  <StubPage
    title="NPM"
    description="Dépendances installées, vulnérabilités, audit, outdated."
    phase="P10.10"
    legacyRef="monitoring-bundle/views/npm/"
  />
);

export const Profiling = () => (
  <StubPage
    title="Profiling"
    description="CPU flamegraph, heap snapshots, latency p50/p95/p99 par route."
    phase="P10.10 + P8.4 Metrics"
    legacyRef="monitoring-bundle/views/profiling/"
  />
);

export const Migrate = () => (
  <StubPage
    title="Migrations"
    description="Status migrations ORM, apply/rollback, history."
    phase="P11.4 + P7.x"
    legacyRef="monitoring-bundle/views/migrate/"
  />
);

export const Settings = () => (
  <StubPage
    title="Settings"
    description="Préférences UI (theme, sidebar), tokens API, locale, notifications."
    phase="P10.7"
  />
);

export const NotFound = () => (
  <StubPage
    title="404 — Page introuvable"
    description="La page demandée n'existe pas dans Studio."
  />
);
