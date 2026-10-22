# Modelo de datos (versión 2)

SQLite, esquema `user_version = 9`, en `lanclaim/db.py`. Al arrancar con una base de la 0.x (esquemas 1 a 4) se descartan todas sus tablas y se crea el esquema vacío: la versión 2 no conserva datos de la 0.x. Desde la v5 los datos se conservan: las migraciones se aplican en orden (v6 añade `os_choices`; v7, anfitrión y plataforma; v8 separa el anfitrión en plataforma de cada VM y máquina física, y elimina como máquinas los anfitriones que solo eran etiquetas; v9 añade la IP dinámica y hace que las VMs hereden la plataforma de su máquina).

## Tablas

| Tabla | Campos | Notas |
| --- | --- | --- |
| `networks` | `id`, `cidr`, `name`, `created_at` | IPv4 de /22 a /30. No pueden solaparse. Entre todas, como máximo 4096 direcciones. |
| `devices` | `id`, `name`, `type`, `os`, `note`, `platform`, `host_id`, `dhcp`, `created_at` | `name` es obligatorio y único sin distinguir mayúsculas. `type` puede ser `vm`, `fisica`, `contenedor` u `otro`. `platform`: en una máquina física, la plataforma que ejecuta; en una VM, la suya solo si no corre en una máquina con plataforma (si la tiene, la hereda y aquí queda vacío). `host_id` es la máquina física (solo `fisica`) donde corre; al borrarla pasa a nulo. `dhcp`: el equipo usa IP dinámica y no tiene IPs asignadas. |
| `ips` | `id`, `address`, `device_id`, `note`, `claimed_at` | Una fila por IP reclamada. Si `device_id` es nulo, la IP está reservada. Al borrar el equipo, `device_id` pasa a nulo. |
| `os_choices` | `name`, `name_key`, `used_at` | SO ya usados (texto completo, p. ej. «Ubuntu 24.04»), sin repetir mayúsculas/minúsculas. Se añaden al guardar un equipo y sobreviven aunque se borre. Se gestionan en Etiquetas (renombrar en todos los equipos, quitar los que nadie usa). En el formulario, el SO se elige de una biblioteca fija y se escribe la versión. |
| `platform_choices` | `name`, `name_key`, `used_at` | Plataformas guardadas (de serie: Proxmox VE, VMware ESXi, Vates XCP-ng, Nutanix AHV, Hyper-V, KVM, Local host). En el formulario, × quita una de la lista solo si ningún equipo la usa. |
| `observations` | `address`, `up`, `checked_at`, `last_up_at` | Último ping de cada dirección vigilada. `last_up_at` guarda la última vez que respondió. |

## Estados de una dirección (derivados)

| Estado | Condición |
| --- | --- |
| Asignada | Reclamada y con equipo. |
| Reservada | Reclamada y sin equipo. |
| Ocupada por otro | No reclamada y respondió en el último ping. |
| Libre | No reclamada y no responde, o sin datos. |

El estado "respondió hace poco" significa que `last_up_at` es de los últimos 7 días. Avisa de que una IP libre puede ser un equipo apagado.

## Operaciones

Todas validan los datos y se aplican en una única transacción. Si algo falla, no queda ningún cambio a medias.

| Operación | Efecto |
| --- | --- |
| Reclamar (con o sin equipo) | Inserta las IPs que faltan. Si se indica equipo, asigna o reasigna todas las seleccionadas. Un nombre nuevo crea el equipo. |
| Quitar equipo | La IP vuelve a reservada. |
| Liberar | Borra la IP del inventario. El equipo no cambia. |
| Crear o editar equipo | La lista de IPs que se envía es la definitiva: las que salen quedan reservadas y las que entran se reclaman o reasignan. |
| Eliminar equipo | Sus IPs quedan reservadas. |
| Quitar red | Sus IPs reclamadas siguen siendo tuyas y aparecen en «Otras». |
| Registrar ping | Solo escribe en `observations`. Nunca toca `ips` ni `devices`. |

No hay historial: lo que se borra, se borra.

## Direcciones vigiladas

El ping automático recorre los hosts de todas las redes registradas (sin las direcciones de red ni de broadcast) y las IPs reclamadas fuera de ellas.
