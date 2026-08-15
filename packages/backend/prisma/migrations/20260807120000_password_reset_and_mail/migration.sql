-- Password reset for local accounts + a transactional mail transport.

-- Feature flag. Opt-in: an upgrading install must not gain a new unauthenticated auth surface
-- without the admin turning it on.
ALTER TABLE "AppSettings" ADD COLUMN "passwordResetEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Only the SHA-256 of the token is stored; the raw value exists solely in the email we send, so
-- read access to this table cannot mint a working reset link.
CREATE TABLE "PasswordResetToken" (
    "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"    INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt"    DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- Singleton (id = 1). `config` holds an encrypted JSON blob on the same AES-256-GCM path as
-- Service.config. Environment variables override this row entirely when set.
CREATE TABLE "MailConfig" (
    "id"        INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "enabled"   BOOLEAN NOT NULL DEFAULT false,
    "transport" TEXT NOT NULL DEFAULT 'smtp',
    "config"    TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "MailConfig" ("id", "enabled", "transport", "config", "updatedAt")
VALUES (1, false, 'smtp', '{}', CURRENT_TIMESTAMP);

-- Patchnote 0.8.9 seed. Idempotent: ON CONFLICT ("version") DO NOTHING.
INSERT INTO "Patchnote" ("version", "type", "date", "titleEn", "titleFr", "entries") VALUES
('0.8.9', 'minor', '2026-08-07T12:00:00.000Z', 'Users can recover their own password', 'Les utilisateurs peuvent récupérer leur mot de passe', '[{"type":"feature","titleEn":"Password reset by email","titleFr":"Réinitialisation du mot de passe par email","descEn":"A user who signed up with an email and password can now request a reset link instead of asking an admin. Accounts that sign in through Plex, Jellyfin, Emby or Discord are untouched — they recover through their own provider.","descFr":"Un utilisateur inscrit avec un email et un mot de passe peut désormais demander un lien de réinitialisation au lieu de solliciter un administrateur. Les comptes qui se connectent via Plex, Jellyfin, Emby ou Discord ne sont pas concernés — ils passent par leur propre fournisseur."},{"type":"feature","titleEn":"SMTP support","titleFr":"Prise en charge du SMTP","descEn":"Oscarr can now send mail through your own SMTP server, not only through Resend. Configure it in Admin > Settings > Mail, or entirely through environment variables if you prefer your compose file to stay the source of truth.","descFr":"Oscarr peut désormais envoyer des mails via ton propre serveur SMTP, et plus seulement via Resend. Ça se règle dans Admin > Paramètres > Mail, ou entièrement par variables d''environnement si tu préfères que ton fichier compose reste la source de vérité."},{"type":"feature","titleEn":"Off by default","titleFr":"Désactivé par défaut","descEn":"Password reset stays disabled until you enable it, and can be turned off again at any time. Credentials for the mail transport are encrypted at rest like every other service credential.","descFr":"La réinitialisation reste désactivée tant que tu ne l''actives pas, et peut être coupée à tout moment. Les identifiants du transport mail sont chiffrés au repos comme toute autre config de service."}]')
ON CONFLICT ("version") DO NOTHING;
