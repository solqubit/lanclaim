#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/common.sh"
root_linux
require_systemd
if [[ -L "$APP_ROOT/current" && -f "$UNIT" ]]; then
  printf 'LanClaim ya está instalado. Para actualizar: sudo ./update.sh\n'
  exit 0
fi
install_python
command -v useradd >/dev/null || die 'Se requiere useradd para crear la cuenta del servicio.'
if getent passwd lanclaim >/dev/null; then
  [[ -f "$CONFIG_ROOT/service-user-owned" ]] || die 'La cuenta lanclaim ya existe y no fue creada por este instalador.'
else
  if getent group lanclaim >/dev/null; then die 'El grupo lanclaim ya existe y no pertenece a esta instalación.'; fi
fi
for directory in "$APP_ROOT" "$DATA_ROOT" "$CONFIG_ROOT"; do managed_directory "$directory"; done
if ! getent passwd lanclaim >/dev/null; then
  useradd --system --user-group --home-dir "$DATA_ROOT" --no-create-home --shell /usr/sbin/nologin lanclaim
  touch "$CONFIG_ROOT/service-user-owned"
fi
chown -R lanclaim:lanclaim "$DATA_ROOT"
chmod 0700 "$DATA_ROOT"
chmod 0750 "$CONFIG_ROOT"
if [[ ! -f "$CONFIG_ROOT/lanclaim.env" ]]; then
  port="${LANCLAIM_PORT:-8080}"
  [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1024 && "$port" -le 65535 ]] || die 'LANCLAIM_PORT debe estar entre 1024 y 65535.'
  cat > "$CONFIG_ROOT/lanclaim.env" <<ENV
LANCLAIM_HOST=0.0.0.0
LANCLAIM_PORT=$port
LANCLAIM_DATA_DIR=/var/lib/lanclaim
LANCLAIM_ALLOWED_HOSTS=
LANCLAIM_SCAN_INTERVAL=300
ENV
  chmod 0600 "$CONFIG_ROOT/lanclaim.env"
fi
prepare_release
switch_release "$RELEASE"
write_unit
systemctl enable --now lanclaim
if ! health; then
  systemctl stop lanclaim
  printf 'Instalación guardada, pero el servicio no arrancó. Revisa: journalctl -u lanclaim\n' >&2
  exit 1
fi
show_urls
