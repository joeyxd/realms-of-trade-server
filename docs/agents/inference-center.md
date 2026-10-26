# Centro de inferencia local

El Studio guarda conexiones OpenAI compatibles en `inference.json`. Ubicación: `MN_INFERENCE_HOME` o, por defecto, `~/.marea-negra/`.
`createCompanionStudio({ inferenceHome })` aísla la ubicación en pruebas.
Las escrituras usan un temporal en el mismo directorio y renombrado atómico.
La clave queda en ese archivo local; protege el acceso a tu cuenta del equipo.

## Esquema v1

- `v: 1`; `endpoints`: hasta 32 registros con `id`, `label`, `baseUrl`, `apiKey`,
  `defaultModel`, `createdAt` y `updatedAt` (fechas ISO).
- `active`: `{ endpointId, modelId }` o `null`.
- `catalog[id]`: `{ models, updatedAt, checkedAt, error }`; hasta 2500 modelos únicos ordenados.
  `updatedAt` fecha el último éxito (o `null`); `checkedAt` fecha el último intento.
  Un fallo conserva modelos y `updatedAt`. Los catálogos anteriores sin `checkedAt` se admiten.
- `usage[id]`: `{ requests, failures, promptTokens, completionTokens, latencyMsTotal,
  lastAt, lastError }`.
- Las vistas exponen `keyHint`: últimos cuatro caracteres si la clave tiene al menos ocho;
  para claves menores o vacías, `null`. Nunca exponen `apiKey`.
- Omitir `apiKey` conserva la clave; enviar `''` la borra.
- Cambiar URL o clave invalida catálogo y selección de esa conexión.
- Un archivo corrupto o inválido deja el centro en solo lectura: `inference.error`
  vale `invalid_store`, sin endpoints ni selección; no se sobrescribe el archivo.
  El Studio y sus funciones de compañero siguen disponibles.

## Rutas del Studio

Las mutaciones requieren bearer del Studio, Origin local y campos exactos.
`GET /api/state` incluye `inference: { endpoints, active, error? }`.
Cada endpoint expone modelos, `catalogUpdatedAt`, `catalogCheckedAt`, `catalogError` y uso.
- `POST /api/inference/endpoint`: `{ endpoint: { id, label, baseUrl, apiKey?, defaultModel } }`.
  `id: null` crea; un ID existente edita. `defaultModel` admite `null`.
- `POST /api/inference/endpoint/delete`: `{ id }`; borra catálogo, uso y selección.
- `POST /api/inference/probe`: `{ id }`.
- `POST /api/inference/test`: `{ id, modelId, prompt }`.
- `POST /api/inference/select`: `{ id, modelId }`; exige modelo en caché o predeterminado.

## Consultar y probar

Guarda etiqueta, URL HTTP(S), clave opcional y modelo. «Editar» permite borrar la clave.
«Probar modelos» pide `baseUrl/models`; si falla y no termina en `/v1`,
intenta una vez `baseUrl/v1/models`, sin redirecciones: 10 segundos y 1 MiB por petición.
«Seleccionar» guarda la elección. No modifica el runtime ni el asistente de creación.
«Probar completado» envía el prompt (1–2000 caracteres) una vez, sin reintentos.
Usa `/chat/completions` bajo `/v1`, temperatura 0, `max_tokens: 256`, `stream: false`,
30 segundos, entrada de 16 KiB y respuesta de 256 KiB; muestra hasta 2000 caracteres.
Devuelve `usage: { inputTokens, outputTokens }` o `null`, latencia, HTTP y `servedModel`.
`modelMismatch` avisa si el modelo servido difiere y no empieza por `modeloSolicitado-`.
Se ignoran metadatos adicionales y `finish_reason: eos` cuenta como `stop`; se rechazan mensajes con `tool_calls` no vacío o `function_call` no nulo.
El almacén acumula `inputTokens` como `promptTokens` y `outputTokens` como `completionTokens`.
La UI conserva prompt y modelo por endpoint al actualizar. No consulta proveedores automáticamente.

## Códigos de resultado

`ok`; `invalid_request` (400); `endpoint_unknown` (404); `invalid_store` (409, solo lectura).
Fallos (409): `http_status`, `invalid_json`, `invalid_response`, `transport_error`, `timeout`,
`response_too_large`, `content_type`, `output_limit`, `truncated`, `content_filter`, `incomplete`.
`storage_error`: no se pudo persistir. No se devuelve texto de errores HTTP del proveedor.
El transporte también da `aborted`, `busy`, `call_limit`, `uncertain_blocked`;
una ejecución incierta bloquea llamadas adicionales en esa instancia.


## Vincular un compañero

`POST /api/create` admite `inference: { endpointId, modelId }` junto a `draft` y `limits`.
El Studio resuelve la selección antes de crear archivos; el modelo debe estar en caché o ser `defaultModel`.
La vinculación vive solo en `local-runtime.json` (esquema v1) y tiene precedencia sobre
`manifest.provider` de `companion-manifest.json`; el draft y su configuración loopback se conservan.
El snapshot expone `binding` con esos dos identificadores, o `null` para compañeros sin vincular.
Al abrir no se resuelve; cada `start()` resuelve una vez el registro actual antes de abrir sesiones.
Si falla, no hay fallback: `inference_unavailable` sin resolver, `endpoint_unknown` al borrar
la conexión, `model_unknown` si el modelo dejó de estar disponible, `invalid_request`,
`invalid_store` o `storage_error`. Crear devuelve 400 para `invalid_request`, 404 para
`endpoint_unknown` y 409 para los otros fallos. No se modifica la vinculación tras crear.
La clave queda únicamente en el almacén de inferencia y en memoria del transporte;
nunca en archivos del compañero, vistas, snapshots, registros ni errores.
Sin vinculación se conserva el transporte loopback y su presupuesto anterior.
