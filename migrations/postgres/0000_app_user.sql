-- nodefony:migration format=1
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
