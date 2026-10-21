# Verificación de la implementación inicial

## Pruebas ejecutadas

- 29 pruebas Python de dominio, persistencia, concurrencia, recuperación transaccional, API HTTP y detección de interfaces locales: aprobadas en Windows con Python 3.14 y Ubuntu 26.04 sobre WSL2 con Python 3.14.
- Pruebas de traducción ES/EN con Node: etiquetas, errores, texto con saltos de línea, plantillas y conservación literal del contenido del usuario.
- Sintaxis JavaScript y Bash; ShellCheck para los scripts de instalación, actualización, desinstalación y prueba de ciclo de vida.
- Integración en contenedor Ubuntu 24.04: instalación, repetición sin pérdida de datos, actualización, fallo simulado de migración que modifica la base, recuperación de código y datos, desinstalación conservando datos, reinstalación y cancelación/confirmación de purga. Se ejecuta el servidor real con el UID del servicio mediante un adaptador de `systemctl` exclusivo de pruebas.
- Navegador: reclamación con previsualización, creación de máquina, asignación, inicio de reinstalación conservando la IP, enumeración de rango, reclamación seleccionada e interfaz en español/inglés. El entorno de prueba usa un directorio independiente del inventario real.

## Límites de la verificación

El adaptador de servicio del contenedor no reproduce systemd ni sus restricciones. Falta validar instalación completa, reinicio automático y desinstalación con systemd real en VM/WSL2 y certificar otras distribuciones. Las ramas de apt/dnf/zypper/pacman son mecanismos de instalación previstos, no una lista de distribuciones certificadas.

La detección de interfaces no es un escaneo ni valida conectividad. La interfaz es adaptable mediante CSS; la revisión visual se realizó en el navegador de escritorio. No se ha certificado una matriz de navegadores móviles.

Los tests no contienen direcciones o datos reales de infraestructura: usan rangos y máquinas de prueba. El contenedor de ciclo de vida es desechable y no instala servicios en el anfitrión.
