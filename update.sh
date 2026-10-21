#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/common.sh"
root_linux
require_systemd
require_python
[[ -L "$APP_ROOT/current" && -f "$CONFIG_ROOT/lanclaim.env" && -f "$UNIT" ]] || die 'Primero instala LanClaim con install.sh.'
PREVIOUS="$(readlink -f "$APP_ROOT/current")"
[[ "$PREVIOUS" == "$APP_ROOT"/releases/* && -d "$PREVIOUS" ]] || die 'La versión actual no pertenece a LanClaim.'
prepare_release
install -d -m 0700 "$DATA_ROOT/backups"
BACKUP="$DATA_ROOT/backups/before-$(date -u +%Y%m%dT%H%M%S)-$$.sqlite3"
UNIT_BACKUP="$DATA_ROOT/backups/unit-$(date -u +%Y%m%dT%H%M%S)-$$.service"
cp "$UNIT" "$UNIT_BACKUP"
backup_ready=0
rollback() {
  local code=$?
  trap - ERR
  set +e
  printf 'Actualización fallida. Restaurando código y datos anteriores…\n' >&2
  systemctl stop lanclaim
  switch_release "$PREVIOUS"
  if [[ "$backup_ready" == 1 ]]; then
    rm -f -- "$DATA_ROOT/lanclaim.sqlite3-wal" "$DATA_ROOT/lanclaim.sqlite3-shm"
    cp "$BACKUP" "$DATA_ROOT/lanclaim.sqlite3"
    chown lanclaim:lanclaim "$DATA_ROOT/lanclaim.sqlite3"
    chmod 0600 "$DATA_ROOT/lanclaim.sqlite3"
  fi
  cp "$UNIT_BACKUP" "$UNIT"
  systemctl daemon-reload
  systemctl start lanclaim
  if health; then printf 'Versión anterior recuperada. Copia: %s\n' "$BACKUP" >&2;
  else printf 'La recuperación necesita atención. Revisa journalctl -u lanclaim y docs/OPERACION.md.\n' >&2; fi
  exit "$code"
}
trap rollback ERR
systemctl stop lanclaim
PYTHONPATH="$PREVIOUS" /usr/bin/python3 -m lanclaim.server --data-dir "$DATA_ROOT" --backup "$BACKUP"
chmod 0600 "$BACKUP"
backup_ready=1
switch_release "$RELEASE"
write_unit
systemctl start lanclaim
health
trap - ERR
printf 'Actualización completada. Copia previa: %s\n' "$BACKUP"
show_urls
