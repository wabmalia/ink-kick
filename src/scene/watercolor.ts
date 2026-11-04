import * as THREE from 'three';

// Draws the scene as ink and watercolour. The scene renders twice, once for
// colour and depth and once for normals, then one full-screen pass:
//   - ink outlines from depth and normal edges, uneven in weight with the
//     odd gap, and redrawn a few times a second like hand-drawn frames;
//   - colour as layered washes: softly posterised, bleeding a little, with
//     pigment pooling darker where washes meet;
//   - paper grain, granulation and a slight wobble so no line is ruled.

// How many times a second the ink lines are redrawn; 0 holds them still.
const BOIL_FPS = 4;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 resolution;
  uniform float pixelRatio;
  uniform float boil;
  uniform float near;
  uniform float far;
  varying vec2 vUv;

  const vec3 INK = vec3(0.06, 0.07, 0.14);

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  float viewDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return 2.0 * near * far / (far + near - z * (far - near));
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 paint(vec2 uv) { return toSRGB(aces(texture2D(tColor, uv).rgb * 1.05)); }

  void main() {
    vec2 px = 1.0 / resolution;
    // Pixel coordinates in CSS pixels, so the texture scale doesn't change
    // with the screen's density.
    vec2 p = vUv * resolution / pixelRatio;
    vec2 step1 = px * pixelRatio;

    // The wash sits slightly off the lines, as if painted by hand.
    vec2 wobble = (vec2(fbm(p * 0.015), fbm(p * 0.015 + 9.1)) - 0.5) * step1 * 2.5;
    vec2 uv = vUv + wobble;

    vec3 col = paint(uv);
    vec3 bleed = 0.25 * (
      paint(uv + step1 * vec2(2.0, 0.0)) + paint(uv - step1 * vec2(2.0, 0.0)) +
      paint(uv + step1 * vec2(0.0, 2.0)) + paint(uv - step1 * vec2(0.0, 2.0)));
    // Pigment pools where one wash meets another.
    float border = clamp(length(col - bleed) * 2.2, 0.0, 1.0);
    col = mix(col, bleed, 0.2);

    // Layered washes: the value steps softly, the hue stays.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    float bands = 5.0;
    float lq = (floor(l * bands) + smoothstep(0.3, 0.7, fract(l * bands))) / bands;
    col *= (lq + 0.03) / (l + 0.03);
    col *= 1.0 - border * 0.2;

    // Pigment is never neon, and never laid down evenly: big soft blotches
    // where it went on thicker or thinner, with hard wet edges round them.
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 0.85);
    float blotch = fbm(p * 0.006 + 3.7);
    float wet = smoothstep(0.47, 0.5, blotch) - smoothstep(0.5, 0.56, blotch);
    col *= 0.9 + 0.2 * smoothstep(0.3, 0.7, blotch);
    col *= 1.0 - wet * 0.08;

    // Granulation and paper tooth, strongest in the mid tones.
    float grain = fbm(p * 0.16);
    float paper = fbm(p * 0.05) * 0.7 + fbm(p * 0.5) * 0.3;
    float mid = 1.0 - abs(lum * 2.0 - 1.0);
    col *= 1.0 + (0.07 + 0.07 * mid) * (grain - 0.5) * 2.0;
    col *= 0.93 + 0.12 * paper;
    // Paper glows through the lightest washes.
    col = mix(col, vec3(0.97, 0.95, 0.9), smoothstep(0.62, 0.95, lum) * 0.35);

    // Ink: edges in depth and in surface direction, sampled a jittered
    // distance away so the line weight varies along its length.
    vec2 q = p * 0.04 + boil * 13.7;
    float w = 0.8 + 1.3 * noise(q);
    vec2 dx = vec2(step1.x * w, 0.0);
    vec2 dy = vec2(0.0, step1.y * w);
    vec2 iuv = vUv + wobble * 0.3;
    float d = viewDepth(iuv);
    float dd = abs(viewDepth(iuv + dx) - d) + abs(viewDepth(iuv - dx) - d)
             + abs(viewDepth(iuv + dy) - d) + abs(viewDepth(iuv - dy) - d);
    float depthEdge = smoothstep(0.012, 0.05, dd / d);
    vec3 n = texture2D(tNormal, iuv).xyz;
    float nd = length(texture2D(tNormal, iuv + dx).xyz - n) + length(texture2D(tNormal, iuv - dx).xyz - n)
             + length(texture2D(tNormal, iuv + dy).xyz - n) + length(texture2D(tNormal, iuv - dy).xyz - n);
    // High enough that a round stick's own curve doesn't read as an edge.
    float normalEdge = smoothstep(1.0, 1.8, nd);
    float ink = max(depthEdge, normalEdge);
    // Lift the pen now and then.
    ink *= 0.55 + 0.45 * smoothstep(0.2, 0.45, noise(p * 0.09 + boil * 5.3));
    col = mix(col, INK, ink * 0.85);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Watercolor {
  private color: THREE.WebGLRenderTarget;
  private normals: THREE.WebGLRenderTarget;
  private normalMaterial = new THREE.MeshNormalMaterial();
  private normalBackground = new THREE.Color(0.5, 0.5, 1);
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(private renderer: THREE.WebGLRenderer) {
    this.color = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.normals = new THREE.WebGLRenderTarget(1, 1);
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tColor: { value: this.color.texture },
          tDepth: { value: this.color.depthTexture },
          tNormal: { value: this.normals.texture },
          resolution: { value: new THREE.Vector2(1, 1) },
          pixelRatio: { value: 1 },
          boil: { value: 0 },
          near: { value: 1 },
          far: { value: 300 },
        },
      }),
    );
  }

  setSize(width: number, height: number) {
    const ratio = this.renderer.getPixelRatio();
    const w = Math.floor(width * ratio);
    const h = Math.floor(height * ratio);
    this.color.setSize(w, h);
    this.normals.setSize(w, h);
    const u = this.quad.material.uniforms;
    u.resolution!.value.set(w, h);
    u.pixelRatio!.value = ratio;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number) {
    const { renderer } = this;
    const u = this.quad.material.uniforms;
    u.near!.value = camera.near;
    u.far!.value = camera.far;
    u.boil!.value = BOIL_FPS ? Math.floor(time * BOIL_FPS) % 64 : 0;

    renderer.setRenderTarget(this.color);
    renderer.render(scene, camera);

    // Normals reuse this frame's shadow maps.
    const background = scene.background;
    const fog = scene.fog;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.normalMaterial;
    scene.background = this.normalBackground;
    scene.fog = null;
    renderer.setRenderTarget(this.normals);
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = background;
    scene.fog = fog;
    renderer.shadowMap.autoUpdate = true;

    renderer.setRenderTarget(null);
    renderer.render(this.quad, this.quadCamera);
  }
}
