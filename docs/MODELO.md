# Modelo de dominio propuesto

Modelo lógico independiente del lenguaje, framework y motor de base de datos. Las tablas siguientes describen entidades y reglas; todavía no son un esquema implementado.

## Separar pertenencia, asignación y observación

1. **Reclamación:** la dirección pertenece al espacio personal administrado.
2. **Uso administrativo:** está disponible, planificada o asignada.
3. **Revisión:** existe una discrepancia abierta que requiere una decisión.
4. **Observación de red:** qué se observó, cuándo y por qué método.

Una revisión puede coexistir con una asignación activa. En ese caso la interfaz mostrará «Pendiente de revisión · Asignada a máquina X». No debe perderse la asignación al cambiar la presentación del estado.

## Entidades

| Entidad | Datos principales y relaciones |
| --- | --- |
| IP reclamada | ID estable, dirección normalizada, familia IP, fecha de reclamación y notas. |
| Máquina | ID estable, nombre, descripción, SO, hostname, MAC, plataforma, ID de VM, etiquetas, notas, ciclo de vida y fecha de retirada. |
| Asignación | ID, IP, máquina, inicio, fin opcional, motivo de asignación y motivo de liberación. Fin ausente significa asignación activa. |
| Planificación | ID, IP, destino previsto, notas, fecha de creación, estado abierto/ejecutado/cancelado y fecha de cierre. |
| Revisión | ID, IP, motivo, evidencia, fecha de apertura, fecha de resolución y decisión tomada. Puede referenciar la asignación afectada. |
| Evento de historial | ID, tipo de operación, fecha, referencias estables a IP/máquina/asignación/plan/revisión y cambios relevantes. |
| Observación de red (posterior) | IP observada, IP reclamada relacionada si existe, fecha, método, resultado de conectividad y atributos detectados. |

El alcance inicial es un espacio personal. Si se incorporan redes aisladas con direcciones repetidas, se añadirá un ámbito explícito de red a la identidad y a las restricciones de unicidad antes de permitir esos duplicados.

## Integridad y persistencia

- Dirección normalizada única dentro del espacio personal; distintas representaciones de una misma dirección no crearán registros distintos.
- Máximo una asignación activa por IP, garantizado en persistencia y no solo en la interfaz.
- Máximo un plan abierto por IP; un plan abierto y una asignación activa no pueden coexistir.
- Una máquina puede tener cero, una o varias asignaciones activas a IP diferentes.
- Solo las máquinas activas pueden recibir asignaciones.
- Asignación, planificación, revisión e historial conservan referencias a la misma IP reclamada durante todo su ciclo de vida.
- Liberar cierra una asignación; no borra la IP, la máquina ni la relación histórica.
- Retirar una máquina y cerrar sus asignaciones es una transacción indivisible. Si falla un paso, se conserva el estado previo completo.
- Las operaciones y sus eventos de historial se guardan en la misma transacción.
- La validación de disponibilidad se repite en el momento de guardar para evitar dobles asignaciones desde dos pestañas o peticiones simultáneas.
- El historial conserva fechas y datos necesarios para interpretar cambios de nombre e identidad posteriores.
- El módulo de observación no puede cerrar asignaciones, cancelar planes ni retirar máquinas.

## Estado visible y disponibilidad

El estado visible se deriva en este orden:

1. Si existe una revisión abierta: **Pendiente de revisión**, mostrando también la asignación o planificación subyacente.
2. Si existe una asignación activa: **Asignada**.
3. Si existe un plan abierto: **Planificada**.
4. En otro caso: **Disponible**.

Una IP es asignable cuando está reclamada y no tiene asignación activa, plan abierto ni revisión abierta. Su conectividad no participa en este cálculo.

Una IP es reutilizable cuando es asignable y tiene al menos una asignación histórica cerrada. Es un subconjunto de las disponibles, no un quinto estado.

## Transiciones administrativas

| Operación | Precondición | Resultado |
| --- | --- | --- |
| Reclamar | Dirección válida; si ya existe, conservar registro. | Nueva IP disponible, sin asignación. |
| Planificar | IP disponible. | Plan abierto; IP planificada. |
| Cancelar plan | Plan abierto. | Plan cerrado; disponible salvo revisión abierta. |
| Ejecutar plan | Plan abierto, máquina activa, sin revisión abierta. | Plan cerrado y asignación abierta en la misma transacción. |
| Asignar | IP disponible y máquina activa. | Asignación abierta. |
| Liberar | Asignación activa. | Asignación cerrada; disponible salvo revisión abierta. |
| Retirar máquina | Máquina activa. | Máquina retirada; todas sus asignaciones cerradas, sin borrar revisiones. |
| Abrir revisión | IP reclamada. | Revisión abierta; vínculo o plan existente conservado. |
| Resolver revisión | Evidencia y decisión registradas. | Revisión cerrada; se recalcula el estado a partir de los vínculos restantes. |
| Registrar conectividad | Comprobación efectuada. | Nueva observación; ningún cambio de asignación. |

Corregir una asignación durante una revisión requiere una acción administrativa explícita que cierre el vínculo anterior y registre el nuevo, conservando ambos en el historial. Cerrar una revisión sin cambiar el vínculo conserva la máquina asignada.

## Recuentos del dashboard

Los cuatro estados visibles forman una partición: disponibles + planificadas + asignadas sin revisión + pendientes de revisión = total de IP reclamadas.

La métrica **Con asignación activa** incluirá también las asignadas que estén pendientes de revisión, porque siguen vinculadas a una máquina. Se indicará cuántas de ellas requieren revisión. Del mismo modo, la consulta de planes incluirá los planes abiertos con revisión.

La interfaz no presentará estos totales solapados como categorías sumables. Las consultas de disponibilidad usarán exclusivamente la regla de asignable, y las de reutilización su subconjunto histórico.
