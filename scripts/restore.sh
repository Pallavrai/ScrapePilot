#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set a NEW empty restoration database URL}"
: "${BACKUP_PASSPHRASE_FILE:?Set backup passphrase file}"
test "$#" -eq 1 || { printf 'Usage: restore.sh path/to/backup.dump.gpg\n'; exit 2; }
# Deliberately no --clean: restoration must use a new empty database.
gpg --batch --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt "$1" | pg_restore --exit-on-error --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL"
printf 'Restore complete. Run migrations and verify row counts before switching traffic.\n'
