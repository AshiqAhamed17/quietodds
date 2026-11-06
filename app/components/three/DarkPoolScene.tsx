"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/// Evenly-distributed points on a sphere (Fibonacci), with slight radial jitter
/// so it reads as a cloud, not a shell.
function spherePoints(n: number, radius: number): Float32Array {
  const arr = new Float32Array(n * 3);
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const rad = radius * (0.82 + Math.random() * 0.18);
    arr[i * 3] = Math.cos(theta) * r * rad;
    arr[i * 3 + 1] = y * rad;
    arr[i * 3 + 2] = Math.sin(theta) * r * rad;
  }
  return arr;
}

/// Random points in a large box — a faint backdrop starfield for depth.
function starField(n: number, spread: number): Float32Array {
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (Math.random() - 0.5) * spread;
    arr[i * 3 + 1] = (Math.random() - 0.5) * spread;
    arr[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  return arr;
}

function progress(): number {
  if (typeof window === "undefined") return 0;
  return Math.min(1, window.scrollY / (window.innerHeight * 0.9));
}

/// Where each sphere point settles: a thin, level ring (the pool's surface).
function ringPoints(from: Float32Array, radius: number): Float32Array {
  const n = from.length / 3;
  const arr = new Float32Array(from.length);
  for (let i = 0; i < n; i++) {
    const angle = Math.atan2(from[i * 3 + 2], from[i * 3]);
    const r = radius * (0.97 + Math.random() * 0.06);
    arr[i * 3] = Math.cos(angle) * r;
    arr[i * 3 + 1] = (Math.random() - 0.5) * 0.04;
    arr[i * 3 + 2] = Math.sin(angle) * r;
  }
  return arr;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/// The hero's one moment of motion: a noisy cloud of points (many bets) that,
/// as you scroll, settles into a single level ring (one quiet pool) and dims.
/// No scaling, no camera dive: the points move to fixed destinations.
function Scene() {
  const pool = useRef<THREE.Points>(null);
  const poolMat = useRef<THREE.PointsMaterial>(null);
  const stars = useRef<THREE.Points>(null);
  const lastP = useRef(-1);

  const sphere = useMemo(() => spherePoints(3600, 2.3), []);
  const ring = useMemo(() => ringPoints(sphere, 2.7), [sphere]);
  const live = useMemo(() => sphere.slice(), [sphere]);
  const starPos = useMemo(() => starField(900, 28), []);
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useFrame((_, dt) => {
    const p = progress();
    const pts = pool.current;
    if (pts) {
      if (!reduce) pts.rotation.y += dt * 0.035;
      // Tilt toward the viewer as it settles, so the ring reads as a surface.
      pts.rotation.x = THREE.MathUtils.lerp(0, 0.42, ease(p));
      if (Math.abs(p - lastP.current) > 0.001) {
        lastP.current = p;
        const t = ease(p);
        for (let i = 0; i < live.length; i++) live[i] = sphere[i] + (ring[i] - sphere[i]) * t;
        const attr = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
        attr.needsUpdate = true;
      }
    }
    if (poolMat.current) poolMat.current.opacity = 0.92 - 0.5 * ease(p);
    if (stars.current && !reduce) stars.current.rotation.y += dt * 0.006;
  });

  return (
    <group>
      <points ref={stars}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[starPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.026}
          sizeAttenuation
          transparent
          opacity={0.28}
          depthWrite={false}
          color={new THREE.Color(0.72, 0.78, 0.95)}
        />
      </points>

      <points ref={pool}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[live, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={poolMat}
          size={0.02}
          sizeAttenuation
          transparent
          opacity={0.92}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color={new THREE.Color(0.62, 0.72, 1)}
        />
      </points>
    </group>
  );
}

export function DarkPoolScene() {
  return (
    <Canvas
      className="darkpool"
      camera={{ position: [0, 0, 5], fov: 62 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
    >
      <Scene />
    </Canvas>
  );
}
