# Operación de LanClaim 2.0.0

## Requisitos y alcance

Python 3.10 o superior con `sqlite3`, Bash, systemd activo y `flock` (util-linux). El instalador reconoce apt, dnf, zypper y pacman para preparar Python e iproute/iproute2. La versión del intérprete en `/usr/bin/python3` se valida antes de instalar; si la distribución proporciona una versión demasiado antigua, se detiene con un diagnóstico.

La aplicación es de uso personal en red de confianza y no incluye autenticación. El servicio instalado escucha en `0.0.0.0:8080`. Para exposición fuera de una red confiable, utiliza un proxy HTTPS con autenticación o una VPN; no abras el puerto directamente a Internet. El servidor comprueba Host/origen, exige JSON y token CSRF en cambios y escapa el contenido del usuario en la interfaz.

## Instalación y acceso

Desde una copia del repositorio:

```bash
chmod +x install.sh update.sh uninstall.sh
sudo ./install.sh
```

El instalador crea una cuenta de servicio `lanclaim`, una unidad `lanclaim.service` y directorios propios con marcadores de gestión. No adopta directorios o cuentas preexistentes ajenos. Una segunda instalación sobre una instalación completa informa que ya existe y conserva los datos.

Al terminar, muestra URL local y direcciones IPv4 candidatas. No modifica el firewall. Desde otro equipo utiliza la IP del servidor y el puerto configurado, siempre que la red y el firewall lo permitan.

En VM, configura la red de la VM según tu entorno (puente o NAT con reenvío). En WSL2 se requiere systemd activo. Cuando aún no esté habilitado, integra esta sección en `/etc/wsl.conf` sin sobrescribir otras opciones:

```ini
[boot]
systemd=true
```

Reinicia WSL desde Windows cuando no haya trabajo en curso y comprueba `systemctl`. Las IP internas de WSL pueden cambiar; acceso local desde Windows y acceso desde la LAN son rutas diferentes. Al añadir una red, LanClaim sugiere las subredes del servidor, que pueden diferir de la LAN que quieres administrar; escribe esa subred manualmente cuando corresponda.

## Configuración

Archivo `/etc/lanclaim/lanclaim.env`, legible por root y cargado por systemd:

```ini
LANCLAIM_HOST=0.0.0.0
LANCLAIM_PORT=8080
LANCLAIM_DATA_DIR=/var/lib/lanclaim
LANCLAIM_ALLOWED_HOSTS=
LANCLAIM_SCAN_INTERVAL=300
```

`LANCLAIM_SCAN_INTERVAL` fija los segundos entre pings automáticos de las direcciones vigiladas; `0` los desactiva (el botón **Escanear ahora** sigue funcionando). Las instalaciones anteriores no tienen esta línea y usan el valor por defecto, 300.

Se admiten `localhost`, los nombres locales del servidor y direcciones IP literales. Para un nombre propio añade, por ejemplo, `LANCLAIM_ALLOWED_HOSTS=lanclaim.interna.example` sin esquema, ruta ni puerto. Un proxy debe conservar Host y el origen del navegador. Tras editar, ejecuta `sudo systemctl restart lanclaim`.

Mantén `LANCLAIM_DATA_DIR=/var/lib/lanclaim` en la instalación gestionada: actualización, respaldo, recuperación y permisos del servicio usan esa ruta. Para pruebas manuales fuera del servicio puedes usar `python3 -m lanclaim.server --data-dir /ruta/propia --port 8090`.

## Actualizar

En el checkout del código:

```bash
git pull --ff-only
sudo ./update.sh
```

**Desde la versión 0.x:** la versión 2 empieza con el inventario vacío. Al primer arranque descarta la base anterior (planes, máquinas, historial…). La copia `before-…sqlite3` que crea `update.sh` queda en `/var/lib/lanclaim/backups`.

El script prepara una versión en `/opt/lanclaim/releases`, detiene el servicio, crea una copia SQLite consistente en `/var/lib/lanclaim/backups`, cambia el enlace `current`, inicia y comprueba el servicio. Si falla, restaura el código, la unidad y la base de datos anterior y comprueba la recuperación. Las versiones previas y copias se conservan. El script no realiza `git pull` por su cuenta ni decide la rama a desplegar.

Si el servidor arranca pero una operación falla, consulta `sudo journalctl -u lanclaim -n 100`. No borres la base ni reinstales con purga para solucionar un error de arranque.

## Copias y recuperación manual

Para crear una copia coherente mientras la aplicación está en uso:

```bash
cd /opt/lanclaim/current
sudo /usr/bin/python3 -m lanclaim.server --data-dir /var/lib/lanclaim --backup /ruta/segura/lanclaim.sqlite3
```

El directorio de destino debe existir. Restringe el acceso a esa copia; contiene el inventario. No copies solamente el archivo SQLite en caliente con `cp`, porque puede haber cambios en el WAL.

Si la recuperación automática no logra arrancar el servicio:

1. Detén `lanclaim` y conserva una copia del estado fallido para diagnóstico.
2. Identifica el respaldo `before-…sqlite3`, la unidad `unit-…service` y la versión anterior en `/opt/lanclaim/releases` de la misma actualización.
3. Con el servicio detenido, restaura esa base en `/var/lib/lanclaim/lanclaim.sqlite3` y elimina únicamente sus archivos auxiliares `lanclaim.sqlite3-wal` y `lanclaim.sqlite3-shm` antes de abrirla.
4. Restaura el enlace `current` a la versión compatible y la unidad respaldada; ajusta propietario de la base a `lanclaim:lanclaim` y permisos a `0600`.
5. Ejecuta `systemctl daemon-reload`, inicia el servicio y verifica `/api/health` y el inventario. No mezcles un respaldo nuevo con código incompatible.

## Desinstalar y purgar

`sudo ./uninstall.sh` detiene y elimina el servicio y el código. Conserva base, copias, configuración y cuenta del servicio para poder reinstalar y recuperar el inventario.

`sudo ./uninstall.sh --purge` requiere escribir `PURGAR`; elimina código, servicio, datos, copias internas, configuración y la cuenta propia. Se puede ejecutar desde el checkout incluso después de la desinstalación normal. Conserva dependencias compartidas, registros del sistema, copias externas y el checkout del usuario. El bloqueo de mantenimiento en `/run/lock` es temporal del sistema. No elimina software o recursos ajenos.

## Uso

- **Red:** cada red registrada se ve como una cuadrícula.
  - **＋ Red** añade otra red y sugiere las del servidor. Con **⋯** se renombra o se quita.
  - Al hacer clic en una IP, el panel lateral permite reclamarla (queda reservada), asignarla a un equipo (si el nombre no existe, se crea), cambiar o quitar el equipo, escribir una nota (se guarda sola) o liberarla.
  - Shift+clic o arrastrar selecciona varias.
  - **Necesito una IP** propone tu primera reservada o, si no hay, la primera libre que no ha respondido en 7 días.
- **Otras:** IPs tuyas fuera de cualquier red registrada, por ejemplo tras quitar una red.
- **Equipos:** las VMs y contenedores aparecen debajo de su máquina física; los que no tienen máquina se agrupan por plataforma. Crear y editar abren el panel lateral sin mover la lista.
  - **Sistema operativo:** se elige de la biblioteca de iconos y se escribe solo la versión (en «Otro Linux» y «Otro sistema», también el nombre).
  - **Máquina física y plataforma:** una VM puede indicar en qué máquina física corre y en qué plataforma de virtualización. Si la máquina tiene plataforma, la VM la hereda.
  - **IP dinámica (DHCP):** el equipo no tiene IPs asignadas; sus VMs sí pueden tenerlas.
  - En el formulario se quitan IPs (vuelven a reservadas), se añaden reservadas o se escribe una IP nueva, que se reclama al guardar. Eliminar un equipo deja sus IPs reservadas.
  - **Etiquetas:** plataformas y sistemas operativos con cuántos equipos los usan; se renombran en todos a la vez y se quitan los que nadie usa.
- **Idioma:** selector ES/EN en la barra superior. Se recuerda en el navegador.
- **Teclado:** `/` busca y `Esc` limpia la selección y cierra formularios. Las flechas recorren la cuadrícula.

Solo hay un espacio de direcciones: la misma IP no puede registrarse en dos redes aisladas.

## Ping automático

El servidor hace ping a todas las direcciones vigiladas al arrancar y después cada `LANCLAIM_SCAN_INTERVAL` segundos. Lanza 32 pings simultáneos con 1 s de espera. Al añadir una red, esa red se escanea enseguida.

El ping solo informa: nunca reclama, libera ni reasigna. Un firewall puede bloquear ICMP, así que una IP que no responde no tiene por qué estar libre. Por eso el mapa marca con un anillo ámbar las libres que respondieron en los últimos 7 días.

El escaneo usa el `ping` del sistema. `install.sh` y `update.sh` preparan `iputils-ping` (Debian/Ubuntu) o `iputils`. Windows usa su ping integrado.

El servicio recibe únicamente `CAP_NET_RAW` mediante `AmbientCapabilities` y `CapabilityBoundingSet`, con `User=lanclaim` y `NoNewPrivileges=true`. No se cambian permisos globales de ping, parámetros del kernel ni reglas de firewall. Una instalación anterior sin estos permisos se repara con `sudo ./update.sh`.

Si ping falla (permisos, falta de ruta, binario ausente), la interfaz muestra un aviso con la causa y el inventario sigue funcionando. Los detalles quedan en `sudo journalctl -u lanclaim -n 100 --no-pager`.

Las comprobaciones salen del servidor, no del navegador. En VM o WSL2 la red virtual puede ser distinta de la LAN física: registra una red alcanzable desde ese servidor.
