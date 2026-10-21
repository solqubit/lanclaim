#!/usr/bin/env bash
# Shared Linux lifecycle helpers. Paths are intentionally fixed and owned by LanClaim.
set -Eeuo pipefail
APP_ROOT=/opt/lanclaim
DATA_ROOT=/var/lib/lanclaim
CONFIG_ROOT=/etc/lanclaim
UNIT=/etc/systemd/system/lanclaim.service
SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
root_linux() {
  [[ "$(uname -s)" == Linux ]] || die 'Estos scripts requieren Linux.'
  [[ "$EUID" == 0 ]] || die "Ejecuta con sudo: sudo $0"
  command -v flock >/dev/null || die 'Se requiere flock (util-linux).'
  exec 9>/run/lock/lanclaim.lock
  flock -n 9 || die 'Ya hay otra instalación, actualización o desinstalación en curso.'
  for directory in "$APP_ROOT" "$DATA_ROOT" "$CONFIG_ROOT"; do
    [[ ! -L "$directory" ]] || die "Ruta administrada convertida en enlace: $directory"
    [[ ! -e "$directory" || -f "$directory/.lanclaim-managed" ]] || die "La ruta $directory ya existe y no pertenece a esta instalación."
  done
  [[ ! -L "$UNIT" ]] || die 'La unidad systemd no puede ser un enlace simbólico.'
  if [[ -e "$UNIT" ]]; then
    grep -q '^# Managed by LanClaim$' "$UNIT" || die 'Ya existe una unidad de servicio ajena a LanClaim.'
  fi
}
require_systemd() {
  [[ -d /run/systemd/system ]] || die 'Se requiere systemd activo. En WSL2 habilita systemd en /etc/wsl.conf y reinicia WSL antes de instalar.'
  command -v systemctl >/dev/null || die 'No se encontró systemctl.'
}
require_python() {
  /usr/bin/python3 -c 'import sqlite3, sys; assert sys.version_info >= (3, 10)' 2>/dev/null || die 'Se requiere Python 3.10 o superior con sqlite3 en /usr/bin/python3. Consulta docs/OPERACION.md.'
}
install_python() {
  if /usr/bin/python3 -c 'import sqlite3, sys; assert sys.version_info >= (3, 10)' 2>/dev/null && command -v ip >/dev/null && command -v ping >/dev/null; then return; fi
  [[ -r /etc/os-release ]] || die 'No se puede identificar la distribución Linux.'
  # Standard operating-system metadata, not application input.
  . /etc/os-release
  printf 'Preparando Python en %s\n' "${PRETTY_NAME:-Linux}"
  if command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3 iproute2 iputils-ping
  elif command -v dnf >/dev/null; then
    dnf install -y python3 iproute iputils
  elif command -v zypper >/dev/null; then
    zypper --non-interactive install python3 python3-sqlite3 iproute2 iputils
  elif command -v pacman >/dev/null; then
    pacman -S --needed --noconfirm python iproute2 iputils
  else
    die 'Gestor de paquetes no soportado. Instala Python 3.10+ con sqlite3 y repite.'
  fi
  require_python
}
managed_directory() {
  local directory="$1"
  install -d -m 0755 "$directory"
  printf 'LanClaim managed directory\n' > "$directory/.lanclaim-managed"
}
prepare_release() {
  [[ -f "$SOURCE_ROOT/lanclaim/server.py" ]] || die 'Ejecuta desde una copia completa del repositorio.'
  RELEASE="$APP_ROOT/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
  install -d -m 0755 "$RELEASE/lanclaim" "$RELEASE/scripts"
  cp "$SOURCE_ROOT"/lanclaim/*.py "$RELEASE/lanclaim/"
  cp -R "$SOURCE_ROOT/lanclaim/static" "$RELEASE/lanclaim/"
  cp "$SOURCE_ROOT"/{install,update,uninstall}.sh "$RELEASE/"
  cp "$SOURCE_ROOT/scripts/common.sh" "$RELEASE/scripts/"
  chmod -R u=rwX,go=rX "$RELEASE"
  chmod 0755 "$RELEASE"/*.sh
  PYTHONPATH="$RELEASE" /usr/bin/python3 -c 'import lanclaim.server; print("Código de LanClaim validado")'
}
switch_release() {
  local destination="$1"
  local next="$APP_ROOT/.current-$$"
  [[ "$destination" == "$APP_ROOT"/releases/* && -d "$destination" ]] || die 'Destino de versión inválido.'
  [[ ! -e "$APP_ROOT/current" || -L "$APP_ROOT/current" ]] || die 'current debe ser un enlace de versión.'
  if [[ -L "$next" ]]; then rm -f -- "$next"; fi
  [[ ! -e "$next" ]] || die 'La ruta temporal de versión ya existe.'
  ln -s "$destination" "$next" || die 'No se pudo preparar el enlace de versión.'
  mv -Tf "$next" "$APP_ROOT/current" || die 'No se pudo activar la versión.'
}
write_unit() {
  cat > "$UNIT" <<'UNIT'
# Managed by LanClaim
[Unit]
Description=LanClaim personal IP inventory
After=network.target

[Service]
Type=simple
User=lanclaim
Group=lanclaim
WorkingDirectory=/opt/lanclaim/current
Environment=PYTHONDONTWRITEBYTECODE=1
EnvironmentFile=/etc/lanclaim/lanclaim.env
ExecStart=/usr/bin/python3 -m lanclaim.server
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/lanclaim
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
}
read_port() {
  PORT="$(sed -n 's/^LANCLAIM_PORT=//p' "$CONFIG_ROOT/lanclaim.env")"
  [[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1024 && "$PORT" -le 65535 ]] || die 'Puerto inválido en lanclaim.env.'
}
health() {
  read_port
  /usr/bin/python3 - "$PORT" <<'PY'
import json, sys, time, urllib.request
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(20):
    try:
        with opener.open('http://127.0.0.1:' + sys.argv[1] + '/api/health', timeout=2) as response:
            data = json.load(response)
            if data.get('ok') and data.get('version'):
                sys.exit(0)
    except Exception:
        time.sleep(0.5)
sys.exit('El servicio no superó la comprobación de salud.')
PY
  systemctl is-active --quiet lanclaim
}
show_urls() {
  read_port
  printf '\nLanClaim listo. Acceso local: http://localhost:%s\n' "$PORT"
  local address
  for address in $(hostname -I 2>/dev/null || true); do
    if [[ "$address" != *:* ]]; then printf 'URL candidata desde tu red: http://%s:%s\n' "$address" "$PORT"; fi
  done
  printf 'En VM/WSL2 el acceso depende del modo de red, reenvío y firewall. No se modifica el firewall automáticamente.\n'
  printf 'Datos: %s\nConfiguración: %s/lanclaim.env\n' "$DATA_ROOT" "$CONFIG_ROOT"
}
