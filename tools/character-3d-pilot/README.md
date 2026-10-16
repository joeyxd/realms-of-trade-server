# Piloto de conversión 3D

El [brief y estado](../../docs/delivery/character-3d-pilot-v1.md) separa la dirección visual aceptada de la futura malla y su adaptación al juego.

`meshy-check.mjs` usa el SDK de la instalación local de Meshy para comprobar handshake stdio, herramientas, esquema del primer ensayo y saldo. No llama a herramientas de generación ni modifica la partida.

```powershell
node tools/character-3d-pilot/meshy-check.mjs
```

La instalación esperada está en `%USERPROFILE%\.codex\mcp\meshy` con `@meshy-ai/meshy-mcp-server@0.6.1`. Se puede indicar otra carpeta mediante `MESHY_MCP_DIR`. El servidor lee `MESHY_API_KEY` del entorno o su archivo local `.env`; no escribir credenciales en el repositorio.

El resultado se guarda en `docs/art/character-3d-pilot-v1/meshy-preflight.json`. `installed-auth-pending` acredita instalación pero no acceso autenticado; `ready` acredita el chequeo de saldo, no la generación ni calidad artística. La solicitud propuesta conserva una ruta de entrada relativa en el recibo para portabilidad; al ejecutarla con el MCP debe resolverse a ruta absoluta.

La imagen elegida es `male-scout-master-v1.png`, original 1024 × 1536. La petición propuesta usa Meshy 7.1, GLB triangular, pose T, remesh objetivo de 15.000 caras y textura 2K: 30 créditos documentados. Aún no se ha enviado. Se revisará el primer modelo antes de procesar la base femenina, rig o accesorios.
