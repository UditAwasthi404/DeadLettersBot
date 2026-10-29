# Upgrade and database migration guide

AgentOS migrations are forward-only. Back up PostgreSQL and both blob buckets before deploying a new version. A rollback may require restoring both database and blob data from the same backup point; do not assume that an older binary can read data written by a newer version.

## Compose deployment

1. Review the release notes and migration files. Confirm the release's required environment variables and whether secrets or connector data need rotation.
2. Stop writes or schedule a maintenance window. The current Compose deployment does not promise zero-downtime upgrades.
3. Create a backup using `scripts/backup.sh` from an environment with `pg_dump` and AWS CLI v2. Keep the dump and exported buckets together and verify that the files exist.
4. Pull or check out the new version and rebuild/recreate the stack:

   ```sh
   docker compose --project-directory . -f infra/docker/docker-compose.yml up --build -d
   ```

   The Compose startup runs the configured migration command before starting the host.
5. Check `GET /health` and `GET /ready`, then inspect host and migration logs. Exercise bootstrap/authenticated API access and a representative turn before returning to normal traffic.
6. Keep the backup until the new version has operated successfully through your recovery window.

## Rollback

If the new host cannot operate safely, stop it and restore the PostgreSQL dump and blob buckets together using `scripts/restore.sh` with its explicit `--confirm` flag. Restore only into a deployment whose schema and blob format match that backup. Reapply any writes made after the backup only through an application-level recovery procedure; no automatic replay is provided.

## Kubernetes

The Helm chart is an initial single-host scaffold and has not been validated on a cluster. It has no zero-downtime migration job or rollback guarantee. Back up persistent volumes, apply upgrades in a maintenance window, and verify migrations and readiness manually. A production rolling-upgrade procedure remains future work.
