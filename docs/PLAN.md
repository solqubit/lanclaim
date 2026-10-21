# Orden de implementación y aceptación

Estado de la versión 0.1.0: implementados el núcleo persistente y la interfaz de las fases 1 y 2, además de Mi red, reinstalación conservando IPs e interfaz ES/EN. Los scripts de la fase 3 están implementados y probados en un contenedor aislado con adaptador de servicio; falta certificar el despliegue con systemd real y la matriz de distribuciones. Las fases 4 y 5 siguen pendientes. Consulta VERIFICACION.md para el alcance exacto de las pruebas.

## Fase 1. Núcleo IPAM persistente

Implementar el almacenamiento, sus migraciones y las operaciones de reclamación, máquinas, planes, asignaciones, liberación, retirada e historial. Incluir revisiones manuales desde esta fase; su detección automática llegará después.

Condiciones de aceptación:

- Reclamar una dirección, un conjunto y un rango produce registros persistentes sin duplicados.
- Una reclamación solapada conserva las asignaciones, planes y notas ya existentes.
- Entradas inválidas no generan reclamaciones parciales silenciosas; los límites de tamaño de los lotes se validan antes de guardar.
- Se puede registrar y editar cada campo solicitado de una máquina sin hacer descubrimiento.
- Se puede registrar una máquina sin IP y asignarle después una o varias.
- Planificar no crea una asignación; ejecutar o cancelar el plan conserva su historial.
- Dos solicitudes concurrentes sobre una IP disponible producen como máximo una asignación activa.
- Liberar una IP cierra el vínculo y conserva la reclamación y el historial.
- Retirar una máquina libera todas sus asignaciones en una transacción; un fallo intermedio no deja una retirada parcial.
- Se puede consultar la misma IP a través de varias máquinas sucesivas sin perder relaciones anteriores.
- Una revisión conserva la asignación existente y excluye la IP del conjunto asignable hasta resolverla.
- Reiniciar el servicio no modifica estados ni pierde datos.

## Fase 2. Mi espacio de IPs e inventario web

Implementar el dashboard principal, las listas filtrables, formularios de reclamación y máquinas, planificación, asignación y liberación, retirada y consultas de historial.

Condiciones de aceptación:

- Las siete preguntas del dashboard definidas en REQUISITOS.md tienen respuesta directa mediante un indicador o una lista accesible.
- Se distingue claramente disponibilidad administrativa de conectividad.
- Las máquinas retiradas continúan visibles en su filtro y en el historial de las IP.
- La retirada presenta las IP afectadas antes de ejecutarse.
- El estado vacío permite comenzar por reclamar IPs o registrar máquinas sin escanear la red.
- Un inventario manual es plenamente utilizable con todas las verificaciones automáticas deshabilitadas.
- Una asignación con revisión aparece tanto en la consulta de asignaciones como en la de revisiones, sin inflar el total de direcciones reclamadas.

## Fase 3. Entrega Linux del administrador

Implementar `install.sh`, `update.sh` y `uninstall.sh`, configuración del servicio, almacenamiento persistente, copias y recuperación. Diseñar la separación entre código y datos desde la fase 1.

Condiciones de aceptación:

- Una instalación limpia en cada entorno declarado compatible arranca la aplicación y muestra dirección y puerto de acceso.
- Ejecutar de nuevo la instalación no sobrescribe el inventario existente.
- La matriz de pruebas incluye Linux en VM y WSL2 y documenta sus requisitos y límites de acceso por red.
- Actualizar después de `git pull` conserva máquinas, reclamaciones, asignaciones, planes e historial.
- Un fallo de migración o arranque permite recuperar una versión y base de datos compatibles mediante el procedimiento documentado.
- Desinstalar sin purgar conserva los datos; reinstalar puede recuperarlos.
- Purgar elimina los recursos propios declarados de LanClaim sin afectar archivos o servicios ajenos.
- No se declara una distribución compatible hasta verificar en ella el flujo de instalación, actualización y retirada.

El administrador autoalojado debe ser entregable y útil al terminar esta fase, sin depender del descubrimiento.

## Fase 4. Verificación del inventario administrado

Añadir comprobaciones manuales y después automáticas de las IP reclamadas, con observaciones fechadas y apertura de posibles discrepancias.

Condiciones de aceptación:

- Apagar una máquina o dejar de obtener respuestas no libera su IP, cancela planes ni retira la máquina.
- Un resultado discrepante crea una revisión con evidencia y preserva la asignación activa.
- Resolver la revisión documenta la decisión y no pierde el historial.
- Las comprobaciones se pueden deshabilitar manteniendo todas las funciones administrativas.

## Fase 5. Descubrimiento externo opcional

Añadir exploración explícita de direcciones ajenas al inventario y su incorporación voluntaria.

Condiciones de aceptación:

- Una IP externa descubierta no aumenta el total reclamado hasta que el usuario la incorpore.
- Reclamar un resultado ya administrado no duplica registros ni modifica sus vínculos existentes.
- El descubrimiento no desplaza Mi espacio de IPs como pantalla principal.

## Escenarios de referencia para pruebas de dominio

| Escenario | Resultado esperado |
| --- | --- |
| Reclamar cinco direcciones sin máquinas. | Cinco reclamadas, cinco disponibles, cero asignaciones. |
| Planificar una y asignar otra a VM-A. | Cinco reclamadas, tres disponibles, una planificada y una con asignación activa. |
| VM-A deja de responder. | Mismos recuentos y mismo vínculo con VM-A. |
| Retirar VM-A sin revisiones abiertas. | Cinco reclamadas, cuatro disponibles, una planificada y una máquina retirada; IP de VM-A reutilizable. |
| Asignar esa IP a VM-B. | Nuevo vínculo activo con VM-B y vínculo cerrado con VM-A consultable. |
| Abrir una revisión sobre esa IP. | Sigue asignada a VM-B, aparece pendiente de revisión y no se ofrece como disponible. |
| Liberarla manteniendo la revisión abierta. | Sin vínculo activo; sigue reclamada y pendiente de revisión. |
| Resolver la última revisión sin nueva asignación. | Disponible y reutilizable; historial de VM-A y VM-B intacto. |
| Reiniciar y actualizar con datos del escenario anterior. | Mismo inventario, estados e historial después de ambas operaciones. |
