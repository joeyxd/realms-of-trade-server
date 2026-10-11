# GM00 — revisión visual de candidatos

Estado: comparación visual local completada con el loader real del juego; **sin aceptación de asset para gameplay**.

La evidencia durable está en [`docs/delivery/gm00/visual-evidence.json`](../../delivery/gm00/visual-evidence.json) y sus 14 capturas. Cada modelo candidato y su fuente se comparan con la misma cámara, normalización de tamaño e iluminación, desde dos ángulos. El loader real se usó; las fuentes permanecen intactas. No se midió rendimiento en un dispositivo móvil físico.

- **Roca WebP 1K:** casi idéntica a la roca fuente bajo el toon actual; conserva geometría, forma y respuesta visual en estas vistas.
- **Coral ~200K triángulos:** mantiene la silueta y el color del coral fuente, con pérdida de detalle fino.
- **Coral ~50K triángulos:** reduce más el tamaño, pero la pérdida de geometría aparece como una superficie más facetada y detalle visible menor.
- **Roca WebP 2K:** se mantiene como comparación de resolución; el candidato 1K ofrece ahorro adicional sin una diferencia visual apreciable en estas capturas.

La revisión no prueba FPS, memoria residente en móvil, ni aceptación para gameplay. Los cuatro outputs siguen siendo candidatos del catálogo. `docs/art/gm00/receipts.json` conserva `visualReview: pending` intencionalmente: su contenido determinista no se modifica para incorporar esta valoración; este informe enlazado registra la revisión independiente.
