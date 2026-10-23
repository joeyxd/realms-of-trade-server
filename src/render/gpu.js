// GPU detection for the Ultra comic tier (M4.7 P1): the driver's renderer string -> weak | mid | strong.
// Pure string work, no three.js, so it runs under node --test.

const WEAK = /swiftshader|llvmpipe|softpipe|software|basic render|mali-4|mali-t|powervr|intel\(r\) hd graphics|intel hd|\bgma/;
const STRONG = /geforce|\brtx\b|\bgtx\b|quadro|nvidia|radeon rx|radeon pro|intel\(r\) arc|intel arc|apple m\d/;

// 'weak' | 'mid' | 'strong' from a renderer string. mobile: a phone or tablet ("Apple GPU" is every iPhone and
// iPad, and Safari's name for the Mac's too, so it only counts as strong on a desktop).
export function classifyGpu(name, mobile = false) {
  const n = String(name || '').toLowerCase();
  if (WEAK.test(n)) return 'weak';
  // Adreno: 2xx-5xx weak, 6xx and 70x-72x mid, 73x and up (and 8xx) strong.
  const ad = /adreno[^0-9]*(\d{3})/.exec(n);
  if (ad) { const g = +ad[1]; return g < 600 ? 'weak' : g >= 730 ? 'strong' : 'mid'; }
  if (STRONG.test(n)) return 'strong';
  if (/apple gpu/.test(n) && !mobile) return 'strong';
  return 'mid';
}

// "ANGLE (Vendor, NAME Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NAME" (also the Vulkan / OpenGL / Metal forms).
export function cleanGpuName(raw) {
  let s = String(raw || '').trim();
  const m = /^ANGLE\s*\((.*)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/,\s+/);
    s = parts.length > 1 ? parts[1] : parts[0];
    s = s.replace(/^(?:Vulkan|OpenGL(?: ES)?)\s+[\d.]+\s*/i, '').replace(/^\((.*)\)$/, '$1');
    s = s.replace(/^ANGLE Metal Renderer:\s*/i, '');
  }
  s = s.replace(/\s*\(0x[0-9a-f]+\)/gi, '')                  // device id
    .replace(/\s+(?:Direct3D\d*|D3D\d*)\b.*$/i, '')          // API + shader model
    .replace(/\/PCIe\/SSE2$/i, '')
    .replace(/\s+/g, ' ').trim();
  return s;
}

// { name, tier } of the context's GPU ('' and 'mid' when the browser hides it).
export function gpuInfo(renderer, mobile = false) {
  let raw = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    raw = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch { raw = ''; }
  const name = cleanGpuName(raw);
  return { name, tier: classifyGpu(name || raw, mobile) };
}
