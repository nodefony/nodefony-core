-- nodefony:migration format=1
CREATE TABLE `access_token` (
	`id` varchar(512) NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text,
	`subjectId` varchar(512) NOT NULL,
	`subjectType` text NOT NULL,
	`tenantId` text,
	`scopes` json NOT NULL,
	`audience` json NOT NULL,
	`resources` json,
	`secretHash` varchar(512) NOT NULL,
	`hashAlg` text NOT NULL,
	`clientId` text,
	`cnf` text,
	`family` varchar(512),
	`replacedBy` text,
	`createdAt` bigint NOT NULL,
	`expiresAt` bigint,
	`lastUsedAt` bigint,
	`lastUsedIp` text,
	`lastUsedUserAgent` text,
	`revokedAt` bigint,
	`revokedReason` text,
	`metadata` json NOT NULL,
	CONSTRAINT `access_token_id` PRIMARY KEY(`id`),
	CONSTRAINT `access_token_secretHash_unique` UNIQUE(`secretHash`)
);
--> statement-breakpoint
CREATE TABLE `audit_event` (
	`id` varchar(512) NOT NULL,
	`ts` bigint NOT NULL,
	`category` varchar(512) NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`actor` varchar(512),
	`resource` text,
	`reason` text,
	`ip` text,
	`userAgent` text,
	`requestId` varchar(512),
	`flags` json,
	`metadata` json,
	CONSTRAINT `audit_event_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `denied_jti` (
	`jti` varchar(512) NOT NULL,
	`expiresAt` bigint NOT NULL,
	CONSTRAINT `denied_jti_jti` PRIMARY KEY(`jti`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_key` (
	`key` varchar(512) NOT NULL,
	`fingerprint` text NOT NULL,
	`state` varchar(64) NOT NULL,
	`response` json,
	`expiresAt` bigint NOT NULL,
	CONSTRAINT `idempotency_key_key` PRIMARY KEY(`key`),
	CONSTRAINT `idempotency_key_state_check` CHECK(`state` IN ('if', 'done'))
);
--> statement-breakpoint
CREATE TABLE `session` (
	`session_id` varchar(512) NOT NULL,
	`Attributes` json,
	`flashBag` json,
	`metaBag` json,
	`user` varchar(512),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `session_session_id` PRIMARY KEY(`session_id`)
);
--> statement-breakpoint
CREATE TABLE `subject_revocation` (
	`subjectId` varchar(512) NOT NULL,
	`invalidBefore` bigint NOT NULL,
	CONSTRAINT `subject_revocation_subjectId` PRIMARY KEY(`subjectId`)
);
--> statement-breakpoint
CREATE TABLE `totp_secret` (
	`userId` varchar(512) NOT NULL,
	`secretEnc` text NOT NULL,
	`algorithm` text NOT NULL,
	`digits` int NOT NULL,
	`period` int NOT NULL,
	`recoveryCodes` json NOT NULL,
	`confirmedAt` bigint,
	`lastUsedStep` bigint,
	`createdAt` bigint NOT NULL,
	`lastUsedAt` bigint,
	CONSTRAINT `totp_secret_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `webauthn_credential` (
	`id` varchar(512) NOT NULL,
	`userId` varchar(512) NOT NULL,
	`publicKey` text NOT NULL,
	`signCount` bigint NOT NULL,
	`transports` json NOT NULL,
	`backupEligible` boolean NOT NULL,
	`backupState` boolean NOT NULL,
	`uvInitialized` boolean NOT NULL,
	`nickname` text,
	`createdAt` bigint NOT NULL,
	`lastUsedAt` bigint,
	CONSTRAINT `webauthn_credential_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoint` (
	`id` varchar(512) NOT NULL,
	`url` text NOT NULL,
	`secretEnc` text NOT NULL,
	`events` json NOT NULL,
	`enabled` boolean NOT NULL,
	`description` text,
	`tenantId` text,
	`createdBy` text,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	`lastDeliveryAt` bigint,
	`lastDeliveryStatus` int,
	`lastDeliveryError` text,
	`failureCount` int NOT NULL,
	`metadata` json NOT NULL,
	CONSTRAINT `webhook_endpoint_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `access_token_subjectId_idx` ON `access_token` (`subjectId`);--> statement-breakpoint
CREATE INDEX `access_token_family_idx` ON `access_token` (`family`);--> statement-breakpoint
CREATE INDEX `audit_event_ts_idx` ON `audit_event` (`ts`);--> statement-breakpoint
CREATE INDEX `audit_event_category_idx` ON `audit_event` (`category`);--> statement-breakpoint
CREATE INDEX `audit_event_actor_idx` ON `audit_event` (`actor`);--> statement-breakpoint
CREATE INDEX `audit_event_requestId_idx` ON `audit_event` (`requestId`);--> statement-breakpoint
CREATE INDEX `idempotency_key_expiresAt_idx` ON `idempotency_key` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user`);--> statement-breakpoint
CREATE INDEX `webauthn_credential_userId_idx` ON `webauthn_credential` (`userId`);