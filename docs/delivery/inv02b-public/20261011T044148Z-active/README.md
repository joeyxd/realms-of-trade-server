# INV02b — Carga activa, aceptación pública

Canario autenticado WSS del 2026-10-10, 22:41–22:42 America/Mexico_City
(2026-10-11 04:41–04:42 UTC). [Resultado 5/5](acceptance.json) y
[autoridad fija antes/después](authority.ndjson).

Revisión `024610b6df940cbf8cdfd5d6bb2ee06c84ed94d0`, alpha.43/protocolo 49,
imagen `sha256:0ec92e7a66f4858c84a5c4f4d2b584c4daa6055bdc1905f8279de1a4a3577777`.
14 archivos de la imagen coinciden con Git. Una autoridad Supabase durable, Carga
habilitada/lista, sin jugadores, errores ni guardados pendientes antes y después;
actualizador y contenido bloqueados durante el canario, timer conservado activo.

La cuenta temporal nivel 3 prueba adopción explícita, asignación de dos puntos, reset,
replay histórico sin reinstalar el perfil anterior, conflicto durable de revisión atrasada
sin bloquear la autoridad, igualdad base/snapshot y reconexión. Los dos checks de entrada
corresponden a la conexión inicial y la reconexión. Resultado final: Carga 0, reset usado,
masa máxima 50. Cuenta Auth/perfil retirados; cuatro recibos conservados, uno por operación
única (el replay reutiliza el recibo).

SQL029 y el cambio opt-in se comprobaron en la [activación anterior](../20261011T044137Z-activation/activation.ndjson)
con la misma revisión/imagen. La prueba usa comandos reales, no la futura pantalla de
asignación. No prueba jugabilidad de sobrepeso, caída de VPS, teléfono físico ni balance.

Comando reproducible, bajo locks del actualizador/contenido y servidor vacío:

```powershell
$env:MN_QA_ALLOW_PUBLIC='1'
node tools/qa-attributes-public.mjs --env-file <entorno-privado> --out <directorio-nuevo> --active
```

El entorno debe corresponder al Auth/Supabase de esta autoridad. Nunca incluir sus claves
en la evidencia. La herramienta crea y retira únicamente su cuenta marcada y conserva los
recibos. El flag sigue apagado por defecto en instalaciones nuevas.
