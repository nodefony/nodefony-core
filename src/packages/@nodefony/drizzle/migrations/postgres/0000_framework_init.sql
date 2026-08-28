-- nodefony:migration format=1
CREATE TABLE "access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text,
	"subjectId" text NOT NULL,
	"subjectType" text NOT NULL,
	"tenantId" text,
	"scopes" jsonb NOT NULL,
	"audience" jsonb NOT NULL,
	"resources" jsonb,
	"secretHash" text NOT NULL,
	"hashAlg" text NOT NULL,
	"clientId" text,
	"cnf" text,
	"family" text,
	"replacedBy" text,
	"createdAt" bigint NOT NULL,
	"expiresAt" bigint,
	"lastUsedAt" bigint,
	"lastUsedIp" text,
	"lastUsedUserAgent" text,
	"revokedAt" bigint,
	"revokedReason" text,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "access_token_secretHash_unique" UNIQUE("secretHash")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"actor" text,
	"resource" text,
	"reason" text,
	"ip" text,
	"userAgent" text,
	"requestId" text,
	"flags" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "denied_jti" (
	"jti" text PRIMARY KEY NOT NULL,
	"expiresAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"response" jsonb,
	"expiresAt" bigint NOT NULL,
	CONSTRAINT "idempotency_key_state_check" CHECK ("state" IN ('if', 'done'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"session_id" text PRIMARY KEY NOT NULL,
	"Attributes" jsonb,
	"flashBag" jsonb,
	"metaBag" jsonb,
	"user" text,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject_revocation" (
	"subjectId" text PRIMARY KEY NOT NULL,
	"invalidBefore" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_secret" (
	"userId" text PRIMARY KEY NOT NULL,
	"secretEnc" text NOT NULL,
	"algorithm" text NOT NULL,
	"digits" integer NOT NULL,
	"period" integer NOT NULL,
	"recoveryCodes" jsonb NOT NULL,
	"confirmedAt" bigint,
	"lastUsedStep" bigint,
	"createdAt" bigint NOT NULL,
	"lastUsedAt" bigint
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"password" text,
	"roles" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"locked" boolean NOT NULL,
	"currentRole" text,
	"socialProviders" jsonb NOT NULL,
	"metadata" jsonb NOT NULL,
	"createdAt" timestamp (3) with time zone NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "User_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "webauthn_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"publicKey" text NOT NULL,
	"signCount" bigint NOT NULL,
	"transports" jsonb NOT NULL,
	"backupEligible" boolean NOT NULL,
	"backupState" boolean NOT NULL,
	"uvInitialized" boolean NOT NULL,
	"nickname" text,
	"createdAt" bigint NOT NULL,
	"lastUsedAt" bigint
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"secretEnc" text NOT NULL,
	"events" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"description" text,
	"tenantId" text,
	"createdBy" text,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"lastDeliveryAt" bigint,
	"lastDeliveryStatus" integer,
	"lastDeliveryError" text,
	"failureCount" integer NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "access_token_subjectId_idx" ON "access_token" USING btree ("subjectId");--> statement-breakpoint
CREATE INDEX "access_token_family_idx" ON "access_token" USING btree ("family");--> statement-breakpoint
CREATE INDEX "audit_event_ts_idx" ON "audit_event" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "audit_event_category_idx" ON "audit_event" USING btree ("category");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "audit_event_requestId_idx" ON "audit_event" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "idempotency_key_expiresAt_idx" ON "idempotency_key" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user");--> statement-breakpoint
CREATE INDEX "webauthn_credential_userId_idx" ON "webauthn_credential" USING btree ("userId");