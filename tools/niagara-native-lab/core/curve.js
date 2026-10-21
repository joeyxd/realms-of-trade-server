const f32 = Math.fround;
export function sampleCurve(curve, age) {
  // NiagaraDataInterfaceCurve::SampleCurveInternal<true>: clamped linear LUT lookup.
  const at = Math.max(0, Math.min(curve.samples.length - 1,
    f32(f32(f32(age - curve.minTime) * curve.inverseRange) * (curve.samples.length - 1))));
  const i = Math.floor(at), j = Math.min(i + 1, curve.samples.length - 1);
  return f32(curve.samples[i] + f32((curve.samples[j] - curve.samples[i]) * f32(at - i)));
}
// LUT shape check shared by the pilot stages; each caller states its own sample count, range and message.
export function validateCurve(curve, { sampleCount, min, max, message }) {
  if (!curve || !Number.isFinite(curve.minTime) || !Number.isFinite(curve.inverseRange) || curve.inverseRange <= 0 ||
      !Array.isArray(curve.samples) || curve.samples.length !== sampleCount || !curve.samples.every(v => Number.isFinite(v) && v >= min && v <= max))
    throw new Error(message);
  return curve;
}
