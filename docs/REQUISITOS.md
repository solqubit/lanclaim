# Requisitos de producto

Esta definición establece la prioridad funcional de LanClaim. Cualquier enfoque anterior que sitúe el escaneo masivo como función central queda sustituido por la administración del espacio personal de IPs.

## 1. Mi espacio de IPs

El usuario podrá reclamar una IP, varias direcciones o un rango completo. La reclamación será persistente e independiente de que exista una máquina asociada o una respuesta de red.

El formulario de reclamación deberá mostrar las direcciones que se incorporarán y detectar entradas inválidas, duplicados y solapamientos antes de guardar. Repetir una reclamación no duplicará direcciones ni alterará sus asignaciones, planes o historial.

Las direcciones tendrán estos estados visibles:

| Estado | Significado | ¿Puede asignarse directamente? |
| --- | --- | --- |
| Disponible | No tiene asignación activa ni planificación ni revisión abierta. | Sí, administrativamente. |
| Planificada | Está destinada a una máquina futura y aún no tiene asignación activa. | Requiere ejecutar o cancelar el plan. |
| Asignada | Tiene un vínculo activo con una máquina existente, encendida o apagada. | No; primero debe liberarse su asignación. |
| Pendiente de revisión | Tiene una discrepancia, posible conflicto o asignación por verificar. | Requiere revisar y resolver la discrepancia. |

La disponibilidad administrativa no garantiza que la dirección esté libre en la red. Una observación de red tampoco establece por sí sola la propiedad de una IP.

Cada dirección mostrará su máquina actual, su planificación si corresponde, sus alertas y su historial. Los filtros permitirán encontrar rápidamente las disponibles, planificadas, asignadas y pendientes de revisión.

## 2. Inventario de máquinas

Cada máquina tendrá un identificador estable y estos campos:

- Nombre.
- Descripción.
- Sistema operativo.
- Hostname.
- Dirección MAC.
- Plataforma de virtualización.
- Identificador de VM.
- Etiquetas.
- Notas.

El nombre será obligatorio. Los demás datos podrán completarse progresivamente; registrar una máquina no dependerá de descubrirla en la red.

Una máquina podrá tener varias direcciones IP y existir temporalmente sin ninguna. Su ficha mostrará asignaciones actuales, asignaciones anteriores y estado de ciclo de vida: activa, en reinstalación o retirada. Activa significa que pertenece a la infraestructura vigente, no que esté encendida.

La MAC y el hostname son atributos editables, no identificadores internos permanentes. No se supondrá que una máquina con varias interfaces utiliza la misma MAC para todas sus IP.

## 3. Asignación, planificación y liberación

### Asignar

El usuario seleccionará una IP reclamada disponible y una máquina activa. El sistema registrará el vínculo y su fecha de inicio. Una dirección no podrá tener dos asignaciones activas dentro del mismo espacio administrativo.

### Planificar

El usuario podrá destinar una IP a una máquina futura, indicando un nombre o propósito y notas sin necesitar una máquina existente. La planificación no será una asignación activa y no contará como disponibilidad inmediata.

Ejecutar el plan vinculará la IP a una máquina activa y conservará el plan en el historial. Cancelarlo será una acción explícita que devolverá la dirección a disponible si no tiene revisiones abiertas.

### Liberar

Al liberar una IP se cerrará su asignación activa con fecha y motivo. La dirección permanecerá reclamada, conservará todas sus asignaciones anteriores y podrá asignarse nuevamente.

Una revisión abierta no desaparecerá por liberar la asignación: la dirección quedará pendiente de revisión hasta resolverla y entonces podrá volver a disponible. Esto evita presentar una dirección con un conflicto conocido como lista para reutilizar.

### Retirar una máquina

La acción de retirada mostrará las IP que se liberarán y permitirá registrar el motivo. Al completarla, la máquina pasará a retirada y sus asignaciones activas quedarán cerradas en una misma operación. El registro de la máquina y su historial permanecerán consultables.

Retirar en LanClaim documenta una retirada de infraestructura; no elimina ni apaga la VM o el equipo real. Las máquinas retiradas no admitirán nuevas asignaciones mientras permanezcan en ese estado.

### Reinstalar o formatear

La acción «Reinstalar / formatear» conservará la ficha, el identificador interno y todas las IP asignadas. Registrará motivo y fecha, y mostrará el estado «En reinstalación». Al finalizar, el usuario podrá devolverla a activa y actualizar SO, hostname, MAC y demás datos desde la misma ficha. No se ejecutarán operaciones de formateo reales sobre el equipo.

Una IP que solo se reclama y todavía no se utiliza permanecerá disponible. No es necesario crear una máquina para conservarla.

### Conectividad

Una máquina apagada, sin respuesta o no detectada conservará sus asignaciones. No habrá temporizadores de caducidad ni liberaciones automáticas basadas en ping, último avistamiento, reinicio o ausencia de resultados.

## 4. Dashboard y navegación

La interfaz será minimalista: navegación superior con **Red**, **Mis IPs**, **Máquinas** e **Historial**, tablas compactas y detalles bajo demanda. La vista inicial **Red** permite elegir un rango, escanearlo explícitamente y reclamar direcciones. **Mis IPs** conserva el papel de administrador personal y funciona sin escaneos previos, con acceso a reclamar, planificar y asignar. Registrar máquinas está disponible en su pestaña.

| Pregunta | Respuesta en la interfaz |
| --- | --- |
| ¿Cuántas IP tengo reclamadas? | Total persistente de direcciones del espacio personal. |
| ¿Cuántas están disponibles? | Recuento y lista filtrada de direcciones administrativamente asignables. |
| ¿Cuántas están asignadas y a qué máquinas? | Recuento de vínculos activos y lista con enlaces a las máquinas. |
| ¿Cuáles tengo planificadas? | Lista con destino previsto y notas del plan. |
| ¿Qué máquinas he retirado? | Inventario filtrable por retirada, con fecha e historial. |
| ¿Qué direcciones puedo reutilizar? | Direcciones disponibles que tengan alguna asignación histórica cerrada. |
| ¿Hay posibles conflictos o asignaciones dudosas? | Revisiones abiertas con causa, evidencia disponible y máquina vinculada. |

La lista de IPs mostrará dirección, estado administrativo, máquina o destino planificado y señal de revisión. La conectividad será un dato complementario con fecha de comprobación; nunca sustituirá el estado administrativo.

La navegación priorizará Mi espacio de IPs, Mi red, Máquinas e Historial. Mi red listará las direcciones de una subred o rango y permitirá seleccionarlas para reclamar; mostrará cuáles ya están administradas y sus estados. Esta enumeración no implica detectar equipos activos. Verificaciones y descubrimiento aparecerán como funciones secundarias cuando se implementen.

La interfaz ofrecerá Español e English, manteniendo sin traducir el contenido introducido por el usuario. El diseño será oscuro con inspiración de terminal, texto de alto contraste y colores diferenciados por estado; no dependerá únicamente del color para comunicar estados.

## 5. Historial

Se conservarán reclamaciones, planes, asignaciones, liberaciones, retiradas y apertura/resolución de revisiones, con sus fechas y motivos cuando correspondan. La consulta será posible desde una IP y desde una máquina.

Reasignar una dirección no sobrescribirá su relación anterior. Renombrar o retirar una máquina no romperá los enlaces históricos. Una retirada administrativa no equivaldrá al borrado físico del registro.

## 6. Descubrimiento y verificaciones: fase posterior

La verificación tendrá como ámbito inicial las IP reclamadas. Permitirá comprobar conectividad, obtener indicios de identidad y detectar posibles conflictos con el inventario.

Las observaciones tendrán fecha, origen y evidencia. Un dato detectado discrepante abrirá una revisión; no reemplazará automáticamente la identidad o asignación registrada. La falta de respuesta por sí sola no será evidencia de una IP disponible ni de un conflicto de asignación.

El descubrimiento fuera del inventario será una acción secundaria y explícita. Sus resultados se mantendrán separados hasta que el usuario decida reclamarlos. No se incorporarán automáticamente ni modificarán los totales de Mi espacio de IPs.

## 7. Linux y operación autoalojada

- Acceso desde navegador mediante URL y persistencia en el servidor Linux.
- Instalación en equipos Linux, VM y WSL2; detección del entorno y de los requisitos necesarios.
- `install.sh`: preparar dependencias compatibles, configurar la aplicación y su servicio, crear el almacenamiento persistente y mostrar las URL candidatas de acceso y el puerto configurado.
- Documentar las distribuciones y versiones realmente verificadas. Detectar un entorno no equivale a certificar su compatibilidad; los entornos no soportados recibirán un diagnóstico claro.
- Las URL presentadas distinguirán acceso local y acceso desde otros equipos. En VM y WSL2 se explicarán las condiciones de red del entorno sin afirmar que una IP detectada es accesible desde cualquier equipo.
- `update.sh`: permitir actualizar después de un `git pull`, comprobar la versión y requisitos, respaldar datos, aplicar migraciones y comprobar el servicio. Una actualización fallida deberá disponer de un procedimiento de recuperación con datos compatibles con la versión restaurada.
- La actualización desde el propio servidor podrá incorporarse como comodidad adicional. No debe anteponerse al flujo fiable con `update.sh`.
- `uninstall.sh`: retirar aplicación y servicio conservando los datos por defecto y explicando dónde permanecen.
- `uninstall.sh --purge`: eliminar explícitamente los datos y recursos propios de LanClaim, con confirmación del alcance. La purga no eliminará dependencias compartidas ni recursos ajenos.
- Código, configuración, base de datos y copias tendrán ubicaciones definidas. Reiniciar, actualizar o reinstalar conservando datos no perderá inventario ni historial.

La matriz de distribuciones, el mecanismo de servicio y los detalles de despliegue se fijarán y comprobarán durante la implementación. No se declara soporte probado en esta fase documental.


## Interacción centrada en la IP

La IP es el punto de entrada para registrar su equipo, editarlo, cambiarlo, guardar la dirección para después, marcar reinstalación y liberar su asignación. No se requiere crear una máquina en otra pantalla. La pestaña Máquinas es un resumen complementario. Cada acción explica sus consecuencias; historial, notas y opciones menos frecuentes se pliegan. Se mantiene la distribución con navegación superior y tablas, con un acabado oscuro neutro y acentos discretos.
