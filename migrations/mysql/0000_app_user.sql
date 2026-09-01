-- nodefony:migration format=1
CREATE TABLE `User` (
	`id` varchar(512) NOT NULL,
	`identifier` varchar(512) NOT NULL,
	`password` text,
	`roles` json NOT NULL,
	`enabled` boolean NOT NULL,
	`locked` boolean NOT NULL,
	`currentRole` text,
	`socialProviders` json NOT NULL,
	`metadata` json NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `User_id` PRIMARY KEY(`id`),
	CONSTRAINT `User_identifier_unique` UNIQUE(`identifier`)
);
