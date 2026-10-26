# IC01 — Centro de inferencia del Studio local

Slice T-1019-09 (AREA17, 2026-10-19) sobre alpha.73/protocolo 62; no cambia versión ni protocolo porque
`tools/agent` no viaja en la imagen del VPS. [Doc de uso](../agents/inference-center.md).
Decisión de área: claves, endpoints y llamadas a proveedores viven en el Studio del PC del dueño,
nunca en el servidor (sigue D-A3; `server/inferenceConfig.mjs` continúa siendo solo metadatos).

## Qué entra

- `tools/agent/inference-center.mjs`: registro de endpoints OpenAI compatibles (etiqueta, URL base,
  clave, modelo por defecto), caché de modelos por endpoint (`updatedAt`, `checkedAt`, tope 2500),
  uso acumulado por endpoint y selección activa; fichero `inference.json` bajo `MN_INFERENCE_HOME`
  o `~/.marea-negra/`, escritura atómica, clave nunca devuelta (solo `keyHint`), fichero corrupto
  deja el centro en solo lectura (`invalid_store`) sin tumbar el Studio.
- `tools/agent/endpoint-openai-transport.mjs`: transporte http/https hacia un endpoint registrado,
  misma interfaz `generate()` que el transporte local, `usage { inputTokens, outputTokens }`,
  `servedModel` y `modelMismatch`; registros abiertos a metadatos de proveedor; `tool_calls` no vacío
  o `function_call` no nulo fallan cerrado; `finish_reason: eos` cuenta como `stop`.
- Studio: rutas `/api/inference/endpoint`, `/endpoint/delete`, `/probe`, `/test`, `/select` tras las
  mismas vallas (bearer, Host, Origin, cuerpos exactos); `GET /api/state` añade `inference`.
  Sección "Centro de inferencia" (lista, tiles de uso, formulario, Probar modelos, Probar completado,
  Seleccionar, Borrar, selector de modelos, insignia activa); el selector del wizard no cambia.

## Validación

- 64/64 en cinco archivos (`companion-studio-server`, `companion-studio-ui`, `agent-inference-center`,
  `agent-endpoint-openai-transport`, `agent-local-openai-transport`); gate de despliegue 202/202.
- Verificador independiente dos veces (DONE WHEN 1-10) y revisión Opus dos veces; el rework corrigió
  la tolerancia del decodificador, la forma de `usage`, el arranque con fichero corrupto, el BOM y
  `models` del wizard; el parche final admite `tool_calls: []` y `function_call: null` (vLLM, Mistral).
- Humo visual con Playwright contra un endpoint falso local (GET `/v1/models`, POST
  `/v1/chat/completions` con Bearer obligatorio): alta, sondeo (3 modelos), selección, completado con
  uso 12/9 tokens y `servedModel` con fecha; la clave no aparece en el DOM; sin desbordamiento a 390 px.
  Evidencia: [smoke.json](ic01-inference-center/smoke.json) y [hero.webp](ic01-inference-center/hero.webp);
  capturas completas fuera de git (sha256 en el JSON).

## Límites conocidos

- Modelos o-series/gpt-5 rechazan `max_tokens` y `temperature: 0` (HTTP 400 visible como `http_status`).
- El sondeo de 1,5 s del Studio vuelve a pintar las tarjetas durante un turno del compañero: el texto
  se conserva, el foco no. Una prueba de completado deshabilita Iniciar/Enviar hasta 30 s.
- Sin cableado al runtime del compañero ni al wizard (IC02) ni al cuerpo de presencia (IC03).
