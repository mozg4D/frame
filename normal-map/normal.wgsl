// Perceptual color -> estimated height -> tangent-space normal. No scene dependencies.
struct Settings {
  size: vec2u, mode: u32, wrap: u32,
  range: vec2f, gamma: f32, denoise: f32,
  bands: vec3f, strength: f32,
  feature: vec4f, // threshold, background, bevel radius (pixels), microdetail
  ySign: f32, step: i32, morphology: i32, padding: f32,
};
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> s: Settings;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var normals: texture_storage_2d<rgba8unorm, write>;

fn coord(p: vec2i, size: vec2i) -> vec2i {
  if (s.wrap != 0u) { return p - size * vec2i(floor(vec2f(p) / vec2f(size))); }
  return clamp(p, vec2i(0), size - 1);
}
fn load(p: vec2i) -> vec4f { return textureLoad(src, coord(p, vec2i(textureDimensions(src))), 0); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn value(c: vec3f) -> f32 {
  var h = luma(c);
  if (s.mode == 1u) { h = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
  let t = clamp((h - s.range.x) / max(s.range.y - s.range.x, 0.02), 0.0, 1.0);
  if (s.gamma == 1.0) { return t; }
  return pow(t, s.gamma);
}
@compute @workgroup_size(8, 8)
fn prepare(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.size)) { return; }
  let p = vec2i(id.xy);
  let center = value(load(p).rgb);
  var h = 0.0; var total = 0.0;
  // Small bilateral filter reduces JPEG/WebP grain without erasing thin grooves.
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let v = value(load(p + vec2i(x, y)).rgb);
    let spatial = f32(select(1, 2, x == 0) * select(1, 2, y == 0));
    let w = spatial / (1.0 + 60.0 * (v-center) * (v-center));
    h += w * v; total += w;
  }}
  h = mix(center, h / total, s.denoise);
  let raw = luma(load(p).rgb);
  if (s.mode == 2u) { h = select(0.0, 1.0, abs(raw - s.feature.y) > s.feature.x); }
  if (s.mode == 3u) { h = smoothstep(s.feature.x - 0.025, s.feature.x + 0.025, raw); }
  textureStore(dst, p, vec4f(h, raw, 0.0, 1.0));
}
// Close the two lit/shadowed halves of an emboss before estimating its bevel.
@compute @workgroup_size(8, 8)
fn morphology(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.size)) { return; }
  let p = vec2i(id.xy); var v = select(1.0, 0.0, s.morphology > 0);
  for (var k = -3; k <= 3; k++) {
    let h = load(p + select(vec2i(k, 0), vec2i(0, k), s.step != 0)).r;
    if (s.morphology > 0) { v = max(v, h); } else { v = min(v, h); }
  }
  textureStore(dst, p, vec4f(v, load(p).g, 0.0, 1.0));
}
@compute @workgroup_size(8, 8)
fn seed(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.size)) { return; }
  let p = vec2i(id.xy); let v = load(p);
  // Relative coordinates avoid Float16 precision loss on large images.
  textureStore(dst, p, vec4f(select(vec2f(60000.0), vec2f(0.0), v.r < 0.5), v.g, v.r));
}
@compute @workgroup_size(8, 8)
fn distance(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.size)) { return; }
  let p = vec2i(id.xy); let v = load(p); var nearest = v.xy;
  var best = dot(nearest, nearest);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let offset = vec2i(x, y) * s.step;
    let candidate = load(p + offset).xy + vec2f(offset);
    let d = dot(candidate, candidate);
    if (d < best) { nearest = candidate; best = d; }
  }}
  textureStore(dst, p, vec4f(nearest, v.zw));
}
@compute @workgroup_size(8, 8)
fn bevel(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.size)) { return; }
  let p = vec2i(id.xy); let v = load(p);
  let d = max(0.0, length(v.xy) - 0.5);
  let h = sin(min(d / s.feature.z, 1.0) * 1.570796327) * v.w;
  textureStore(dst, p, vec4f(h, v.z, 0.0, 1.0));
}
@compute @workgroup_size(8, 8)
fn downsample(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (any(id.xy >= size)) { return; }
  // 4 bilinear reads = separable [1 3 3 1] low pass, including odd dimensions.
  let center = (vec2f(id.xy) + 0.5) * vec2f(textureDimensions(src)) / vec2f(size);
  let inv = 1.0 / vec2f(textureDimensions(src));
  var v = vec4f(0.0);
  for (var y = -1; y <= 1; y += 2) { for (var x = -1; x <= 1; x += 2) {
    v += textureSampleLevel(src, linearSampler, (center + vec2f(f32(x), f32(y)) * 0.75) * inv, 0.0);
  }}
  textureStore(dst, vec2i(id.xy), v * 0.25);
}
fn sampleHeight(uv: vec2f, level: f32) -> vec2f {
  return textureSampleLevel(src, linearSampler, uv, level).rg;
}
fn gradient(uv: vec2f, level: f32) -> vec2f {
  let step = exp2(level) / vec2f(s.size);
  let dx = sampleHeight(uv + vec2f(step.x, 0.0), level).r - sampleHeight(uv - vec2f(step.x, 0.0), level).r;
  let dy = sampleHeight(uv + vec2f(0.0, step.y), level).r - sampleHeight(uv - vec2f(0.0, step.y), level).r;
  return vec2f(dx, dy) * (0.5 / exp2(level));
}
@compute @workgroup_size(8, 8)
fn normal(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.size)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(s.size);
  let maxLevel = f32(textureNumLevels(src) - 1u);
  // Difference-of-Gaussian bands suppress broad baked lighting and albedo stains.
  let g0 = gradient(uv, 0.0);
  let g1 = gradient(uv, min(1.0, maxLevel));
  let g3 = gradient(uv, min(3.0, maxLevel));
  let g5 = gradient(uv, min(5.0, maxLevel));
  var g = s.bands.x * (g0-g1) + s.bands.y * (g1-g3) + s.bands.z * (g3-g5);
  if (s.mode >= 2u && s.feature.w > 0.0) {
    let d = 1.0 / vec2f(s.size);
    let micro = vec2f(sampleHeight(uv+vec2f(d.x,0),0).g-sampleHeight(uv-vec2f(d.x,0),0).g,
                      sampleHeight(uv+vec2f(0,d.y),0).g-sampleHeight(uv-vec2f(0,d.y),0).g) * 0.5;
    g += micro * s.feature.w;
  }
  // Image rows point down; tangent +Y points up. DirectX flips only green.
  let n = normalize(vec3f(-g.x * s.strength, g.y * s.strength * s.ySign, 1.0));
  textureStore(normals, vec2i(id.xy), vec4f(n * 0.5 + 0.5, 1.0));
}
