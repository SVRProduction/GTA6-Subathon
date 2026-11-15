// מים חיים: שכבת WebGL דקה מעל המפה שמציירת רק נצנוץ ואדוות, ורק איפה שיש ים.
// כל פיקסל במסך מתורגם חזרה לנקודה במפה (אותה מתמטיקה של world.ts, הפוך), כך שהגלים "דבוקים" למים
// גם כשהמפה מוטה, זזה או מתקרבת. המפה עצמה לא משתנה.

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 res;      // גודל הקנבס בפיקסלים
uniform float dpr;     // פיקסלי קנבס לכל פיקסל CSS
uniform vec3 cam;      // x, y (פיקסלי מפה), z (זום)
uniform float tilt, P, time;
uniform vec2 mapSize;
uniform sampler2D mask, noise;
void main() {
  vec2 s = vec2(gl_FragCoord.x - res.x * 0.5, res.y * 0.5 - gl_FragCoord.y) / dpr; // מהמרכז, y למטה
  float ca = cos(tilt), sa = sin(tilt);
  float den = P * ca + s.y * sa;
  if (den < 1.0) { gl_FragColor = vec4(0.0); return; } // מעל האופק
  float Y = s.y * P / den;
  float sc = P / (P - Y * sa);
  vec2 p = cam.xy + vec2(s.x / sc, Y) / cam.z; // נקודה במפה
  vec2 uv = p / mapSize;
  float sea = 1.0, shallow = 0.0;
  if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
    vec4 m = texture2D(mask, uv);
    sea = m.r; shallow = m.g;
  }
  if (sea < 0.02) { gl_FragColor = vec4(0.0); return; }
  float t = time;
  // שתי שכבות גלים שנעות בכיוונים שונים: ההתאבכות ביניהן נראית כמו אדוות ולא כמו תבנית שזזה
  float n1 = texture2D(noise, p / 430.0 + vec2(t * 0.011, t * 0.006)).r;
  float n2 = texture2D(noise, mat2(0.8, -0.6, 0.6, 0.8) * p / 270.0 + vec2(-t * 0.008, t * 0.012)).r;
  float n3 = texture2D(noise, p / 95.0 + vec2(t * 0.021, -t * 0.016)).g;
  float h = (n1 + n2) * 0.5;
  float glint = smoothstep(0.54, 0.76, h) * (0.55 + 0.45 * n3);
  float trough = smoothstep(0.46, 0.33, h);
  float light = glint * (0.06 + 0.13 * shallow);
  // קצף בקו החוף: פס דק שנושם פנימה והחוצה
  float shore = smoothstep(0.08, 0.5, sea) * (1.0 - smoothstep(0.5, 0.97, sea));
  light += shore * (0.10 + 0.14 * sin(t * 0.9 + n1 * 14.0)) * step(0.0, uv.x) * step(uv.x, 1.0);
  float dark = trough * 0.07;
  // רחוק (באופק, או במבט על כל המפה) הגלים קטנים מפיקסל: מחלישים במקום להבהב
  float px = cam.z * sc;
  float fade = smoothstep(0.1, 0.45, px) * sea;
  gl_FragColor = vec4(vec3(light), light + dark) * fade; // premultiplied: לבן לנצנוץ, שחור שקוף לשקעים
}`;

/** רעש חלק שמתחבר בקצוות (כמה אוקטבות), בשני ערוצים */
function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let ch = 0; ch < 2; ch++) {
    const acc = new Float32Array(size * size);
    let amp = 1;
    let tot = 0;
    for (let n = 8; n <= 64; n *= 2) {
      const g = new Float32Array(n * n).map(rnd);
      const at = (x: number, y: number) => g[((y + n) % n) * n + ((x + n) % n)];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * n;
          const fy = (y / size) * n;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          let tx = fx - x0;
          let ty = fy - y0;
          tx = tx * tx * (3 - 2 * tx);
          ty = ty * ty * (3 - 2 * ty);
          const v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
          acc[y * size + x] += v * amp;
        }
      }
      tot += amp;
      amp *= 0.55;
    }
    for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = Math.round((acc[i] / tot) * 255);
  }
  return data;
}

export interface Water {
  /** cam ו-tilt כמו ב-world.ts; time בשניות */
  render(cam: { x: number; y: number; z: number }, tiltDeg: number, persp: number, vw: number, vh: number, mapW: number, mapH: number, time: number): void;
  show(on: boolean): void;
}

export function createWater(after: HTMLElement, maskUrl: string, lite: boolean): Water | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'water';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = { res: u('res'), dpr: u('dpr'), cam: u('cam'), tilt: u('tilt'), P: u('P'), time: u('time'), mapSize: u('mapSize') };

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseTexture());
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.uniform1i(u('noise'), 1);

  let ready = false;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(u('mask'), 0);
    ready = true;
    canvas.classList.add('is-on');
  };
  img.src = maskUrl;
  after.after(canvas);

  const scale = Math.min(devicePixelRatio, lite ? 1 : 1.5);
  let cw = 0;
  let ch = 0;
  return {
    show(on) {
      canvas.hidden = !on;
    },
    render(cam, tiltDeg, persp, vw, vh, mapW, mapH, time) {
      if (!ready || canvas.hidden) return;
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);
      if (w !== cw || h !== ch) {
        canvas.width = cw = w;
        canvas.height = ch = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(U.res, w, h);
      gl.uniform1f(U.dpr, scale);
      gl.uniform3f(U.cam, cam.x, cam.y, cam.z);
      gl.uniform1f(U.tilt, (tiltDeg * Math.PI) / 180);
      gl.uniform1f(U.P, persp);
      gl.uniform1f(U.time, time);
      gl.uniform2f(U.mapSize, mapW, mapH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
