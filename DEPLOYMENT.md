# Deployment and recovery

The code does not contain a production database, encryption key, email provider key, DNS name, SSH credential, or backup destination. Configure those before inviting beta users. Never reuse the public local-test passwords for a deployment.

1. Install Docker with Compose on a Linux VPS with 4 vCPU / 8 GB RAM or more. Keep the host kernel and Docker patched. Permit only SSH from trusted administrator IPs and public 80/443.
2. Copy `.env.example` to a private `.env`; set independent random auth and encryption keys, database/Redis passwords, the public URLs, and Resend sender credentials.
3. `docker compose build`, then `docker compose up -d postgres redis`, then `docker compose run --rm web pnpm db:migrate`, then `docker compose up -d`.
4. Register and verify the administrator's account, promote that exact account through an operator-controlled DB session, and verify normal users cannot access administration.
5. Confirm browser connections over WSS, sandbox launch, private-network rejection, two-job resource usage, cancellation, rate limits, and retention. A Chromium sandbox failure must be fixed at the host/seccomp layer; do not disable the sandbox.
6. Configure off-host backups below; restore into a new isolated database and verify counts before launch. Perform the authorized live target test, email verification and password reset through the actual public hostname.

## Backups

`scripts/backup.sh` streams a custom-format pg_dump into GPG AES256 encryption and transfers the ciphertext through SCP with strict SSH host-key checking. Configure PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE, BACKUP_DEST, and BACKUP_PASSPHRASE_FILE. Keep the backup passphrase separately from the application encryption key. Store SSH keys and known_hosts outside this repository.

For daily execution, build `docker/backup.Dockerfile` and deploy it with read-only mounts for the passphrase, SSH identity and known_hosts, the PostgreSQL network, and the external backup destination. It exits on failure so monitoring can report a missed backup; do not configure an unbounded rapid restart loop. Apply off-host lifecycle retention (30 daily copies by default). This backup service requires operator-provided credentials and destination, so it is not started by the default Compose file.

`scripts/restore.sh` decrypts a backup into RESTORE_DATABASE_URL using pg_restore --exit-on-error. It intentionally has no destructive --clean option. Create a new empty database, restore, apply any later migrations, compare user/scraper/version/result counts, and run authentication and extraction tests before switching the web and worker DATABASE_URL values. Preserve the old DB until verification is complete.

## Key rotation

New secrets use envelope encryption: a random per-record data key is wrapped by the master key with tenant/domain authenticated data. ENCRYPTION_KEY_ID defaults to 1. For a new key, retain the old one as ENCRYPTION_KEY_1 and set ENCRYPTION_KEY_ID=2 and ENCRYPTION_KEY to the new base64 key. Historical records remain decryptable until re-encrypted. Keep historical keys with backup recovery material; deleting a key makes its encrypted records unrecoverable.

## Operations

Worker `/health` checks DB and Redis; `/metrics` exposes process metrics and completed-run counters only on the internal network. Monitor memory, restarts, queue latency, failed/blocked runs, backup freshness, email failures and disk space. Domain blocks, suspensions, reports and quotas are in the administration UI. Expired JSON is deleted after 30 days and public diagnostics after seven days. Authenticated-page screenshots are intentionally not retained.

The Docker worker image is built with the exact Playwright dependency and downloaded browser revision. Each execution launches a separate sandboxed Chromium process and isolated context. One VPS remains a single failure domain; take capacity and isolation measurements before increasing the two-worker concurrency.
