/* A small WebGL 1 renderer. All meshes, signs and lighting are made locally. */
(function (root) {
  'use strict';
  const { FIXTURES, EXIT, clamp, dist } = root.BKCore;
  const TAU = Math.PI * 2;
  const color = c => {
    if (Array.isArray(c)) return c.length === 4 ? c : [...c, 1];
    return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255, 1];
  };
  const M = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; },
    translate(x, y, z) { const m = M.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
    ry(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rz(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    rx(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    perspective(fov, a, n, f) { const t = 1 / Math.tan(fov / 2), q = 1 / (n - f); return new Float32Array([t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * q, -1, 0, 0, 2 * f * n * q, 0]); },
    view(x, y, z, yaw, pitch) {
      const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      const r = [cy, 0, sy], u = [-sy * sp, cp, cy * sp], b = [-sy * cp, -sp, cy * cp];
      return new Float32Array([r[0], u[0], b[0], 0, r[1], u[1], b[1], 0, r[2], u[2], b[2], 0,
        -(r[0] * x + r[1] * y + r[2] * z), -(u[0] * x + u[1] * y + u[2] * z), -(b[0] * x + b[1] * y + b[2] * z), 1]);
    }
  };
  class Mesh {
    constructor() { this.v = []; this.mat = M.identity(); }
    transform(m, fn) { const old = this.mat; this.mat = M.mul(old, m); fn(); this.mat = old; }
    vertex(p, n, c, glow) {
      const m = this.mat;
      this.v.push(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
        m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2], ...c, glow);
    }
    tri(a, b, c, col, glow = 0, normal) {
      let n = normal;
      if (!n) { const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]); n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(v => v / l); }
      col = color(col); this.vertex(a, n, col, glow); this.vertex(b, n, col, glow); this.vertex(c, n, col, glow);
    }
    quad(a, b, c, d, col, glow = 0, normal) { this.tri(a, b, c, col, glow, normal); this.tri(a, c, d, col, glow, normal); }
    box(x, y, z, w, h, d, col, glow = 0) {
      const l = x - w / 2, r = x + w / 2, b = y - h / 2, t = y + h / 2, f = z - d / 2, k = z + d / 2;
      this.quad([l, t, f], [l, t, k], [r, t, k], [r, t, f], col, glow, [0, 1, 0]);
      this.quad([l, b, k], [l, b, f], [r, b, f], [r, b, k], col, glow, [0, -1, 0]);
      this.quad([l, b, f], [l, t, f], [r, t, f], [r, b, f], col, glow, [0, 0, -1]);
      this.quad([r, b, k], [r, t, k], [l, t, k], [l, b, k], col, glow, [0, 0, 1]);
      this.quad([l, b, k], [l, t, k], [l, t, f], [l, b, f], col, glow, [-1, 0, 0]);
      this.quad([r, b, f], [r, t, f], [r, t, k], [r, b, k], col, glow, [1, 0, 0]);
    }
    cylinder(x, y, z, r, h, col, sides = 10, glow = 0, topR = r) {
      for (let i = 0; i < sides; i++) {
        const a = i * TAU / sides, b = (i + 1) * TAU / sides;
        const p = [x + Math.cos(a) * r, y - h / 2, z + Math.sin(a) * r], q = [x + Math.cos(b) * r, y - h / 2, z + Math.sin(b) * r];
        const t = [x + Math.cos(a) * topR, y + h / 2, z + Math.sin(a) * topR], u = [x + Math.cos(b) * topR, y + h / 2, z + Math.sin(b) * topR];
        this.quad(p, q, u, t, col, glow, [Math.cos((a + b) / 2), 0, Math.sin((a + b) / 2)]);
        this.tri([x, y + h / 2, z], t, u, col, glow, [0, 1, 0]);
        this.tri([x, y - h / 2, z], q, p, col, glow, [0, -1, 0]);
      }
    }
    sphere(x, y, z, r, col, glow = 0, rings = 5, sides = 8) {
      const p = (a, b) => [x + Math.cos(b) * Math.sin(a) * r, y + Math.cos(a) * r, z + Math.sin(b) * Math.sin(a) * r];
      for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) this.quad(p(j / rings * Math.PI, i / sides * TAU), p(j / rings * Math.PI, (i + 1) / sides * TAU), p((j + 1) / rings * Math.PI, (i + 1) / sides * TAU), p((j + 1) / rings * Math.PI, i / sides * TAU), col, glow);
    }
    disc(x, y, z, r, col, glow = 0) { for (let i = 0; i < 24; i++) this.tri([x, y, z], [x + Math.sin(i / 24 * TAU) * r, y, z + Math.cos(i / 24 * TAU) * r], [x + Math.sin((i + 1) / 24 * TAU) * r, y, z + Math.cos((i + 1) / 24 * TAU) * r], col, glow, [0, 1, 0]); }
    ring(x, y, z, r, w, col, glow = .9) {
      for (let i = 0; i < 48; i++) {
        const a = i / 48 * TAU, b = (i + 1) / 48 * TAU;
        this.quad([x + Math.sin(a) * r, y, z + Math.cos(a) * r], [x + Math.sin(b) * r, y, z + Math.cos(b) * r], [x + Math.sin(b) * (r + w), y, z + Math.cos(b) * (r + w)], [x + Math.sin(a) * (r + w), y, z + Math.cos(a) * (r + w)], col, glow, [0, 1, 0]);
      }
    }
  }
  const VS = `attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor; attribute float aGlow;
    uniform mat4 uVP; varying vec3 vPos; varying vec3 vNormal; varying vec4 vColor; varying float vGlow;
    void main(){vPos=aPos;vNormal=aNormal;vColor=aColor;vGlow=aGlow;gl_Position=uVP*vec4(aPos,1.0);}`;
  const FS = `precision mediump float; varying vec3 vPos;varying vec3 vNormal;varying vec4 vColor;varying float vGlow;
    uniform vec3 uEye; uniform float uTime; uniform float uPower;
    void main(){
      vec3 n=normalize(vNormal);float key=max(0.0,dot(n,normalize(vec3(-.35,.85,.3))));
      float fill=max(0.0,dot(n,normalize(vec3(.7,.25,-.5))));
      float d1=length(vPos-vec3(5.0,3.1,5.0));float d2=length(vPos-vec3(13.0,2.8,10.8));
      float local=.17/(.1+d1*.09)+.13/(.2+d2*.09);
      vec3 light=vec3(.40,.45,.44)+vec3(.43,.40,.33)*key+vec3(.10,.14,.17)*fill+vec3(local*.25,local*.28,local*.23);
      vec3 c=vColor.rgb*light*(.22+.78*uPower);
      c=mix(c,vColor.rgb*(1.03+.025*sin(uTime*1.5)),vGlow);
      float fog=smoothstep(11.0,40.0,distance(vPos,uEye));c=mix(c,vec3(.055,.105,.135),fog*.8);
      gl_FragColor=vec4(c,vColor.a);
    }`;
  const TVS = `attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uVP;varying vec2 vUV;void main(){vUV=aUV;gl_Position=uVP*vec4(aPos,1.0);}`;
  const TFS = `precision mediump float;uniform sampler2D uTexture;uniform float uAlpha;varying vec2 vUV;void main(){vec4 c=texture2D(uTexture,vUV);if(c.a<.02)discard;gl_FragColor=vec4(c.rgb,c.a*uAlpha);}`;
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas; this.quality = 'auto'; this.reduceMotion = false; this.time = 0;
      this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }) || canvas.getContext('experimental-webgl');
      if (!this.gl) throw new Error('這個瀏覽器無法建立 WebGL 畫面。請使用 Safari、Chrome 或 Edge，並開啟硬體加速。');
      const gl = this.gl;
      this.program = this.programOf(VS, FS); this.textProgram = this.programOf(TVS, TFS);
      this.loc = { pos: gl.getAttribLocation(this.program, 'aPos'), normal: gl.getAttribLocation(this.program, 'aNormal'), color: gl.getAttribLocation(this.program, 'aColor'), glow: gl.getAttribLocation(this.program, 'aGlow'), vp: gl.getUniformLocation(this.program, 'uVP'), eye: gl.getUniformLocation(this.program, 'uEye'), time: gl.getUniformLocation(this.program, 'uTime'), power: gl.getUniformLocation(this.program, 'uPower') };
      this.tloc = { pos: gl.getAttribLocation(this.textProgram, 'aPos'), uv: gl.getAttribLocation(this.textProgram, 'aUV'), vp: gl.getUniformLocation(this.textProgram, 'uVP'), texture: gl.getUniformLocation(this.textProgram, 'uTexture'), alpha: gl.getUniformLocation(this.textProgram, 'uAlpha') };
      this.dynamic = gl.createBuffer(); this.transparentDynamic = gl.createBuffer(); this.handBuffer = gl.createBuffer(); this.textBuffer = gl.createBuffer();
      this.labels = []; this.cache = new Map();
      const scene = new Mesh(), glass = new Mesh(); this.buildStore(scene, glass);
      this.static = this.upload(scene); this.glass = this.upload(glass);
      this.eye = [10.65, 1.58, 11.2]; this.vp = M.identity();
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.resize();
    }
    programOf(vs, fs) {
      const gl = this.gl, program = gl.createProgram();
      for (const [kind, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(kind); gl.shaderSource(s, code); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('畫面著色器無法編譯：' + message); }
        gl.attachShader(program, s); gl.deleteShader(s);
      }
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('畫面程式無法連結：' + gl.getProgramInfoLog(program));
      return program;
    }
    upload(mesh) { const gl = this.gl, buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.v), gl.STATIC_DRAW); return { buffer, count: mesh.v.length / 11 }; }
    resize() {
      const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(root.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'low' ? 1 : 1.4);
      const cap = this.quality === 'low' ? 540 : this.quality === 'high' ? 1200 : 850;
      const scale = Math.min(dpr, cap / Math.max(1, rect.height));
      const w = Math.max(1, Math.floor(rect.width * scale)), h = Math.max(1, Math.floor(rect.height * scale));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.width = rect.width; this.height = rect.height;
      this.gl.viewport(0, 0, w, h);
    }
    texture(text, opts = {}) {
      const key = JSON.stringify([text, opts]); if (this.cache.has(key)) return this.cache.get(key);
      const gl = this.gl, c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const ctx = c.getContext('2d'); ctx.clearRect(0, 0, 512, 128);
      if (opts.bg) { ctx.fillStyle = opts.bg; ctx.beginPath(); ctx.roundRect(3, 3, 506, 122, opts.radius || 14); ctx.fill(); }
      if (opts.border) { ctx.lineWidth = 3; ctx.strokeStyle = opts.border; ctx.strokeRect(5, 5, 502, 118); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 ${opts.size || 43}px system-ui,"Microsoft JhengHei",sans-serif`;
      ctx.fillStyle = opts.fg || '#f6eed8'; ctx.shadowColor = opts.glow || 'transparent'; ctx.shadowBlur = opts.glow ? 13 : 0;
      ctx.fillText(text, 256, 67, 475);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.cache.set(key, texture); return texture;
    }
    sign(text, x, y, z, w, h, yaw = 0, opts = {}) { this.labels.push({ texture: this.texture(text, opts), x, y, z, w, h, yaw }); }
    buildStore(b, g) {
      // Outside silhouettes and puddles behind the glass storefront.
      b.box(9, -.15, 10, 70, .18, 70, '#172e3c');
      for (let i = 0; i < 9; i++) {
        const h = 4 + i % 4 * 2.4, x = -12 + i * 5;
        b.box(x, h / 2, 24 + i % 3 * 3, 4.1, h, 4, ['#183844', '#18313f', '#243b48'][i % 3]);
        for (let j = 0; j < 5; j++) for (let k = 0; k < 3; k++) if ((i + j + k) % 3) b.box(x - 1.1 + k, 1 + j * 1.25, 21.97 + i % 3 * 3, .4, .6, .03, (i + j) % 2 ? '#738681' : '#beab7d', .55);
      }
      for (let i = 0; i < 12; i++) b.box(-2 + i * 2.2, -.035, 16.6, .12, .02, 3.4, '#6c8080');
      // Tiled floor, four walls, storefront and a real doorway opening.
      b.box(9, -.10, 7, 18, .2, 14, '#bacdbd');
      for (let x = 0; x < 18; x++) for (let z = 0; z < 14; z++) {
        b.box(x + .5, .005, z + .5, .978, .012, .978, (x + z) % 2 ? '#c9d8c4' : '#d4dfcd');
      }
      b.box(9, 1.85, .08, 18, 3.7, .18, '#d4dac4'); b.box(.08, 1.85, 7, .18, 3.7, 14, '#b8cab8'); b.box(17.92, 1.85, 7, .18, 3.7, 14, '#bfcec0');
      b.box(9, 3.7, 7, 18, .12, 14, '#466664');
      b.box(9, .22, .22, 17.6, .44, .12, '#365c52'); b.box(.22, .22, 7, .12, .44, 13.8, '#365c52');
      b.box(9, 2.4, .2, 18, .15, .08, '#dca469'); b.box(9, 2.56, .2, 18, .055, .09, '#f2c081', .6);
      b.box(.2, 2.43, 7, .08, .15, 14, '#dca469');
      for (const x of [3.9, 10.3, 15]) for (const z of [3, 9.2]) {
        b.box(x, 3.52, z, 2.8, .08, .6, '#233e40'); b.box(x, 3.465, z, 2.58, .04, .41, '#ffefd0', .95);
        g.box(x, .026, z, 2.5, .005, .7, [1, .97, .7, .045], 1);
      }
      for (let x = 0; x <= 18; x += 3) b.box(x, 3.6, 7, .045, .1, 14, '#3c5d5a');
      b.box(5.8, 3.05, 13.6, 11.6, 1.2, .25, '#2d5b53'); b.box(16.85, 3.05, 13.6, 2.3, 1.2, .25, '#2d5b53');
      for (const x of [.2, 3.9, 7.7, 11.55, 15.75, 17.8]) b.box(x, 1.4, 13.55, .11, 2.8, .12, '#507e75');
      for (const [x, w] of [[1.99, 3.45], [5.8, 3.65], [9.62, 3.65], [16.8, 1.9]]) {
        b.box(x, .23, 13.55, w, .46, .15, '#365d55');
        g.box(x, 1.5, 13.54, w, 2.08, .035, [.48, .78, .81, .12], .7);
        b.box(x, 1.67, 13.51, w, .08, .06, '#87afa4');
      }
      b.box(EXIT.x, 2.83, 13.5, 4.1, .55, .3, '#2d5348');
      b.box(EXIT.x1, 1.35, 13.47, .075, 2.7, .16, '#ffbc72', 1); b.box(EXIT.x2, 1.35, 13.47, .075, 2.7, .16, '#ffbc72', 1);
      b.box(EXIT.x, .027, 13.2, 4, .035, .16, '#ffb76c', 1); b.box(EXIT.x, .035, 12.35, 2.7, .05, 1, '#42665a');
      for (let i = 0; i < 3; i++) {
        const z = 10.7 + i * .55;
        b.tri([13.65, .04, z + .23], [13.32, .04, z - .06], [13.98, .04, z - .06], '#e2b674', .5);
      }
      this.sign('EXIT  出口  ↗', EXIT.x, 2.82, 13.31, 3.1, .47, Math.PI, { fg: '#ffe4a3', glow: '#ffa45d', size: 49 });
      this.sign('BYE KARENS!  24 / 7', 5.9, 2.99, 13.39, 6.2, .58, Math.PI, { fg: '#e7ecd2', size: 43 });
      this.sign('好好便利店  NIGHT SHIFT', 8.9, 2.97, .205, 7, .72, 0, { fg: '#f5e5b8', bg: '#31584c', border: '#e7be7c', size: 41 });
      this.sign('請善待每一位服務人員 ♡', 8.7, 2.04, .213, 4.4, .42, 0, { fg: '#536f5b', size: 43 });
      // Shelf islands with boxed snacks, tins and readable aisle markers.
      const packs = ['#e1a45c', '#66978b', '#cf775b', '#9bb390', '#dfc87e', '#7c9ead'];
      FIXTURES.filter(f => f.kind === 'shelf').forEach((s, index) => {
        const { x, z, w, d } = s;
        b.box(x, .027, z, w + .28, .035, d + .28, '#a6bbaa');
        b.box(x, .16, z, w, .23, d, '#547268');
        b.box(x, .89, z, .075, 1.5, d - .08, '#6c8370');
        b.box(x - w / 2 + .05, .9, z, .09, 1.5, d, '#87a48f'); b.box(x + w / 2 - .05, .9, z, .09, 1.5, d, '#87a48f');
        for (const y of [.37, .86, 1.35, 1.67]) {
          b.box(x, y, z, w, .065, d, '#ebd9ad');
          for (const side of [-1, 1]) b.box(x, y - .035, z + side * d / 2, w, .065, .035, '#e4ad65');
        }
        for (let row = 0; row < 3; row++) for (let column = 0; column < 8; column++) for (const side of [-1, 1]) {
          const px = x - 1.1 + column * .31, py = .58 + row * .49, pz = z + side * .35, c = packs[(column + row + index) % packs.length];
          if ((column + index) % 3 === 0) { b.cylinder(px, py, pz, .105, .32, c, 7); b.cylinder(px, py + .17, pz, .095, .025, '#dce7d5', 7); }
          else { b.box(px, py, pz, .22, .33 - column % 2 * .03, .25, c); b.box(px, py + .02, pz + side * .13, .14, .07, .015, '#f3e6bd'); }
          b.box(px, .315 + row * .49, z + side * .686, .12, .045, .01, '#fff7d9');
        }
        this.sign(index % 2 ? 'DAILY · 日常選物' : 'SNACKS · 元氣補給', x, 1.56, z + d / 2 + .012, 2.1, .18, 0, { bg: '#315c4f', fg: '#eedeb5', size: 39 });
        this.sign(index % 2 ? 'DAILY · 日常選物' : 'SNACKS · 元氣補給', x, 1.56, z - d / 2 - .012, 2.1, .18, Math.PI, { bg: '#315c4f', fg: '#eedeb5', size: 39 });
      });
      // Refrigerators: lit interiors, bottles, mullions and inset door handles.
      b.box(17, 1.35, 5.8, 1.2, 2.7, 8.9, '#3b5d59');
      b.box(16.37, 1.45, 5.8, .06, 2.35, 8.6, '#acd4c4', .45);
      for (let i = 0; i < 6; i++) {
        const z = 2.15 + i * 1.45;
        b.box(16.29, 1.46, z - .65, .13, 2.5, .055, '#254f4e');
        b.box(16.2, 2.61, z, .10, .06, 1.29, '#b5f3d9', 1);
        b.box(16.15, 1.33, z + .5, .08, .54, .06, '#e1e6cc');
        for (let row = 0; row < 3; row++) {
          b.box(16.53, .4 + row * .65, z, .5, .05, 1.29, '#d7e1c9');
          for (let j = 0; j < 4; j++) {
            const pz = z - .46 + j * .3, y = .62 + row * .65;
            b.cylinder(16.45, y, pz, .095, .33, ['#d6c27d', '#e6e9ce', '#93b8b0', '#d99b73'][(row + j) % 4], 6);
            b.cylinder(16.45, y + .2, pz, .048, .1, '#dce5ca', 6);
          }
        }
        g.box(16.22, 1.5, z, .025, 2.13, 1.28, [.55, .88, .83, .09], 1);
      }
      this.sign('CHILLED / 冷藏好物', 16.2, 2.94, 5.7, 5.4, .52, -Math.PI / 2, { fg: '#b7f3d9', glow: '#5bc5b3', size: 46 });
      // The checkout, card terminal and warm coffee counter.
      b.box(3.4, .52, 10.9, 4.9, 1.04, 1.1, '#416d5d'); b.box(3.4, 1.09, 10.9, 5.08, .14, 1.25, '#e9d4aa');
      b.box(3.4, .72, 11.466, 4.7, .12, .03, '#d9ab6e'); b.box(3.4, .15, 11.5, 4.7, .025, .03, '#7bf2d5', .8);
      b.box(2.7, 1.2, 10.8, .4, .17, .35, '#243e3b'); b.box(2.7, 1.46, 10.76, .72, .48, .12, '#254b44');
      b.box(2.7, 1.47, 10.837, .62, .34, .02, '#9acdb0', .65); b.box(4.15, 1.2, 10.92, .4, .15, .28, '#364c41');
      this.sign('CHECKOUT · 結帳', 3.6, .66, 11.478, 2.7, .33, 0, { fg: '#e8dcb2', size: 45 });
      b.box(1.05, .64, 4.3, 1.25, 1.28, 3.9, '#9b8b66'); b.box(1.07, 1.32, 4.3, 1.4, .12, 4.04, '#ead7ac');
      b.box(.95, 1.72, 3.4, .74, .75, .65, '#3f5550'); b.box(1.335, 1.7, 3.4, .025, .45, .45, '#263b37');
      b.box(1.35, 1.82, 3.4, .03, .11, .26, '#94d0a8', .8); b.box(1.38, 1.48, 3.4, .1, .07, .4, '#c3cdb8');
      for (let j = 0; j < 3; j++) b.cylinder(1.2, 1.46, 4.1 + j * .36, .10, .22, '#e9dfbc', 8, 0, .12);
      this.sign('COFFEE  咖啡補給', .24, 2.2, 4.3, 3.1, .47, Math.PI / 2, { fg: '#f9e4b5', bg: '#4d6d57', size: 43 });
      // Corner plant and a caution sign give useful depth and scale cues.
      b.cylinder(.85, .28, 12.65, .31, .5, '#ae8261', 8, 0, .36);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU, x = .85 + Math.sin(a) * .46, z = 12.65 + Math.cos(a) * .46;
        b.tri([.85, .5, 12.65], [x + .12, 1.05 + i % 3 * .1, z], [x - .12, 1.35 + i % 3 * .1, z], i % 2 ? '#618a5b' : '#79a46c');
      }
      this.sign('SMILE.  YOU GOT THIS.', 5, 1.96, .22, 2.25, .42, 0, { fg: '#f5ddad', bg: '#aa8560', size: 35 });
      b.box(11.4, .02, 11.8, .7, .03, .7, '#497162');
      this.sign('NIGHT SHIFT', 11.4, .025, 11.8, .6, .14, 0, { fg: '#e8ca93' });
      // Microwave preparation counter, hot meal trays, and the delivery depot.
      b.box(13.7, .53, 1.05, 3.2, 1.06, .9, '#4b7564'); b.box(13.7, 1.12, 1.05, 3.3, .12, 1, '#e7d4ac');
      b.box(13.5, 1.48, 1.01, 1.25, .62, .72, '#d7dac5'); b.box(13.37, 1.48, 1.39, .88, .43, .026, '#263e3e');
      b.box(13.37, 1.47, 1.411, .68, .30, .015, '#475f55'); b.box(14.01, 1.62, 1.41, .17, .10, .026, '#c9efac', .9);
      for (let i = 0; i < 3; i++) b.box(14.01, 1.38 + i * .07, 1.41, .12, .025, .03, '#687a65');
      for (let i = 0; i < 3; i++) { b.box(14.65, 1.21 + i * .09, 1.05, .55, .08, .4, '#e5e5cc'); b.box(14.65, 1.256 + i * .09, 1.05, .42, .015, .27, '#d0a969'); }
      this.sign('HOT MEALS · 熱食區', 13.7, 2.1, .22, 3.3, .4, 0, { fg: '#f3daaa', bg: '#526f54', size: 42 });
      b.box(16.9, .35, 11.7, .75, .7, .75, '#b99162'); b.box(16.9, .71, 11.7, .78, .035, .78, '#d9b177');
      b.box(16.9, .73, 11.7, .13, .02, .78, '#e5d7ab'); b.box(16.9, .38, 11.31, .40, .26, .02, '#e4d7b3');
      this.sign('STOCK / 補貨', 16.9, .39, 11.294, .58, .16, Math.PI, { fg: '#52684e', size: 40 });
    }
    geometry(buffer, count, data) {
      if (!count) return;
      const gl = this.gl, l = this.loc;
      gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (data) gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      const stride = 44;
      for (const [loc, size, offset] of [[l.pos, 3, 0], [l.normal, 3, 12], [l.color, 4, 24], [l.glow, 1, 40]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset); }
      gl.uniformMatrix4fv(l.vp, false, this.vp); gl.uniform3fv(l.eye, this.eye); gl.uniform1f(l.time, this.time); gl.uniform1f(l.power, this.power ?? 1); gl.drawArrays(gl.TRIANGLES, 0, count);
    }
    drawLabel(label, alpha = 1) {
      const gl = this.gl, { x, y, z, w, h, yaw = 0 } = label, c = Math.cos(yaw), s = Math.sin(yaw);
      const point = (dx, dy, u, v) => [x + c * dx, y + dy, z - s * dx, u, v];
      const data = [...point(-w / 2, -h / 2, 0, 1), ...point(w / 2, -h / 2, 1, 1), ...point(w / 2, h / 2, 1, 0), ...point(-w / 2, -h / 2, 0, 1), ...point(w / 2, h / 2, 1, 0), ...point(-w / 2, h / 2, 0, 0)];
      gl.useProgram(this.textProgram); gl.bindBuffer(gl.ARRAY_BUFFER, this.textBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      const l = this.tloc; gl.enableVertexAttribArray(l.pos); gl.vertexAttribPointer(l.pos, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(l.uv); gl.vertexAttribPointer(l.uv, 2, gl.FLOAT, false, 20, 12);
      // A program's old attribute arrays must not read beyond this six-vertex buffer.
      const used = new Set([l.pos, l.uv]);
      for (const a of [this.loc.pos, this.loc.normal, this.loc.color, this.loc.glow]) if (!used.has(a)) gl.disableVertexAttribArray(a);
      gl.uniformMatrix4fv(l.vp, false, this.vp); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, label.texture); gl.uniform1i(l.texture, 0); gl.uniform1f(l.alpha, alpha); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    character(b, g, c, world) {
      const near = dist(c, world.player) < 3.5, active = c.state === 'walking', held = c === world.held;
      const yaw = held ? world.player.yaw + Math.PI : (!c.flying && near && !c.path.length ? Math.atan2(world.player.x - c.x, -(world.player.z - c.z)) : c.yaw);
      const torso = c.karen ? ['#df7058', '#c96964', '#d88456', '#d16b7e'][c.variant] : ['#77a88c', '#729eb5', '#83acaa', '#9faf7c'][c.variant];
      const hair = ['#4e3c34', '#73503b', '#333b39', '#b8a078'][c.variant], skin = ['#ecc29a', '#d5a77e', '#edc9a3', '#c99970'][c.variant];
      const step = !c.flying && c.path.length ? Math.sin(c.walk) * .19 : 0;
      const pose = M.mul(M.translate(c.x, c.y + .015, c.z), M.mul(M.ry(yaw), M.rz(c.flying ? Math.sin(c.turn) * .8 : held ? Math.sin(this.time * 6) * .055 : 0)));
      g.disc(c.x, .026, c.z, .37, [.04, .17, .15, .17]);
      if (c.karen && active && !held && !c.flying) g.ring(c.x, .035, c.z, .4, .025, [.97, .48, .31, .4 + Math.sin(this.time * 4) * .15]);
      b.transform(pose, () => {
        b.box(-.14, .23 + step, 0, .18, .43, .23, '#374c4d'); b.box(.14, .23 - step, 0, .18, .43, .23, '#374c4d');
        b.box(-.14, .07 + step, -.055, .2, .12, .32, '#263b3d'); b.box(.14, .07 - step, -.055, .2, .12, .32, '#263b3d');
        b.box(0, .84, 0, .58, .77, .34, torso); b.box(0, .55, 0, .59, .08, .35, c.karen ? '#784b42' : '#496f5c');
        b.box(0, .99, -.181, .055, .38, .025, '#e9d6af'); b.box(-.17, 1.04, -.19, .105, .12, .025, '#f0dfbb');
        for (const side of [-1, 1]) {
          const arm = held ? side * .85 : c.flying ? side * .8 : c.karen && c.patience < 0 ? side * .6 + Math.sin(this.time * 7) * .15 : side * .11;
          b.transform(M.mul(M.translate(side * .35, 1.13, 0), M.rz(arm)), () => {
            b.box(0, -.22, 0, .18, .47, .23, torso); b.sphere(0, -.51, -.005, .11, skin, 0, 3, 6);
          });
        }
        b.cylinder(0, 1.28, 0, .10, .18, skin, 8);
        b.sphere(0, 1.52, 0, .255, skin, 0, 6, 10);
        b.box(0, 1.71, .015, .45, .18, .37, hair); b.box(0, 1.57, .13, .46, .26, .2, hair);
        if (c.variant % 2 === 0) { b.box(-.23, 1.55, .01, .1, .33, .27, hair); b.box(.23, 1.55, .01, .1, .33, .27, hair); }
        if (c.variant === 1) b.sphere(0, 1.83, .07, .15, hair, 0, 3, 7);
        for (const side of [-1, 1]) {
          b.box(side * .095, 1.55, -.235, .038, .045, .025, '#3b4034');
          if (c.karen) b.transform(M.mul(M.translate(side * .095, 1.625, -.23), M.rz(side * .32)), () => b.box(0, 0, 0, .10, .026, .022, hair));
        }
        b.box(0, c.karen ? 1.435 : 1.42, -.242, .09, c.karen ? .025 : .014, .016, c.karen ? '#8d503f' : '#9c5f48');
        b.box(0, 1.49, -.26, .054, .048, .035, skin);
        if (c.karen) { b.box(.43, .57, .06, .25, .28, .23, '#d1ad78'); b.ring(.43, .74, .06, .07, .02, '#7b6147', 0); }
        if (c.kind === 'streamer') { b.box(-.43, 1.12, -.20, .15, .28, .04, '#253e43'); b.box(-.43, 1.13, -.226, .12, .22, .012, '#9bcfd0', .8); }
        if (c.kind === 'cutter') b.box(0, 1.78, -.05, .53, .10, .50, '#d8d8b5');
        if (c.kind === 'litterer') b.cylinder(-.40, .70, -.06, .08, .22, '#ecd5a2', 8);
      });
      if (active && !c.flying && !held) {
        const r = c.karen ? .075 : .055, y = c.y + 2.02;
        b.sphere(c.x, y + Math.sin(this.time * 2 + c.id) * .025, c.z, r, c.karen ? '#ff9267' : '#96edbe', 1, 2, 4);
        const bar = new Mesh();
        bar.transform(M.mul(M.translate(c.x, y + .13, c.z), M.ry(world.player.yaw)), () => {
          bar.box(0, 0, 0, .45, .025, .01, '#304a45', .6);
          const value = clamp(c.patience / (c.maxPatience || (c.karen ? 13 : 31)), 0, 1); bar.box(-.22 + value * .22, 0, .008, .44 * value, .025, .012, c.karen ? '#ffad77' : '#a7f2c4', 1);
        }); b.v.push(...bar.v);
      }
    }
    hands(b, world) {
      const p = world.player, bob = this.reduceMotion ? 0 : Math.sin(p.bob) * .018 * p.moving;
      const swing = world.spin ? Math.sin((.85 - world.spin) * 20) * .6 : world.swing ? Math.sin(world.swing / .5 * Math.PI) * .25 : 0;
      const model = M.mul(M.translate(...this.eye), M.mul(M.ry(p.yaw), M.rx(p.pitch)));
      b.transform(model, () => {
        b.transform(M.mul(M.translate(.34 + swing * .3, -.43 + bob, -.71 + swing * .12), M.rz(-.28 + swing)), () => {
          b.box(0, -.1, .08, .17, .40, .19, '#477e67'); b.sphere(0, .12, -.04, .10, '#edc399', 0, 4, 8);
          if (!world.held && !world.shop?.crate) {
            b.cylinder(.02, .26, -.05, .026, .6, '#dcb77b', 8); b.cylinder(.02, .10, -.05, .036, .17, '#365c56', 8);
            b.box(.02, .58, -.05, .34, .07, .12, '#4a847b');
            for (let i = 0; i < 7; i++) b.box(-.13 + i * .047, .66 + (i % 2) * .013, -.05, .028, .12, .11, '#b6d7c4');
          }
        });
        b.transform(M.mul(M.translate(-.40, -.45 + bob, -.65), M.rz(.32 - (world.held ? .25 : 0))), () => {
          b.box(0, -.11, .07, .17, .33, .18, '#477e67'); b.sphere(0, .09, -.03, .10, '#edc399', 0, 4, 8);
        });
        if (world.shop?.crate) {
          b.box(0, -.31, -.91, .68, .39, .43, '#c1a16e'); b.box(0, -.105, -.91, .70, .025, .45, '#e2c38a'); b.box(0, -.087, -.91, .10, .013, .46, '#f0dfb5');
        } else if (world.shop?.inventory.length) {
          const item = world.shop.inventory[0];
          if (item === 'coffee') { b.cylinder(-.43, -.23, -.72, .085, .22, '#dfc695', 10, 0, .10); b.cylinder(-.43, -.11, -.72, .105, .025, '#efe9cf', 10); b.cylinder(-.43, -.22, -.72, .09, .06, '#6e9e80', 10); }
          else if (item === 'meal') { b.box(-.43, -.28, -.73, .31, .09, .22, '#e8e3c5'); b.box(-.43, -.23, -.73, .27, .018, .18, '#c5aa73'); b.box(-.48, -.21, -.73, .10, .018, .13, '#8fa56f'); }
          else { b.box(-.43, -.21, -.73, .17, .26, .08, '#dfaa63'); b.box(-.43, -.19, -.685, .12, .09, .012, '#f6e5b8'); }
        }
      });
    }
    project(x, y, z) {
      const m = this.vp, w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= .05) return null;
      return { x: ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * .5 + .5) * this.width,
        y: (1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w * .5 + .5)) * this.height, w };
    }
    render(world, time) {
      this.time = time; this.power = world.power ?? 1; const gl = this.gl, p = world.player;
      const bob = this.reduceMotion ? 0 : Math.sin(p.bob * 2) * .017 * p.moving;
      const shake = this.reduceMotion ? 0 : world.shake * .022;
      const yaw = p.yaw + Math.sin(time * 89) * shake, pitch = p.pitch + Math.cos(time * 76) * shake;
      this.eye = [p.x, 1.58 + bob, p.z];
      this.vp = M.mul(M.perspective((65 + (p.stamina < 98 && p.moving ? 3 : 0)) * Math.PI / 180, this.canvas.width / this.canvas.height, .045, 75), M.view(...this.eye, yaw, pitch));
      gl.clearColor(.055, .105, .14, 1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.geometry(this.static.buffer, this.static.count);
      const b = new Mesh(), g = new Mesh();
      world.customers.forEach(c => this.character(b, g, c, world));
      if (world.shop) {
        for (const mess of world.shop.messes) {
          g.disc(mess.x, .028, mess.z, .43, [.48, .32, .15, .62]); g.disc(mess.x + .25, .029, mess.z - .16, .19, [.55, .37, .18, .5]);
          b.transform(M.mul(M.translate(mess.x - .2, .034, mess.z + .16), M.ry(mess.phase)), () => b.box(0, 0, 0, .19, .01, .13, '#e2d9b7'));
        }
        for (const s of root.BKShop.STATIONS) {
          g.ring(s.x, .037, s.z, .38, .025, [.69, .93, .75, .35], .8);
          b.sphere(s.x, s.y, s.z, .055, s.id === 'delivery' ? '#f6c382' : '#adf1cb', 1, 2, 4);
        }
        const job = world.shop.job;
        if (job && (job.id === 'coffee' || job.id === 'meal')) for (let i = 0; i < 5; i++) {
          const phase = (time * .5 + i * .17) % 1; g.sphere(job.x + Math.sin(time * 2 + i) * .1, 1.2 + phase * .9, job.z, .035 + phase * .045, [.93, .98, .89, .35 * (1 - phase)], .8, 3, 6);
        }
      }
      for (const p of world.particles) b.transform(M.mul(M.translate(p.x, p.y, p.z), M.rz(p.angle)), () => b.box(0, 0, 0, p.size, p.size * .5, p.size, p.color, .85));
      for (const r of world.rings) { g.ring(r.x, .07 + Math.sin(r.life * 10) * .025, r.z, r.r, .10, [...color(r.color).slice(0, 3), Math.min(.7, r.life)], 1); }
      // Tiny motes drifting under the fluorescent lights.
      if (this.quality !== 'low') for (let i = 0; i < 22; i++) {
        const x = 1.8 + i * 7.13 % 14.2, z = 1 + i * 3.57 % 11.6, y = .9 + (i * .21 + time * .06) % 2.2;
        b.box(x + Math.sin(time * .3 + i) * .12, y, z, .008, .008, .008, '#d4dfbc', .8);
      }
      this.geometry(this.dynamic, b.v.length / 11, b.v);
      gl.depthMask(false); this.geometry(this.glass.buffer, this.glass.count); this.geometry(this.transparentDynamic, g.v.length / 11, g.v);
      this.labels.forEach(l => this.drawLabel(l));
      if (world.shop) for (const s of root.BKShop.STATIONS) if (dist(s, p) < 6.5) {
        const title = s.id === 'shelf' && world.shop.crate ? '▣ 在此補貨' : `${s.icon} ${s.title}${s.key ? ' · ' + world.shop.stock[s.key] : ''}`;
        this.drawLabel({ texture: this.texture(title, { fg: '#f1dfad', bg: '#214e46e8', size: 40 }), x: s.x, y: s.y + .27, z: s.z, w: 1.45, h: .29, yaw: p.yaw });
      }
      const selected = world.target();
      for (const c of world.customers) if (c.state === 'walking' && !c.flying && dist(c, p) < 7 && (c === selected || c.karen && c.patience < 0 && dist(c, p) < 5)) {
        const phrase = c.kind ? `${root.BKShop.TYPES[c.kind].name}：${{ picky: '這也不行！', litterer: '垃圾你撿啦！', cutter: '我要先結！', streamer: '家人們看這裡！' }[c.kind]}` : c.order ? `客人 #${c.id} · ${root.BKShop.ITEMS[c.order].name}` : c.karen ? ['叫店長出來！', '我要免費的！', '去冰不加水！', '這服務不行！'][c.phrase] : '咖啡一杯，謝謝！';
        this.drawLabel({ texture: this.texture(phrase, { fg: c.karen ? '#a9563c' : '#42725e', bg: '#fbf2ddeb', size: 42 }), x: c.x, y: c.y + 2.37, z: c.z, w: 1.62, h: .34, yaw: p.yaw });
      }
      gl.depthMask(true);
      // The first-person arms are a view model and remain visible beside close fixtures.
      if (world.state !== 'ready') {
        gl.clear(gl.DEPTH_BUFFER_BIT); const h = new Mesh(); this.hands(h, world); this.geometry(this.handBuffer, h.v.length / 11, h.v);
      }
    }
  }
  root.BKRenderer = { Renderer, Mesh, M, color };
})(globalThis);
