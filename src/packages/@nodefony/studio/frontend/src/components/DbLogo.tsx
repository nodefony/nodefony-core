import sqlite from "../assets/db-logos/sqlite.svg";
import postgresql from "../assets/db-logos/postgresql.svg";
import mysql from "../assets/db-logos/mysql.svg";
import mariadb from "../assets/db-logos/mariadb.svg";
import mongodb from "../assets/db-logos/mongodb.svg";
import redis from "../assets/db-logos/redis.svg";
import drizzle from "../assets/db-logos/drizzle.svg";
import sequelize from "../assets/db-logos/sequelize.svg";

/**
 * Table de logos par nom de **driver/base** (sqlite, postgres…) OU de **vendor
 * ORM** (drizzle, sequelize…). Logos officiels (devicon colorés ; drizzle =
 * simple-icons recoloré). Mongoose réutilise le logo MongoDB (sa base).
 */
const LOGOS: Record<string, string> = {
  // Bases / drivers
  sqlite,
  "better-sqlite3": sqlite,
  postgres: postgresql,
  postgresql,
  pg: postgresql,
  mysql,
  mysql2: mysql,
  mariadb,
  mongodb,
  mongoose: mongodb,
  redis,
  // ORM (vendor)
  drizzle,
  sequelize,
};

/** `true` si un logo existe pour ce nom (driver ou vendor). */
export function hasDbLogo(name?: string): boolean {
  return !!name && name.toLowerCase() in LOGOS;
}

/**
 * Logo d'une base de données ou d'un ORM, rendu en `<img>` (SVG officiel). Rend
 * `null` si aucun logo connu → l'appelant fournit un fallback (icône générique).
 */
export function DbLogo({
  name,
  size = 20,
  title,
}: {
  /** Nom du driver/base ou du vendor ORM (insensible à la casse). */
  name?: string;
  size?: number;
  /** Texte alternatif (a11y). */
  title?: string;
}) {
  const src = LOGOS[(name ?? "").toLowerCase()];
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={title ?? name ?? ""}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
