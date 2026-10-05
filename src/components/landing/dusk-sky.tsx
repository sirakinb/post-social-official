"use client";

import { useEffect, useRef, useState } from "react";

/* Dusk sky: a living layer over the painted lake. Warm mist along the horizon, twinkling
   stars up high, and a slow stream of faint lanterns rising through the sky. Drawn
   additively (mix-blend-mode: screen) so the painting underneath stays the picture.
   Ported from the Manor hero sky: raw WebGL, one fullscreen triangle, one shader. */

const VERTEX = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_t;
uniform float u_glow;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float amp = 0.5;
  for (int i = 0; i < 4; i++) { v += amp * noise(p); p = p * 2.03 + vec2(17.0, 9.0); amp *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = uv * vec2(aspect, 1.0);
  float t = u_t * 0.045;

  /* warm mist hugging the horizon (about 40% up the frame) */
  float m1 = fbm(p * 1.4 + vec2(t * 0.8, -t * 0.2));
  float m2 = fbm(p * 2.2 - vec2(t * 0.4, t * 0.5) + 3.1);
  float mist = smoothstep(0.3, 0.8, m1 * 0.62 + m2 * 0.5);
  float band = exp(-pow((uv.y - 0.44) / 0.13, 2.0));
  vec3 amber = vec3(1.0, 0.62, 0.32);
  vec3 rose = vec3(0.86, 0.5, 0.78);
  vec3 color = mix(rose, amber, mist) * mist * band * 0.5 * u_glow;

  /* stars, upper sky only */
  vec2 g = p * 60.0;
  vec2 cell = floor(g);
  float h = hash(cell);
  vec2 center = cell + 0.5 + (vec2(hash(cell + 1.3), hash(cell + 7.9)) - 0.5) * 0.7;
  float twinkle = 0.55 + 0.45 * sin(u_t * (0.8 + h * 1.6) + h * 40.0);
  float star = (h > 0.962 ? 1.0 : 0.0) * smoothstep(0.13, 0.0, length(g - center)) * twinkle;
  color += vec3(1.0, 0.95, 0.9) * star * smoothstep(0.62, 0.95, uv.y);

  /* rising lanterns: a sparse grid that scrolls upward; each lit cell sways and flickers */
  vec2 lg = vec2(p.x * 14.0, uv.y * 9.0 - u_t * 0.05);
  vec2 lc = floor(lg);
  float lh = hash(lc + 4.2);
  float sway = 0.18 * sin(u_t * 0.6 + lh * 30.0);
  vec2 lpos = lc + vec2(0.5 + (hash(lc + 2.7) - 0.5) * 0.6 + sway, 0.5);
  vec2 ld = (lg - lpos) * vec2(1.0, 1.5);
  float flicker = 0.75 + 0.25 * sin(u_t * (2.0 + lh * 3.0) + lh * 17.0);
  float lit = lh > 0.93 ? 1.0 : 0.0;
  float core = smoothstep(0.045, 0.0, length(ld));
  float halo = smoothstep(0.18, 0.0, length(ld)) * 0.12;
  float skyMask = smoothstep(0.46, 0.56, uv.y) * (1.0 - smoothstep(0.85, 1.0, uv.y));
  color += vec3(1.0, 0.7, 0.4) * (core + halo) * lit * flicker * skyMask * u_glow;

  gl_FragColor = vec4(color, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("dusk sky shader", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Additive animated layer for the landing hero. Renders nothing when WebGL is missing or
 * the visitor prefers reduced motion, so the painting underneath is always the fallback.
 */
export function DuskSky({ glow = 0.9, className }: { glow?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (program) gl.deleteProgram(program);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("dusk sky link", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "u_res");
    const uT = gl.getUniformLocation(program, "u_t");
    gl.uniform1f(gl.getUniformLocation(program, "u_glow"), glow);

    let frame = 0;
    let painted = false;
    let visible = true;
    let last = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
    };
    const started = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || now - last < 1000 / 30) return;
      last = now;
      resize();
      gl.uniform1f(uT, (now - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!painted && !gl.isContextLost()) {
        painted = true;
        setReady(true);
      }
    };
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          })
        : null;
    observer?.observe(canvas);
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
    };
    const onContextLost = () => {
      cancelAnimationFrame(frame);
      setReady(false);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      // StrictMode reuses this canvas on its next setup; keep its context alive.
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [glow]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ visibility: ready ? "visible" : "hidden" }} />;
}
