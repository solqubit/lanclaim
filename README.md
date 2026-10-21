# LanClaim

**Mi espacio de IPs:** gestión personal de direcciones IP (IPAM) e inventario de máquinas mediante una aplicación web autoalojada en Linux.

LanClaim permitirá reclamar direcciones individuales y rangos completos para administrarlos de forma persistente. Reclamar una IP significa incorporarla al inventario personal; no significa ocuparla ni reservarla en la red, en DHCP o en un router.

La pregunta principal es: **¿qué direcciones administro, cuáles puedo asignar y a qué máquinas pertenecen?**

## Estado del proyecto

Definición funcional inicial. Este repositorio todavía no contiene una aplicación ejecutable, instaladores ni verificaciones de red. Los documentos siguientes establecen el alcance y los criterios para implementarlos:

- [Requisitos funcionales y experiencia principal](docs/REQUISITOS.md).
- [Modelo de dominio y reglas de integridad](docs/MODELO.md).
- [Prioridades y criterios de aceptación](docs/PLAN.md).

## Principios

- Las IP reclamadas permanecen en el espacio personal aunque se liberen sus asignaciones.
- Una IP puede estar disponible, planificada, asignada o pendiente de revisión.
- Una máquina apagada o no detectada conserva sus IP asignadas.
- Retirar una máquina y liberar sus IP son operaciones administrativas explícitas, con historial.
- El descubrimiento sirve para verificar el inventario administrado y detectar discrepancias; es una función secundaria.
- Ningún resultado de conectividad libera una dirección automáticamente.

## Plataforma prevista

Aplicación web autoalojada en Linux, accesible mediante URL, compatible con servidores, máquinas virtuales y WSL2. La entrega incluirá `install.sh`, `update.sh` y `uninstall.sh`, con persistencia de datos y una modalidad explícita de purga. Estos scripts están pendientes de implementación.
