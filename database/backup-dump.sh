# The first half of the nightly backup: dumps this environment's database into $WORK_DIR and
# checks the dump holds real data. The second half (database/backup-upload.sh) runs in the
# next container of the same task and sends the file to our backup bucket.
#
# Runs inside our network as a one-off ECS task (infra/aws/lib/backup-stack.ts), because the
# database accepts no connection from anywhere else. Postgres's own tools read the usual
# PG* settings (host, port, database, user, password, sslmode).
#
# It only reads: the session refuses any statement that would write.
set -euo pipefail
: "${WORK_DIR:?}" "${BACKUP_NAME:?}" "${MIN_PUBLIC_TABLES:?}" "${MIN_BYTES:?}"
export PGOPTIONS="-c default_transaction_read_only=on"

file="$BACKUP_NAME-$(date -u +%Y-%m-%d).dump"
rm -f "$WORK_DIR"/*.dump
pg_dump --version
pg_dump --format=custom --compress=9 --file="$WORK_DIR/$file"

# A wiped or half-empty database must fail the run, not quietly save an empty file.
pg_restore --list "$WORK_DIR/$file" > "$WORK_DIR/list.txt"
public_tables="$(grep -c " TABLE DATA public " "$WORK_DIR/list.txt" || true)"
users="$(psql -Atc "select count(*) from auth.users")"
bytes="$(stat -c %s "$WORK_DIR/$file")"
rm -f "$WORK_DIR/list.txt"
echo "Tables with data in public: $public_tables. Users: $users. Dump size: $bytes bytes."
[[ "$public_tables" -ge "$MIN_PUBLIC_TABLES" ]] || { echo "Only $public_tables public tables in the dump (expected at least $MIN_PUBLIC_TABLES)." >&2; exit 1; }
[[ "$users" -gt 0 ]] || { echo "auth.users is empty." >&2; exit 1; }
[[ "$bytes" -ge "$MIN_BYTES" ]] || { echo "The dump is only $bytes bytes (expected at least $MIN_BYTES)." >&2; exit 1; }
echo "Dumped $file"
