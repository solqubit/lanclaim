#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/common.sh"
root_linux
purge=0
case "${1:-}" in
  '') ;;
  --purge) purge=1 ;;
  *) die 'Uso: sudo ./uninstall.sh [--purge]' ;;
esac
[[ "$#" -le 1 ]] || die 'Uso: sudo ./uninstall.sh [--purge]'
if [[ "$purge" == 1 ]]; then
  printf 'Se eliminarán código, configuración, inventario, historial y copias de LanClaim en:\n%s\n%s\n%s\n' "$APP_ROOT" "$DATA_ROOT" "$CONFIG_ROOT"
  read -r -p 'Escribe PURGAR para confirmar: ' answer
  [[ "$answer" == PURGAR ]] || die 'Purga cancelada.'
fi
if [[ -f "$UNIT" ]]; then
  require_systemd
  systemctl disable --now lanclaim
  rm -f -- "$UNIT"
  systemctl daemon-reload
  systemctl reset-failed lanclaim 2>/dev/null || true
fi
# root_linux verifies fixed absolute paths, ownership markers and symlink absence.
if [[ -d "$APP_ROOT" ]]; then rm -rf --one-file-system -- "$APP_ROOT"; fi
if [[ "$purge" == 1 ]]; then
  if [[ -f "$CONFIG_ROOT/service-user-owned" ]] && getent passwd lanclaim >/dev/null; then
    userdel lanclaim
    if getent group lanclaim >/dev/null; then groupdel lanclaim; fi
  fi
  if [[ -d "$DATA_ROOT" ]]; then rm -rf --one-file-system -- "$DATA_ROOT"; fi
  if [[ -d "$CONFIG_ROOT" ]]; then rm -rf --one-file-system -- "$CONFIG_ROOT"; fi
  printf 'LanClaim purgado. No se han eliminado dependencias compartidas ni copias externas.\n'
else
  printf 'Aplicación desinstalada. Datos conservados en %s y configuración en %s.\n' "$DATA_ROOT" "$CONFIG_ROOT"
  printf 'Reinstala para recuperar el inventario o usa uninstall.sh --purge para eliminarlo.\n'
fi
