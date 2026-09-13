#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_DEST:?Set an scp destination outside this server}"
: "${BACKUP_PASSPHRASE_FILE:?Mount a backup passphrase file}"
: "${PGHOST:?Set PostgreSQL host}"
: "${PGDATABASE:?Set PostgreSQL database}"
# PGP encryption is independent of the application encryption key.
backup_work=$(mktemp -d)
backup_file="$backup_work/scrapepilot-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg"
trap 'find "$backup_work" -type f -delete; rmdir "$backup_work"' EXIT
pg_dump --format=custom --no-owner --no-acl | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --symmetric --cipher-algo AES256 --output "$backup_file"
test -s "$backup_file"
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$backup_file" "$BACKUP_DEST"
printf 'Encrypted database backup transferred successfully.\n'
