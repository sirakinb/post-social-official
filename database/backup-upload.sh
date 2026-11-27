# The second half of the nightly backup: sends the dump that database/backup-dump.sh left in
# $WORK_DIR to our backup bucket. Starts only if the dump container finished without error.
#
#   daily/<name>-YYYY-MM-DD.dump     every run (the bucket keeps these 30 days)
#   monthly/<name>-YYYY-MM.dump      on the 1st, or when MONTHLY=true (kept 12 months)
#
# The task's role can add files to those two folders and do nothing else: it can't read,
# list or delete what is there.
set -euo pipefail
: "${WORK_DIR:?}" "${BACKUP_NAME:?}" "${BUCKET:?}"

shopt -s nullglob
dumps=("$WORK_DIR"/"$BACKUP_NAME"-*.dump)
[[ "${#dumps[@]}" -eq 1 ]] || { echo "Expected one dump in $WORK_DIR, found ${#dumps[@]}." >&2; exit 1; }
path="${dumps[0]}"
file="$(basename "$path")"
[[ "$file" =~ -([0-9]{4}-[0-9]{2})-([0-9]{2})\.dump$ ]] || { echo "The dump's name carries no date: $file" >&2; exit 1; }
month="${BASH_REMATCH[1]}"
day="${BASH_REMATCH[2]}"

aws s3 cp "$path" "s3://$BUCKET/daily/$file" --only-show-errors
echo "Saved daily/$file"
if [[ "$day" == "01" || "${MONTHLY:-}" == "true" ]]; then
  aws s3 cp "$path" "s3://$BUCKET/monthly/$BACKUP_NAME-$month.dump" --only-show-errors
  echo "Saved monthly/$BACKUP_NAME-$month.dump"
fi
