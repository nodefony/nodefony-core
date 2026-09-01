-- nodefony:migration format=1
CREATE TABLE `access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text,
	`subjectId` text NOT NULL,
	`subjectType` text NOT NULL,
	`tenantId` text,
	`scopes` text NOT NULL,
	`audience` text NOT NULL,
	`resources` text,
	`secretHash` text NOT NULL,
	`hashAlg` text NOT NULL,
	`clientId` text,
	`cnf` text,
	`family` text,
	`replacedBy` text,
	`createdAt` integer NOT NULL,
	`expiresAt` integer,
	`lastUsedAt` integer,
	`lastUsedIp` text,
	`lastUsedUserAgent` text,
	`revokedAt` integer,
	`revokedReason` text,
	`metadata` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_token_secretHash_unique` ON `access_token` (`secretHash`);--> statement-breakpoint
CREATE INDEX `access_token_subjectId_idx` ON `access_token` (`subjectId`);--> statement-breakpoint
CREATE INDEX `access_token_family_idx` ON `access_token` (`family`);--> statement-breakpoint
CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`category` text NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`actor` text,
	`resource` text,
	`reason` text,
	`ip` text,
	`userAgent` text,
	`requestId` text,
	`flags` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `audit_event_ts_idx` ON `audit_event` (`ts`);--> statement-breakpoint
CREATE INDEX `audit_event_category_idx` ON `audit_event` (`category`);--> statement-breakpoint
CREATE INDEX `audit_event_actor_idx` ON `audit_event` (`actor`);--> statement-breakpoint
CREATE INDEX `audit_event_requestId_idx` ON `audit_event` (`requestId`);--> statement-breakpoint
CREATE TABLE `denied_jti` (
	`jti` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_key` (
	`key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`response` text,
	`expiresAt` integer NOT NULL,
	CONSTRAINT "idempotency_key_state_check" CHECK("state" IN ('if', 'done'))
);
--> statement-breakpoint
CREATE INDEX `idempotency_key_expiresAt_idx` ON `idempotency_key` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`Attributes` text,
	`flashBag` text,
	`metaBag` text,
	`user` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user`);--> statement-breakpoint
CREATE TABLE `subject_revocation` (
	`subjectId` text PRIMARY KEY NOT NULL,
	`invalidBefore` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `totp_secret` (
	`userId` text PRIMARY KEY NOT NULL,
	`secretEnc` text NOT NULL,
	`algorithm` text NOT NULL,
	`digits` integer NOT NULL,
	`period` integer NOT NULL,
	`recoveryCodes` text NOT NULL,
	`confirmedAt` integer,
	`lastUsedStep` integer,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer
);
--> statement-breakpoint
CREATE TABLE `webauthn_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`publicKey` text NOT NULL,
	`signCount` integer NOT NULL,
	`transports` text NOT NULL,
	`backupEligible` integer NOT NULL,
	`backupState` integer NOT NULL,
	`uvInitialized` integer NOT NULL,
	`nickname` text,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer
);
--> statement-breakpoint
CREATE INDEX `webauthn_credential_userId_idx` ON `webauthn_credential` (`userId`);--> statement-breakpoint
CREATE TABLE `webhook_endpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`secretEnc` text NOT NULL,
	`events` text NOT NULL,
	`enabled` integer NOT NULL,
	`description` text,
	`tenantId` text,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`lastDeliveryAt` integer,
	`lastDeliveryStatus` integer,
	`lastDeliveryError` text,
	`failureCount` integer NOT NULL,
	`metadata` text NOT NULL
);
