# S12 — pintura compartida de roca natural

Fecha: 2026-10-07. Continuación visual de S11; arte tropical ilustrado, superficies pintadas y tinta escogida.

Aplicar una familia coherente a las **rocas existentes** de playa e interior. Mantener formas, posiciones,
escala, normales geométricas, sombras, oclusión y colisiones. No consumir RNG ni modificar props/máscaras
del mapa. Las rocas volcánicas, de arena de combate y lava conservan su shader anterior.

El diagnóstico del terreno no encontró caras naturales que alcanzasen el umbral antiguo de roca en las
zonas muestreadas. La costa actual tiene laderas suaves: este corte aborda objetos de roca y deja las
caras de acantilado, remates y arcos para su corte de geometría. No llamar acantilado a una textura.

Reutilización comprobada en `C:\Unreal`, solo lectura:

| Candidato exacto bajo SimpleMultiplayerSurvival/Content | Bytes | Decisión |
|---|---:|---|
| `Dreamrise_SMSK/Assets/Meshes/SM_Rock.uasset` | 22.059 | Reusar el GLB portable ya validado en S02, sin exportación nueva |
| `NiagaraExamples/StaticMesh/Rock_shopk/T_Rock_shopk_2K_D.uasset` | 1.279.522 | Solo paquete inventariado; pintura, UV y export no comprobados |
| `NiagaraExamples/StaticMesh/Rock_shopk/T_Rock_shopk_2K_DpR.uasset` | 547.638 | Empaquetado de canales sin comprobar; no se importa |
| `NiagaraExamples/StaticMesh/Rock_shopk/T_Rock_shopk_2K_N.uasset` | 1.069.019 | Normal portable/presupuesto sin comprobar; no se importa |

Fuente raíz: `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content`. Los archivos existen y sus
tamaños se verificaron; no se abrió Unreal ni se modificó fuente. Se elige pintura nativa sobre las mallas
y ruido existentes: encaja con el toon y evita una nueva descarga 2K.

Contrato: tonos piedra cálida, caras superiores claras, tono frío lateral, manchas contenidas, grietas
escasas con antialias y pie oscurecido por el nivel del mar. La luz mantiene las normales existentes;
el color de cada cara se apoya en sus derivadas geométricas. El detalle fino desaparece en low y a distancia;
la paleta y humedad sobreviven. Sin mapas normal nuevos, imágenes, modelos ni pases extra.

Aceptar localmente con tests de routing/eligibilidad, independencia de uniforms, preservación de fuente/
props/RNG/transformaciones; QA serial PC/móvil/low/assets desactivados/noche/vertical rotado, tres vistas y
cambios de calidad. Conservar fuentes exactas y comparaciones de geometría/instancias por SHA-256.
Actualizar únicamente las filas `roca-cara` y `m03-roca-natural`, con alcance de objetos existentes.

Ajuste artístico con el autor, FPS físicos y publicación quedan pendientes. Resultado y evidencias:
[entrega S12](../delivery/rock-faces-v1.md).
