"use client";

// The real 3D migration-yard scene (react-three-fiber). Loaded client-only by
// FlowScene. Everything is procedural — no external GLB assets — so it stays in
// the repo and matches the mock's flat low-poly look:
//   • Uniform bevelled Platform primitive for all five zones (consistent
//     thickness), each with its name "printed" on the front-facing wall via a
//     CanvasTexture.
//   • Conveyor belts as real geometry docked edge-to-edge between platforms,
//     with a scrolling chevron texture.
//   • Unit blocks coloured by batch, lerped between zones by status; a floating
//     badge + the zone they sit in carry status. Gate lamp + PR glow react to
//     the campaign's live state.
//   • Low-poly workers on the bench swinging hammers.
// prefers-reduced-motion snaps blocks to place and stills the idle animation.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html, OrthographicCamera, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Unit, UnitStatus } from "@/lib/types";
import type { Batch } from "@/lib/batches";
import { batchForUnit, isBlockedStatus } from "@/lib/batches";
import type { FlowSceneProps } from "./FlowScene";

// ---- palette (from foreman.css tokens) ---------------------------------------
const COL = {
  platform: "#E5DCC9",
  platformDark: "#D8CCB5",
  belt: "#EDE7DB",
  ink: "#4A4136",
  ok: "#7C9463",
  run: "#3D362D",
  retry: "#B8894F",
  fail: "#B15D48",
  queued: "#8A8072",
  worker: "#6E6152",
  hammer: "#3D362D",
};

// ---- layout (world units) ----------------------------------------------------
const H = 0.7; // uniform platform thickness — every zone shares it
type Zone = { x: number; z: number; w: number; d: number; label: string };
const YARD: Zone = { x: -9.5, z: 0, w: 4.2, d: 4.2, label: "Yard" };
const BENCH: Zone = { x: -2.5, z: 0, w: 4.2, d: 3.4, label: "Build bench" };
const DOCK: Zone = { x: 6.6, z: 0, w: 4.4, d: 4.2, label: "Shipping" };
const PR: Zone = { x: 11.6, z: 0, w: 2.6, d: 2.6, label: "PR" };
const SIDING: Zone = { x: -2.5, z: 5.4, w: 4.4, d: 2.6, label: "Review siding" };

const BLOCK = 0.72; // unit block edge

// ---- status → visual bucket --------------------------------------------------
type VS = "queued" | "run" | "retry" | "ok" | "fail";
function visualStatus(status: UnitStatus): VS {
  if (status === "passed") return "ok";
  if (status === "running") return "run";
  if (status === "retrying" || status === "failed") return "retry";
  if (status === "escalated" || isBlockedStatus(status)) return "fail";
  return "queued";
}

// ---- CanvasTexture helpers ---------------------------------------------------
function labelTexture(text: string): THREE.CanvasTexture {
  const h = 96;
  const font = "800 60px Inter, system-ui, sans-serif";
  const spacing = 7;
  const letters = text.toUpperCase().split("");
  // measure first (offscreen) to size the canvas to the text
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const widths = letters.map((l) => measure.measureText(l).width);
  const textW = widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1);
  const w = Math.ceil(textW) + 48;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#2E2820";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font;
  let x = (w - textW) / 2;
  for (let i = 0; i < letters.length; i++) {
    ctx.fillText(letters[i], x + widths[i] / 2, h / 2 + 2);
    x += widths[i] + spacing;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function chevronTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  // opaque belt surface so a single ribbon reads as "belt + chevron"
  ctx.fillStyle = COL.belt;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "#CDBFA6";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(14, 14);
  ctx.lineTo(46, 32);
  ctx.lineTo(14, 50);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function glyphTexture(glyph: string, color: string): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#FFFEFC";
  ctx.lineWidth = 8;
  ctx.stroke();
  if (glyph) {
    ctx.fillStyle = "#FFFEFC";
    ctx.font = "700 74px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, s / 2, s / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// ---- Platform + wall label ---------------------------------------------------
function WallLabel({ text, width, depth }: { text: string; width: number; depth: number }) {
  const tex = useMemo(() => labelTexture(text), [text]);
  useEffect(() => () => tex.dispose(), [tex]);
  const img = tex.image as HTMLCanvasElement;
  const aspect = img.width / img.height;
  // fixed cap-height that reads on the short (H-tall) front wall; long labels
  // widen at the same height, and shrink only if they'd overrun the wall width.
  let planeH = 0.34;
  let planeW = planeH * aspect;
  const maxW = width * 0.9;
  if (planeW > maxW) {
    planeW = maxW;
    planeH = planeW / aspect;
  }
  return (
    <mesh position={[0, H * 0.5, depth / 2 + 0.02]}>
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function Platform({ zone, tint = COL.platform, children }: { zone: Zone; tint?: string; children?: ReactNode }) {
  return (
    <group position={[zone.x, 0, zone.z]}>
      <RoundedBox args={[zone.w, H, zone.d]} radius={0.07} smoothness={3} position={[0, H / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={tint} roughness={0.92} metalness={0} />
      </RoundedBox>
      <WallLabel text={zone.label} width={zone.w} depth={zone.d} />
      {children}
    </group>
  );
}

// ---- Conveyor belt (ribbon following a ground curve) -------------------------
// `points` are [x, z] control points. The belt is a flat ribbon lofted along a
// Catmull–Rom curve through them, so two points give a straight run and three+
// give a smooth turn (the review loop sweeps around instead of cutting a hard
// diagonal). Chevrons are baked into the surface texture and scroll along the
// curve in the flow direction.
const BELT_HALF = 0.7;
const BELT_Y = 0.16;

function Belt({ points }: { points: [number, number][] }) {
  const tex = useMemo(() => chevronTexture(), []);
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      "catmullrom",
      0.5
    );
    const n = Math.max(24, (points.length - 1) * 24);
    const pts = curve.getPoints(n);
    const up = new THREE.Vector3(0, 1, 0);
    const pos: number[] = [];
    const uv: number[] = [];
    const side = new THREE.Vector3();
    const tan = new THREE.Vector3();
    let acc = 0;
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      if (i > 0) acc += p.distanceTo(pts[i - 1]);
      tan.copy(curve.getTangent(i / n));
      tan.y = 0;
      tan.normalize();
      side.crossVectors(up, tan).normalize().multiplyScalar(BELT_HALF);
      pos.push(p.x - side.x, BELT_Y, p.z - side.z);
      pos.push(p.x + side.x, BELT_Y, p.z + side.z);
      const u = acc / (BELT_HALF * 2);
      uv.push(u, 0);
      uv.push(u, 1);
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame((_, dt) => {
    tex.offset.x -= dt * 0.55;
  });
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial map={tex} roughness={1} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---- Worker (procedural low-poly, swinging a hammer) -------------------------
// The hammer arm pivots at the shoulder and reaches out along local +z, so a
// worker placed just behind the bench blocks (facing +z, toward the camera)
// swings the hammer down onto them.
function Worker({ position, phase, active }: { position: [number, number, number]; phase: number; active: boolean }) {
  const armRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!armRef.current) return;
    const t = state.clock.elapsedTime * (active ? 6 : 1.4) + phase;
    // fast down-swing, slower lift → hammering feel; raise high, strike low
    const swing = active ? Math.max(0, Math.sin(t)) ** 0.6 : 0.2 + 0.12 * Math.sin(t);
    // swing 0 → arm raised (tip up, -z-ward), swing 1 → strike down onto the block
    armRef.current.rotation.x = -0.7 + swing * 1.7;
  });
  return (
    <group position={position}>
      {/* legs */}
      <mesh position={[-0.12, 0.22, 0]} castShadow>
        <boxGeometry args={[0.16, 0.44, 0.18]} />
        <meshStandardMaterial color={COL.worker} roughness={0.9} />
      </mesh>
      <mesh position={[0.12, 0.22, 0]} castShadow>
        <boxGeometry args={[0.16, 0.44, 0.18]} />
        <meshStandardMaterial color={COL.worker} roughness={0.9} />
      </mesh>
      {/* torso */}
      <mesh position={[0, 0.66, 0]} castShadow>
        <boxGeometry args={[0.42, 0.5, 0.26]} />
        <meshStandardMaterial color={COL.retry} roughness={0.85} />
      </mesh>
      {/* head + hard hat */}
      <mesh position={[0, 1.02, 0]} castShadow>
        <boxGeometry args={[0.24, 0.24, 0.24]} />
        <meshStandardMaterial color="#C9B79C" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <boxGeometry args={[0.3, 0.1, 0.3]} />
        <meshStandardMaterial color={COL.retry} roughness={0.7} />
      </mesh>
      {/* hammer arm — pivots at the shoulder */}
      <group position={[0.24, 0.88, 0.05]} ref={armRef}>
        <mesh position={[0, -0.18, 0.12]} castShadow>
          <boxGeometry args={[0.12, 0.12, 0.5]} />
          <meshStandardMaterial color={COL.worker} roughness={0.9} />
        </mesh>
        {/* hammer handle + head at the end of the arm */}
        <mesh position={[0, -0.18, 0.42]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.5, 8]} />
          <meshStandardMaterial color="#8A6A44" roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.18, 0.66]} castShadow>
          <boxGeometry args={[0.14, 0.16, 0.28]} />
          <meshStandardMaterial color={COL.hammer} roughness={0.6} metalness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

// ---- Unit block --------------------------------------------------------------
interface BlockProps {
  target: THREE.Vector3;
  color: string;
  vs: VS;
  label: string;
  reduced: boolean;
  onActivate: () => void;
}
function Block({ target, color, vs, label, reduced, onActivate }: BlockProps) {
  const ref = useRef<THREE.Group>(null);
  const placed = useRef(false);
  const [hover, setHover] = useState(false);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (!placed.current || reduced) {
      g.position.copy(target);
      placed.current = true;
    } else {
      g.position.lerp(target, 0.14);
    }
  });

  const badge = useMemo(() => {
    if (vs === "fail") return glyphTexture("✕", COL.fail);
    if (vs === "retry") return glyphTexture("↻", COL.retry);
    if (vs === "run") return glyphTexture("", COL.run);
    return null;
  }, [vs]);
  useEffect(() => () => badge?.dispose(), [badge]);

  return (
    <group ref={ref}>
      <RoundedBox
        args={[BLOCK, 0.5, BLOCK]}
        radius={0.05}
        smoothness={2}
        position={[0, 0.25, 0]}
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "auto";
        }}
        scale={hover ? 1.08 : 1}
      >
        <meshStandardMaterial color={color} roughness={0.68} metalness={0} />
      </RoundedBox>
      {badge && <BadgeSprite tex={badge} pulse={vs === "run"} />}
      {hover && (
        <Html position={[0, 0.7, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
          <div
            style={{
              whiteSpace: "nowrap",
              transform: "translateY(-100%)",
              background: "#1C1815",
              color: "#FFFEFC",
              font: "600 11px Inter, system-ui, sans-serif",
              padding: "4px 8px",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.28)",
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

function BadgeSprite({ tex, pulse }: { tex: THREE.CanvasTexture; pulse: boolean }) {
  const ref = useRef<THREE.Sprite>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const o = pulse ? 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 4) : 1;
    (ref.current.material as THREE.SpriteMaterial).opacity = o;
  });
  return (
    <sprite ref={ref} position={[0, 0.95, 0]} scale={[0.4, 0.4, 0.4]}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  );
}

// ---- Gate lamp ---------------------------------------------------------------
function GateLamp({ color }: { color: string }) {
  return (
    <group position={[2.1, 0, 0]}>
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 1.5, 8]} />
        <meshStandardMaterial color={COL.platformDark} roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} roughness={0.4} />
      </mesh>
    </group>
  );
}

// ---- the whole yard ----------------------------------------------------------
function Yard({ units, batches, onTokenClick, reduced }: FlowSceneProps & { reduced: boolean }) {
  const { targets, colors, buckets, lamp, prLit, benchCount } = useMemo(() => {
    const order = new Map(batches.map((b, i) => [b.id, i]));
    const idx = { yard: 0, bench: 0, dock: 0, siding: 0 };
    const targets = new Map<string, THREE.Vector3>();
    const colors = new Map<string, string>();
    const buckets = new Map<string, VS>();
    let anyRun = false;
    let anyRetry = false;
    let anyFail = false;
    let allDone = units.length > 0;

    // stable ordering so blocks don't reshuffle frame-to-frame
    const ordered = [...units].sort((a, b) => {
      const oa = order.get(batchForUnit(batches, a.unitId)?.id ?? "") ?? 0;
      const ob = order.get(batchForUnit(batches, b.unitId)?.id ?? "") ?? 0;
      return oa - ob || a.unitId.localeCompare(b.unitId);
    });

    for (const u of ordered) {
      const vs = visualStatus(u.status);
      buckets.set(u.unitId, vs);
      const batch = batchForUnit(batches, u.unitId);
      colors.set(u.unitId, batch?.color ?? COL.queued);
      let pos: THREE.Vector3;
      if (vs === "queued") {
        const i = idx.yard++;
        const col = i % 3;
        const row = Math.floor(i / 3) % 3;
        const layer = Math.floor(i / 9);
        pos = new THREE.Vector3(YARD.x - 1.2 + col * 1.2, H + layer * 0.55, YARD.z - 1.2 + row * 1.2);
        allDone = false;
      } else if (vs === "run" || vs === "retry") {
        const i = idx.bench++;
        const col = i % 3;
        // in front of the workers (who stand at the back of the bench) so they
        // hammer toward the camera onto these blocks
        pos = new THREE.Vector3(BENCH.x - 1.3 + col * 1.3, H, BENCH.z + 0.35);
        allDone = false;
        anyRun = anyRun || vs === "run";
        anyRetry = anyRetry || vs === "retry";
      } else if (vs === "ok") {
        const i = idx.dock++;
        const col = i % 3;
        const row = Math.floor(i / 3);
        pos = new THREE.Vector3(DOCK.x - 1.3 + col * 1.3, H, DOCK.z - 1.3 + row * 1.3);
      } else {
        const i = idx.siding++;
        const col = i % 3;
        const row = Math.floor(i / 3);
        pos = new THREE.Vector3(SIDING.x - 1.3 + col * 1.3, H, SIDING.z - 0.5 + row * 1.0);
        anyFail = true;
        allDone = false;
      }
      targets.set(u.unitId, pos);
    }

    const lamp = anyFail ? COL.fail : anyRetry ? COL.retry : anyRun ? COL.run : allDone ? COL.ok : COL.queued;
    const prLit = allDone && units.some((u) => u.status === "passed");
    return { targets, colors, buckets, lamp, prLit, benchCount: idx.bench };
  }, [units, batches]);

  return (
    <group>
      {/* platforms */}
      <Platform zone={YARD} />
      <Platform zone={BENCH} />
      <Platform zone={DOCK} />
      <Platform zone={PR} tint={prLit ? "#C7D2B4" : COL.platform}>
        {/* a crate on the PR pad that lights when everything shipped */}
        <mesh position={[0, H + 0.45, 0]} castShadow>
          <boxGeometry args={[1.3, 0.9, 1.3]} />
          <meshStandardMaterial
            color={prLit ? COL.ok : COL.platformDark}
            emissive={prLit ? COL.ok : "#000000"}
            emissiveIntensity={prLit ? 0.5 : 0}
            roughness={0.7}
          />
        </mesh>
      </Platform>
      <Platform zone={SIDING} tint="#E7D4CC" />

      {/* main line: yard → bench → shipping, docked edge-to-edge */}
      <Belt points={[[YARD.x + YARD.w / 2 - 0.3, 0], [BENCH.x - BENCH.w / 2 + 0.3, 0]]} />
      <Belt points={[[BENCH.x + BENCH.w / 2 - 0.3, 0], [DOCK.x - DOCK.w / 2 + 0.3, 0]]} />
      {/* review loop: bench → review siding (straight drop), then a curved
          return leg that sweeps back around to the yard */}
      <Belt points={[[BENCH.x, BENCH.z + BENCH.d / 2 - 0.3], [SIDING.x, SIDING.z - SIDING.d / 2 + 0.3]]} />
      <Belt
        points={[
          [SIDING.x - SIDING.w / 2 + 0.3, SIDING.z + 0.4],
          [SIDING.x - SIDING.w / 2 - 1.4, SIDING.z + 0.2],
          [YARD.x - 0.6, SIDING.z - 2.0],
          [YARD.x, YARD.z + YARD.d / 2 - 0.3],
        ]}
      />

      <GateLamp color={lamp} />

      {/* two workers at the back of the bench, each lined up behind a block
          column (col 0 and col 1), hammering forward onto them */}
      <Worker position={[BENCH.x - 1.3, H, BENCH.z - 0.6]} phase={0} active={benchCount > 0} />
      <Worker position={[BENCH.x, H, BENCH.z - 0.6]} phase={1.9} active={benchCount > 0} />

      {/* unit blocks */}
      {units.map((u) => (
        <Block
          key={u.unitId}
          target={targets.get(u.unitId)!}
          color={colors.get(u.unitId)!}
          vs={buckets.get(u.unitId)!}
          label={u.scopeGlob}
          reduced={reduced}
          onActivate={() => onTokenClick(batchForUnit(batches, u.unitId)?.id ?? "")}
        />
      ))}
    </group>
  );
}

// ---- deterministic isometric framing ----------------------------------------
// The whole yard's world AABB (spans Yard on the left to the PR pad on the
// right, plus block/worker height). We frame an orthographic camera to it by
// projecting the 8 corners into camera space and picking a zoom that fits — so
// the scene is always centred and never clipped, and re-fits on resize.
const SCENE_MIN = new THREE.Vector3(-12.0, 0, -2.6);
const SCENE_MAX = new THREE.Vector3(13.6, 2.0, 7.0);
const SCENE_CENTER = new THREE.Vector3().addVectors(SCENE_MIN, SCENE_MAX).multiplyScalar(0.5);

function FitCamera() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.position.set(SCENE_CENTER.x + 16, SCENE_CENTER.y + 15, SCENE_CENTER.z + 16);
    cam.lookAt(SCENE_CENTER);
    cam.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(
        i & 1 ? SCENE_MAX.x : SCENE_MIN.x,
        i & 2 ? SCENE_MAX.y : SCENE_MIN.y,
        i & 4 ? SCENE_MAX.z : SCENE_MIN.z
      ).applyMatrix4(cam.matrixWorldInverse);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    cam.zoom = Math.min(size.width / worldW, size.height / worldH) * 1.0;
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);
  return null;
}

// ---- Canvas shell ------------------------------------------------------------
export default function FlowSceneCanvas({ units, batches, onTokenClick }: FlowSceneProps) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop={reduced ? "demand" : "always"}
        style={{ width: "100%", height: "100%" }}
      >
        <OrthographicCamera makeDefault near={-100} far={200} />
        <FitCamera />
        <ambientLight intensity={0.65} />
        <directionalLight position={[10, 18, 6]} intensity={1.0} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-10, 8, -6]} intensity={0.32} />
        <Yard units={units} batches={batches} onTokenClick={onTokenClick} reduced={reduced} />
        <ContactShadows position={[0, 0.01, 1]} opacity={0.28} scale={40} blur={2.2} far={12} color="#8A8072" />
      </Canvas>
      {/* keyboard / screen-reader path — the 3D blocks aren't focusable, so mirror
          the batches as real buttons for a11y. */}
      <ul className="sr-only">
        {batches.map((b) => (
          <li key={b.id}>
            <button type="button" onClick={() => onTokenClick(b.id)}>
              Open batch {b.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
