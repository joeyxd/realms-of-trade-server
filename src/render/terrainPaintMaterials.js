// Four authored channels reuse already loaded ground/sand maps; the residual is automatic terrain.
export const TERRAIN_PAINT_COLOR = /* glsl */ `
  vec4 authored = clamp(vPaint, 0.0, 1.0);
  float paintSum = min(1.0, dot(authored, vec4(1.0)));
  if (paintSum > 0.001) {
    vec3 paintGrass = grass;
    vec3 paintDirt = dirt * (0.94 + 0.12 * n1);
    vec3 paintSand = sand * (0.96 + 0.06 * n1);
    vec3 paintRock = rock * (0.9 + 0.2 * n1);
    vec3 grassN = vec3(0.0, 0.0, 1.0), dirtN = grassN, sandN = grassN;
    if (mnGroundEnabled > 0.5) {
      if (authored.x > 0.001) paintGrass = mnGroundSample(mnGroundColor, vec2(0.0), fract(groundUV), groundDx, groundDy);
      if (authored.y > 0.001) paintDirt = mnGroundSample(mnGroundColor, vec2(0.5, 0.0), fract(groundUV), groundDx, groundDy);
    }
    if (mnGroundNormalOn > 0.5) {
      if (authored.x > 0.001) grassN = mnGroundSample(mnGroundNormal, vec2(0.0), fract(groundUV), groundDx, groundDy) * 2.0 - 1.0;
      if (authored.y > 0.001) dirtN = mnGroundSample(mnGroundNormal, vec2(0.5, 0.0), fract(groundUV), groundDx, groundDy) * 2.0 - 1.0;
    }
    if (mnSandDryOn * sandOn > 0.5 && authored.z > 0.001) {
      paintSand = textureGrad(mnSandDryColor, sandUV / 8.0, sandDx / 8.0, sandDy / 8.0).rgb;
      sandN = textureGrad(mnSandDryNormal, sandUV / 8.0, sandDx / 8.0, sandDy / 8.0).rgb * 2.0 - 1.0;
    }
    col = col * (1.0 - paintSum) + paintGrass * authored.x + paintDirt * authored.y + paintSand * authored.z + paintRock * authored.w;
    mnSandN = normalize(mnSandN * (1.0 - paintSum) + grassN * authored.x + dirtN * authored.y + sandN * authored.z + vec3(0.0, 0.0, 1.0) * authored.w);
    mnSandNormalWeight = max(mnSandNormalWeight * (1.0 - paintSum),
      paintSum * (1.0 - smoothstep(35.0, 70.0, length(vViewPosition))));
  }
`;
