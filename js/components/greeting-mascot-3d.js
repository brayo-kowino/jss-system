export const GREETING_DURATION_MS = 6800;

const vertexSource = `
  attribute vec3 position;
  attribute vec3 normal;
  uniform mat4 model;
  uniform vec3 size;
  uniform vec2 projection;
  varying vec3 surfaceNormal;
  varying vec3 localPosition;

  void main() {
    vec3 point = (model * vec4(position * size, 1.0)).xyz;
    surfaceNormal = mat3(model) * (normal / size);
    localPosition = position;
    gl_Position = vec4(point.x * projection.x, (point.y - 1.61) * projection.y, -point.z * 0.18, 1.0);
  }
`;

const fragmentSource = `
  precision mediump float;
  uniform vec4 material;
  varying vec3 surfaceNormal;
  varying vec3 localPosition;

  void main() {
    if (material.a < 1.0) {
      float radius = length(localPosition.xz);
      float opacity = (1.0 - smoothstep(0.12, 1.0, radius)) * material.a;
      gl_FragColor = vec4(material.rgb * opacity, opacity);
      return;
    }
    vec3 n = normalize(surfaceNormal);
    vec3 key = normalize(vec3(-0.55, 0.8, 1.0));
    float diffuse = max(dot(n, key), 0.0);
    float fill = max(dot(n, normalize(vec3(0.8, 0.2, -0.5))), 0.0);
    float shine = pow(max(dot(n, normalize(key + vec3(0.0, 0.0, 1.0))), 0.0), 32.0);
    gl_FragColor = vec4(material.rgb * (0.62 + 0.48 * diffuse + 0.14 * fill) + 0.14 * shine, 1.0);
  }
`;

const TAU = Math.PI * 2;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// Frames contain rotations and translations only. Mesh proportions are applied
// in the shader so scaled surfaces retain correct lighting.
function frame(parent, [x, y, z], [pitch, yaw, roll] = [0, 0, 0]) {
  const sx = Math.sin(pitch), cx = Math.cos(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sz = Math.sin(roll), cz = Math.cos(roll);
  const local = [
    cz * cy, sz * cy, -sy,
    cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx,
    cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx,
    x, y, z,
  ];
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    const index = column * 3;
    for (let row = 0; row < 3; row++) {
      result[column * 4 + row] = parent[row] * local[index]
        + parent[4 + row] * local[index + 1]
        + parent[8 + row] * local[index + 2]
        + (column === 3 ? parent[12 + row] : 0);
    }
  }
  result[15] = 1;
  return result;
}

function addQuad(vertices, corners, normals) {
  for (const index of [0, 1, 2, 0, 2, 3]) {
    vertices.push(...corners[index], ...normals[index]);
  }
}

function sphereVertices() {
  const vertices = [];
  const rings = 12;
  const slices = 20;
  function surface(ring, slice) {
    const latitude = Math.PI * ring / rings;
    const longitude = TAU * slice / slices;
    return [Math.sin(latitude) * Math.cos(longitude), Math.cos(latitude), Math.sin(latitude) * Math.sin(longitude)];
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let slice = 0; slice < slices; slice++) {
      const corners = [surface(ring, slice), surface(ring + 1, slice), surface(ring + 1, slice + 1), surface(ring, slice + 1)];
      addQuad(vertices, corners, corners);
    }
  }
  return vertices;
}

function boxVertices() {
  const vertices = [];
  for (const axis of [0, 1, 2]) {
    for (const side of [-1, 1]) {
      const normal = [0, 0, 0];
      normal[axis] = side;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const p = [...normal];
        p[(axis + 1) % 3] = a;
        p[(axis + 2) % 3] = b;
        return p;
      });
      addQuad(vertices, corners, [normal, normal, normal, normal]);
    }
  }
  return vertices;
}

function faceDepth(x, y) {
  return 0.48 * Math.sqrt(1 - (x / 0.56) ** 2 - (y / 0.59) ** 2);
}

// Both surfaces curve along the front of the head, including during a turn.
function facePatch(outline, center, offset) {
  const vertices = [];
  for (let index = 0; index < outline.length; index++) {
    for (const [x, y] of [center, outline[index], outline[(index + 1) % outline.length]]) {
      const z = faceDepth(x, y);
      vertices.push(x, y, z + offset, x / 0.56 ** 2, y / 0.59 ** 2, z / 0.48 ** 2);
    }
  }
  return vertices;
}

function rgba(hex, fallback = "#14538A") {
  const color = /^#[\da-f]{6}$/i.test(hex) ? hex : fallback;
  const number = Number.parseInt(color.slice(1), 16);
  return [(number >> 16) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, 1];
}

function smooth(start, end, time) {
  const t = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function pulse(start, end, time) {
  const t = (time - start) / (end - start);
  return t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
}

function makeProgram(gl) {
  const program = gl.createProgram();
  if (!program) return null;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    if (!shader) break;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

function renderScholar(draw, colors, time, period) {
  const { robe, navy, gold, goldLight, skin, blush, white, iris, tongue } = colors;
  const energy = period === "morning" ? 1.12 : period === "evening" ? 0.77 : 1;
  const hop = energy * (0.34 * pulse(1.03, 1.61, time) + 0.26 * pulse(2.09, 2.63, time));
  const bend = 0.14 * (pulse(0.76, 1.03, time) + pulse(1.59, 1.82, time)
    + pulse(1.84, 2.09, time) + pulse(2.61, 2.84, time));
  const bow = 0.23 * pulse(5.1, 6.28, time);
  const wave = smooth(0.42, 0.95, time) * (1 - smooth(4.68, 5.22, time));
  const sway = Math.sin(time * 3.4) * (0.05 + 0.1 * wave);
  const view = frame(IDENTITY, [0, 0, 0], [0.19, 0, 0]);
  const root = frame(view, [sway, hop, 0], [0, -0.19 + 0.35 * wave, 0]);
  const torso = frame(root, [0, 1.18 - bend, 0], [bow, 0, -0.45 * sway]);

  function shape(mesh, parent, center, size, color, angles) {
    draw(mesh, frame(parent, center, angles), size, color);
  }

  function between(parent, a, b, thickness, color) {
    const delta = b.map((value, index) => value - a[index]);
    const length = Math.hypot(...delta);
    const center = a.map((value, index) => (value + b[index]) / 2);
    const pitch = Math.asin(delta[2] / length);
    const roll = Math.atan2(-delta[0], delta[1]);
    shape("sphere", parent, center, [thickness, length / 2 + thickness * 0.55, thickness], color, [pitch, 0, roll]);
  }

  draw("shadow", view, [0.84 - hop * 0.45, 1, 0.63], [0.05, 0.10, 0.16, 0.28 - hop * 0.4]);

  for (const side of [-1, 1]) {
    const x = side * 0.235;
    const knee = [x + side * bend * 0.75, 0.57 - bend * 0.42, 0.07 + bend * 1.4];
    const ankle = [side * 0.28, 0.22, 0.01];
    between(root, [x, 1.11 - bend, 0], knee, 0.129, navy);
    between(root, knee, ankle, 0.115, navy);
    const foot = frame(root, [ankle[0], 0, 0.15], [0, side * 0.18, 0]);
    shape("sphere", foot, [0, 0.071, 0.027], [0.181, 0.068, 0.275], navy);
    shape("sphere", foot, [0, 0.147, 0.01], [0.174, 0.116, 0.259], robe);
  }

  shape("sphere", torso, [0, 0.12, -0.037], [0.526, 0.477, 0.326], robe);
  shape("sphere", torso, [0, 0.37, 0.015], [0.451, 0.418, 0.319], robe);
  for (const side of [-1, 1]) {
    between(torso, [side * 0.241, 0.56, 0.259], [0, 0.095, 0.313], 0.049, gold);

    const raisingHand = side === 1 ? wave : 0;
    const shoulder = frame(torso, [side * 0.386, 0.429, 0], [
      -0.05 - raisingHand * 0.25, 0, side * (0.24 + raisingHand * 1.24 + hop * 0.45),
    ]);
    const elbow = frame(shoulder, [0, -0.41, 0], [
      -0.28, 0, side * (0.09 + raisingHand * (1.49 + 0.36 * Math.sin(time * TAU * 1.4))),
    ]);
    shape("sphere", shoulder, [0, -0.178, 0], [0.15, 0.286, 0.148], robe);
    shape("sphere", elbow, [0, -0.123, 0], [0.128, 0.236, 0.132], robe);
    shape("sphere", elbow, [0, -0.276, 0], [0.115, 0.068, 0.119], gold);
    shape("sphere", elbow, [0, -0.368, 0.018], [0.109, 0.137, 0.082], skin);
    shape("sphere", elbow, [-side * 0.089, -0.353, 0.051], [0.054, 0.079, 0.048], skin, [0, 0, -side * 0.42]);
  }

  shape("sphere", torso, [0, 0.693, 0], [0.199, 0.179, 0.19], skin);
  const head = frame(torso, [0, 1.065, 0.013], [0.1 * bow, 0.09 * Math.sin(time * 2.4), -0.11 * wave + 0.08 * Math.sin(time * 3.4)]);
  shape("sphere", head, [0, 0, 0], [0.56, 0.59, 0.48], skin);

  const blink = 1 - 0.93 * Math.max(pulse(0.78, 0.96, time), pulse(3.05, 3.25, time), pulse(5.55, 5.79, time));
  for (const side of [-1, 1]) {
    const x = side * 0.194;
    const eye = frame(head, [x, 0.079, 0.44], [0, side * 0.15, 0]);
    shape("sphere", eye, [0, 0, 0], [0.135, 0.163 * blink, 0.059], white);
    shape("sphere", eye, [-side * 0.009, 0.005 * blink, 0.051], [0.083, 0.103 * blink, 0.026], iris);
    shape("sphere", eye, [-side * 0.009, 0.005 * blink, 0.071], [0.055, 0.075 * blink, 0.016], navy);
    shape("sphere", eye, [-0.031, 0.048 * blink, 0.084], [0.024, 0.026 * blink, 0.01], white);
    between(head, [side * 0.113, 0.303, 0.426], [side * 0.265, 0.307, 0.379], 0.026, navy);
    const cheekX = side * 0.316;
    shape("sphere", head, [cheekX, -0.125, faceDepth(cheekX, -0.125) + 0.006], [0.091, 0.042, 0.026], blush, [0, side * 0.29, 0]);
  }
  shape("sphere", head, [0, -0.073, 0.477], [0.074, 0.053, 0.066], skin);
  draw("mouth", head, [1, 1, 1], navy);
  draw("tongue", head, [1, 1, 1], tongue);
  draw("teeth", head, [1, 1, 1], white);

  const cap = frame(head, [0, 0.521, -0.032], [0.04, 0, -0.1]);
  shape("sphere", cap, [0, 0.004, 0], [0.389, 0.153, 0.328], navy);
  shape("box", cap, [0, 0.125, 0], [0.481, 0.034, 0.481], gold, [0, Math.PI / 4, 0]);
  shape("sphere", cap, [0, 0.163, 0.016], [0.06, 0.018, 0.06], goldLight);
  const tasselTip = [0.59 + 0.09 * Math.sin(time * 8.2) * wave, -0.17, 0.12 + 0.08 * wave];
  between(cap, [0.014, 0.163, 0.016], [0.546, 0.157, 0.104], 0.018, goldLight);
  between(cap, [0.546, 0.157, 0.104], tasselTip, 0.019, goldLight);
  shape("sphere", cap, tasselTip, [0.048, 0.091, 0.042], gold, [0, 0, -sway]);
}

export function animateGreetingMascot(canvas, { primary, accent, period, onContextLost }) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" });
  if (!gl) return null;
  const program = makeProgram(gl);
  const buffer = gl.createBuffer();
  if (!program || !buffer) {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    return null;
  }

  const vertices = [];
  const meshes = new Map();
  function mesh(name, data) {
    meshes.set(name, [vertices.length / 6, data.length / 6]);
    vertices.push(...data);
  }
  mesh("sphere", sphereVertices());
  mesh("box", boxVertices());
  const floor = [];
  addQuad(floor, [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]], Array(4).fill([0, 1, 0]));
  mesh("shadow", floor);
  mesh("mouth", facePatch([[-0.215, -0.148], [-0.115, -0.173], [0, -0.18], [0.115, -0.173], [0.215, -0.148],
    [0.174, -0.251], [0.1, -0.304], [0, -0.323], [-0.1, -0.304], [-0.174, -0.251]], [0, -0.249], 0.016));
  mesh("teeth", facePatch([[-0.173, -0.166], [0, -0.181], [0.173, -0.166], [0.12, -0.217], [0, -0.223], [-0.12, -0.217]], [0, -0.2], 0.023));
  mesh("tongue", facePatch([[-0.094, -0.297], [-0.069, -0.272], [0, -0.267], [0.069, -0.272], [0.094, -0.297], [0, -0.319]], [0, -0.292], 0.023));

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  for (const [attribute, offset] of [["position", 0], ["normal", 12]]) {
    const location = gl.getAttribLocation(program, attribute);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 24, offset);
    gl.enableVertexAttribArray(location);
  }
  const projection = gl.getUniformLocation(program, "projection");
  const model = gl.getUniformLocation(program, "model");
  const size = gl.getUniformLocation(program, "size");
  const material = gl.getUniformLocation(program, "material");

  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const colors = {
    robe: rgba(primary),
    navy: rgba("#172741"),
    gold: rgba(accent, "#D8AC38"),
    goldLight: rgba("#FFE2A1"),
    skin: rgba("#F1D3AD"),
    blush: rgba("#E89C87"),
    white: rgba("#FFFDF6"),
    iris: rgba("#416F99"),
    tongue: rgba("#D87573"),
  };
  function draw(name, transform, dimensions, tint) {
    const [start, count] = meshes.get(name);
    gl.uniformMatrix4fv(model, false, transform);
    gl.uniform3fv(size, dimensions);
    gl.uniform4fv(material, tint);
    gl.depthMask(name !== "shadow");
    gl.drawArrays(gl.TRIANGLES, start, count);
  }

  const startedAt = performance.now();
  let animationFrame;
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(animationFrame);
    canvas.removeEventListener("webglcontextlost", lost);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  }
  function lost() {
    stop();
    onContextLost?.();
  }
  function tick(now) {
    if (!canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) {
      stop();
      return;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(projection, 0.548 * height / width, 0.548);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const elapsed = Math.min(now - startedAt, GREETING_DURATION_MS);
    renderScholar(draw, colors, elapsed / 1000, period);
    if (elapsed < GREETING_DURATION_MS) animationFrame = requestAnimationFrame(tick);
    else stop();
  }
  canvas.addEventListener("webglcontextlost", lost, { once: true });
  tick(startedAt);
  return stop;
}
