# Operación de LanClaim 0.1.0

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

Reinicia WSL desde Windows cuando no haya trabajo en curso y comprueba `systemctl`. Las IP internas de WSL pueden cambiar; acceso local desde Windows y acceso desde la LAN son rutas diferentes. La página Mi red ofrece las subredes del servidor, que pueden diferir de la LAN que quieres administrar; introduce esa subred manualmente cuando corresponda.

## Configuración

Archivo `/etc/lanclaim/lanclaim.env`, legible por root y cargado por systemd:

```ini
LANCLAIM_HOST=0.0.0.0
LANCLAIM_PORT=8080
LANCLAIM_DATA_DIR=/var/lib/lanclaim
LANCLAIM_ALLOWED_HOSTS=
```

Se admiten `localhost`, los nombres locales del servidor y direcciones IP literales. Para un nombre propio añade, por ejemplo, `LANCLAIM_ALLOWED_HOSTS=lanclaim.interna.example` sin esquema, ruta ni puerto. Un proxy debe conservar Host y el origen del navegador. Tras editar, ejecuta `sudo systemctl restart lanclaim`.

Mantén `LANCLAIM_DATA_DIR=/var/lib/lanclaim` en la instalación gestionada: actualización, respaldo, recuperación y permisos del servicio usan esa ruta. Para pruebas manuales fuera del servicio puedes usar `python3 -m lanclaim.server --data-dir /ruta/propia --port 8090`.

## Actualizar

En el checkout del código:

```bash
git pull --ff-only
sudo ./update.sh
```

El script prepara una versión en `/opt/lanclaim/releases`, detiene el servicio, crea una copia SQLite consistente en `/var/lib/lanclaim/backups`, cambia el enlace `current`, inicia y comprueba el servicio. Si falla, restaura el código, la unidad y la base de datos anterior y comprueba la recuperación. Las versiones previas y copias se conservan. El script no realiza `git pull` por su cuenta ni decide la rama a desplegar.

Si el servidor arranca pero una operación falla, consulta `sudo journalctl -u lanclaim -n 100`. No borres la base ni reinstales con purga para solucionar un error de arranque.

## Copias y recuperación manual

Para crear una copia coherente mientras la aplicación está en uso:

```bash
cd /opt/lanclaim/current
sudo /usr/bin/python3 -m lanclaim.server --data-dir /var/lib/lanclaim --backup /ruta/segura/lanclaim.sqlite3
```

El directorio de destino debe existir. Restringe el acceso a esa copia; contiene inventario e historial. No copies solamente el archivo SQLite en caliente con `cp`, porque puede haber cambios en el WAL.

Si la recuperación automática no logra arrancar el servicio:

1. Detén `lanclaim` y conserva una copia del estado fallido para diagnóstico.
2. Identifica el respaldo `before-…sqlite3`, la unidad `unit-…service` y la versión anterior en `/opt/lanclaim/releases` de la misma actualización.
3. Con el servicio detenido, restaura esa base en `/var/lib/lanclaim/lanclaim.sqlite3` y elimina únicamente sus archivos auxiliares `lanclaim.sqlite3-wal` y `lanclaim.sqlite3-shm` antes de abrirla.
4. Restaura el enlace `current` a la versión compatible y la unidad respaldada; ajusta propietario de la base a `lanclaim:lanclaim` y permisos a `0600`.
5. Ejecuta `systemctl daemon-reload`, inicia el servicio y verifica `/api/health` y el inventario. No mezcles un respaldo nuevo con código incompatible.

## Desinstalar y purgar

`sudo ./uninstall.sh` detiene y elimina el servicio y el código. Conserva base, copias, configuración y cuenta del servicio para poder reinstalar y recuperar el inventario.

`sudo ./uninstall.sh --purge` requiere escribir `PURGAR`; elimina código, servicio, datos, copias internas, configuración y la cuenta propia. Se puede ejecutar desde el checkout incluso después de la desinstalación normal. Conserva dependencias compartidas, registros del sistema, copias externas y el checkout del usuario. El bloqueo de mantenimiento en `/run/lock` es temporal del sistema. No elimina software o recursos ajenos.

## Uso administrativo

- **Mi red:** enumera direcciones de un CIDR o rango, pagina de 64 en 64 y permite reclamar una selección. Hasta 4096 por operación. No determina si los equipos están encendidos.
- **Mi espacio de IPs:** gestiona reclamaciones persistentes y disponibilidad administrativa. CIDR incluye extremos; no asignes direcciones de red/broadcast donde tu red no lo permita.
- **Reinstalar / formatear:** conserva máquina e IPs. Al finalizar, edita la ficha y marca la reinstalación como terminada.
- **Retirar:** cierra asignaciones conservando historial; las IPs vuelven a disponibles salvo revisiones abiertas.
- **Idioma:** selector Español/English en la barra superior. Se recuerda en el navegador; el inventario permanece en el servidor. Cambiar de idioma recarga la vista.

Solo hay un espacio administrativo en esta versión: no permite registrar la misma dirección en redes aisladas distintas. No hay descubrimiento activo, autenticación multiusuario ni importación de inventarios externos.


## Escaneo manual de red

En **Red**, selecciona una interfaz del servidor o introduce una IPv4, un rango o un CIDR y pulsa **Escanear red**. El límite es 1024 direcciones con 16 comprobaciones simultáneas y un solo trabajo activo. **Detener** impide iniciar nuevas comprobaciones; las que ya están en curso pueden terminar. **Ver rango** solo enumera (hasta 4096 direcciones).

El escaneo usa `ping` del sistema. `install.sh` y `update.sh` preparan `iputils-ping` en Debian/Ubuntu o `iputils` en los demás gestores soportados. En una ejecución manual de Linux hay que instalar esa dependencia por separado. Windows usa su ping integrado. Consulta las opciones en la documentación de [Microsoft](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ping) y [iputils](https://github.com/iputils/iputils/blob/master/doc/ping.xml).

El servicio recibe únicamente `CAP_NET_RAW` mediante `AmbientCapabilities` y `CapabilityBoundingSet`. Esto permite ejecutar ping cuando el grupo de LanClaim no está autorizado en `net.ipv4.ping_group_range`. Conserva `User=lanclaim` y `NoNewPrivileges=true`; no se cambian permisos globales de ping ni parámetros del kernel. Consulta la documentación de [systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#AmbientCapabilities=) y los [permisos de ping](https://man7.org/linux/man-pages/man8/ping.8.html). Una instalación anterior se repara descargando el código actual y ejecutando `sudo ./update.sh`, que regenera la unidad y reinicia el servicio con copia de seguridad previa.

Las comprobaciones salen del servidor, no del navegador. En VM/WSL2 la red virtual detectada puede ser diferente de la LAN física: elige un rango alcanzable por ese servidor. Un firewall puede bloquear ICMP. **Sin respuesta** nunca significa disponible ni libera asignaciones. La columna muestra la fecha del último resultado; no promete estado en tiempo real.

Si ping no existe o no puede ejecutarse, el escaneo muestra un error y conserva la observación anterior. Los errores distinguen permisos, falta de ruta y agotamiento del tiempo del proceso; los fallos de ping registran su diagnóstico en `sudo journalctl -u lanclaim -n 100 --no-pager`. Comprueba `systemctl show lanclaim -p User -p NoNewPrivileges -p AmbientCapabilities -p CapabilityBoundingSet` y prueba el escaneo de `127.0.0.1` desde Red. Ejecutar `sudo -u lanclaim ping` fuera del servicio no reproduce sus capacidades y puede dar un resultado distinto. No se cambian reglas del firewall ni parámetros globales de red. Las observaciones se guardan en SQLite; el progreso del trabajo está en memoria y un reinicio no reanuda el escaneo.
