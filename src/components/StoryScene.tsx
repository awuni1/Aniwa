"use client";

// Scroll-driven 3D walkthrough shown under the landing-page hero.
// The parent passes scroll progress (0..1) through a ref; this scene turns it
// into a "chapter position" c (0.5 at chapter 1's centre, 6.5 at chapter 7's)
// and moves the camera and fades objects in and out from that one number.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { pointInGeometry } from "@/lib/geo";
import { CHAPTER_COUNT, chapterPosition } from "@/lib/story";

type Geometry = { type: string; coordinates: unknown };
type Feature = { properties: { shapeName: string }; geometry: Geometry };

// Map projection: plain lng/lat degrees centred on Ghana, 1 unit = 1 degree.
const LNG0 = -1.03;
const LAT0 = 7.95;
const toX = (lng: number) => lng - LNG0;
const toZ = (lat: number) => -(lat - LAT0);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (x: number, a: number, b: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bell = (x: number, a: number, b: number, c: number, d: number) => smooth(x, a, b) * (1 - smooth(x, c, d));

const REFUGES = [
  { name: "Ankasa", lat: 5.17, lng: -2.63 },
  { name: "Bia", lat: 6.48, lng: -3.13 },
  { name: "Kakum", lat: 5.35, lng: -1.38 },
];

// Real data shown in the story, all from the same live sources as the
// dashboard (see PlatformStory): the model's top hotspots, NASA fires in the
// forest belt, the latest chainsaw detection, and recommended restoration sites.
export interface StoryData {
  hotspots: { lat: number; lng: number }[];
  fires: { lat: number; lng: number }[];
  listener: { lat: number; lng: number } | null;
  sites: { lat: number; lng: number }[];
}

const BASE_H = 0.06;

// Realistic Earth for chapter 1 (from the hero globe on the 3D-globe branch):
// day/night blend from a fixed sun, city lights on the dark side, a blue rim,
// and an opacity uniform so it can fade into the map.
const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  uniform float opacity;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    float d = dot(n, normalize(sunDir));
    float lit = smoothstep(-0.12, 0.28, d);
    vec3 dayCol = day * (0.3 + 0.95 * max(d, 0.0));
    vec3 nightCol = day * 0.035 + night * vec3(1.5, 1.15, 0.7);
    vec3 col = mix(nightCol, dayCol, lit);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    col += vec3(0.25, 0.55, 1.0) * rim * 0.45;
    gl_FragColor = vec4(col, opacity);
    #include <colorspace_fragment>
  }
`;
const ATMOS_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ATMOS_FRAG = /* glsl */ `
  uniform float opacity;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(max(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.6);
    gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity * 0.9 * opacity;
  }
`;

// Point on a three.js SphereGeometry for a lat/lng (matches the texture's UVs).
function earthPoint(lat: number, lng: number, r: number): THREE.Vector3 {
  const la = THREE.MathUtils.degToRad(lat);
  const lo = THREE.MathUtils.degToRad(lng);
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

function solidTexture(r: number, g: number, b: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const regionName = (f: Feature) => f.properties.shapeName.replace(/\s+Region$/i, "");

function outerRings(g: Geometry): number[][][] {
  if (g.type === "Polygon") return [(g.coordinates as number[][][])[0]];
  if (g.type === "MultiPolygon") return (g.coordinates as number[][][][]).map((p) => p[0]);
  return [];
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Camera stops, one per chapter: [position, look-at target].
const SHOTS: [THREE.Vector3, THREE.Vector3][] = [
  [new THREE.Vector3(0, 0.3, 8.6), new THREE.Vector3(0, 0, 0)], // globe
  [new THREE.Vector3(0.4, 6.6, 6.4), new THREE.Vector3(0, 0, 0.4)], // all regions
  [new THREE.Vector3(-2.2, 3.6, 5.2), new THREE.Vector3(-0.9, 0, 1.6)], // hotspots
  [new THREE.Vector3(-2.9, 1.7, 3.9), new THREE.Vector3(-1.5, 0.15, 1.65)], // listener
  [new THREE.Vector3(0.2, 9.2, 2.6), new THREE.Vector3(0, 0, 0.6)], // from space
  [new THREE.Vector3(-0.9, 3.6, 6.2), new THREE.Vector3(-1.7, 0, 2.4)], // refuges
  [new THREE.Vector3(1.2, 5.4, 6.6), new THREE.Vector3(-0.9, 0, 1.5)], // restore
];

export default function StoryScene({
  progressRef,
  lossByRegion,
  story,
}: {
  progressRef: React.RefObject<number>;
  lossByRegion: Record<string, number> | null;
  story: StoryData | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lossRef = useRef(lossByRegion);

  const storyRef = useRef(story);
  const applyStoryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    lossRef.current = lossByRegion;
  }, [lossByRegion]);

  useEffect(() => {
    storyRef.current = story;
    applyStoryRef.current?.();
  }, [story]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const probe = document.createElement("canvas");
    if (!probe.getContext("webgl2") && !probe.getContext("webgl")) return; // text still reads fine without 3D

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a1208, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(3, 6, 4);
    scene.add(sun);

    const glow = glowTexture();
    const disposables: { dispose(): void }[] = [glow];
    const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

    // ---------- Globe (chapter 1): realistic Earth with a Ghana beacon ----------
    const globe = new THREE.Group();
    scene.add(globe);
    const R = 2;
    const GHANA_LAT = 7.95;
    const GHANA_LNG = -1.03;
    const earthUniforms = {
      dayMap: { value: track(solidTexture(18, 52, 86)) as THREE.Texture },
      nightMap: { value: track(solidTexture(0, 0, 0)) as THREE.Texture },
      sunDir: { value: new THREE.Vector3(0.8, 0.4, 0.9).normalize() },
      opacity: { value: 1 },
    };
    const earth = new THREE.Mesh(
      track(new THREE.SphereGeometry(R, 96, 64)),
      track(new THREE.ShaderMaterial({ uniforms: earthUniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG, transparent: true })),
    );
    // Turn the texture so Ghana faces the camera (+z) before the scroll spin.
    const ghanaLo = THREE.MathUtils.degToRad(GHANA_LNG);
    earth.rotation.y = -Math.atan2(Math.cos(ghanaLo), -Math.sin(ghanaLo));
    globe.add(earth);

    const atmosUniforms = { opacity: { value: 1 } };
    globe.add(
      new THREE.Mesh(
        track(new THREE.SphereGeometry(R * 1.13, 64, 48)),
        track(
          new THREE.ShaderMaterial({
            uniforms: atmosUniforms,
            vertexShader: ATMOS_VERT,
            fragmentShader: ATMOS_FRAG,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
          }),
        ),
      ),
    );

    // Ghana beacon: gold dot, pulsing ring and a light beam, pinned to the surface.
    const ghanaNormal = earthPoint(GHANA_LAT, GHANA_LNG, 1).normalize();
    const beaconMat = (opacity: number) =>
      track(new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const beaconDotMat = beaconMat(1);
    const beaconRingMat = beaconMat(0.8);
    const beaconBeamMat = beaconMat(0.55);
    const beaconDot = new THREE.Mesh(track(new THREE.SphereGeometry(0.024, 16, 12)), beaconDotMat);
    beaconDot.position.copy(ghanaNormal).multiplyScalar(R * 1.002);
    const beaconRing = new THREE.Mesh(track(new THREE.RingGeometry(0.032, 0.042, 48)), beaconRingMat);
    beaconRing.position.copy(ghanaNormal).multiplyScalar(R * 1.004);
    beaconRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ghanaNormal);
    const beamHeight = 0.34;
    const beaconBeam = new THREE.Mesh(track(new THREE.CylinderGeometry(0.006, 0.015, beamHeight, 12, 1, true)), beaconBeamMat);
    beaconBeam.position.copy(ghanaNormal).multiplyScalar(R + beamHeight / 2);
    beaconBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ghanaNormal);
    earth.add(beaconDot, beaconRing, beaconBeam);

    // Earth textures (the solid placeholders above cover a failed load).
    const texLoader = new THREE.TextureLoader();
    const maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    for (const [url, uniform] of [
      ["/textures/earth_day_2048.jpg", earthUniforms.dayMap],
      ["/textures/earth_night_2048.png", earthUniforms.nightMap],
    ] as const) {
      texLoader.load(url, (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        uniform.value = track(tex);
      });
    }

    // Tilt so Ghana's latitude faces the camera; the scroll spin turns it into view.
    globe.rotation.order = "XYZ";
    globe.rotation.x = THREE.MathUtils.degToRad(GHANA_LAT);

    // Satellite carried over from the hero, orbiting the globe.
    let satellite: THREE.Object3D | null = null;
    let satScale = 1;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load("/sentinel.glb", (gltf) => {
      if (disposed) return;
      satellite = gltf.scene;
      const size = new THREE.Box3().setFromObject(satellite).getSize(new THREE.Vector3());
      satScale = 0.9 / Math.max(size.x, size.y, size.z);
      scene.add(satellite);
    });

    // ---------- Ghana map (chapters 2–7) ----------
    const map = new THREE.Group();
    scene.add(map);
    const grid = new THREE.GridHelper(14, 28, 0x2a3a48, 0x1a2630);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    grid.position.y = -0.005;
    map.add(grid);
    track(grid.geometry);
    track(gridMat);

    const regionMeshes: THREE.Mesh[] = [];
    const regionMats: THREE.MeshStandardMaterial[] = [];
    const edgeMats: THREE.LineBasicMaterial[] = [];
    let regionNames: string[] = [];
    const heights: number[] = [];

    const GREEN = new THREE.Color(0x2e7d4f);
    const LOSS = new THREE.Color(0xe8792b);
    const tmpColor = new THREE.Color();

    // Hotspot pins (chapter 3)
    const pinMat = track(new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true }));
    const pinRingMat = track(new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    const stemGeo = track(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 6));
    const headGeo = track(new THREE.SphereGeometry(0.055, 16, 12));
    const ringGeo = track(new THREE.RingGeometry(0.9, 1, 48));
    const pins: { g: THREE.Group; ring: THREE.Mesh; region: number }[] = [];

    // Listening phone (chapter 4)
    const phone = new THREE.Group();
    const phoneMat = track(new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.4, transparent: true }));
    const screenMat = track(new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true }));
    phone.add(new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.16, 0.012)), phoneMat));
    const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(0.068, 0.14)), screenMat);
    screen.position.z = 0.0065;
    phone.add(screen);
    phone.rotation.y = -0.6;
    map.add(phone);
    const waveMats: THREE.MeshBasicMaterial[] = [];
    const waves: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const m = track(new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      const w = new THREE.Mesh(track(new THREE.RingGeometry(0.96, 1, 64)), m);
      w.rotation.x = -Math.PI / 2;
      map.add(w);
      waves.push(w);
      waveMats.push(m);
    }
    let listenerRegion = -1;
    let hasListener = false;

    // Fires (chapter 5)
    const fireGeo = track(new THREE.BufferGeometry());
    const fireMat = track(new THREE.PointsMaterial({ size: 0.14, map: glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const fires = new THREE.Points(fireGeo, fireMat);
    map.add(fires);
    let firePts: { lat: number; lng: number; region: number }[] = [];

    // Refuges (chapter 6)
    const domeMat = track(new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, depthWrite: false }));
    const refugeRingMat = track(new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    const domeGeo = track(new THREE.SphereGeometry(0.32, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2));
    const refuges = REFUGES.map((r) => {
      const g = new THREE.Group();
      g.position.set(toX(r.lng), 0, toZ(r.lat));
      g.add(new THREE.Mesh(domeGeo, domeMat));
      const ring = new THREE.Mesh(ringGeo, refugeRingMat);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      map.add(g);
      return { g, ring, region: -1 };
    });

    // Restored trees (chapter 7)
    const treeGeo = track(new THREE.ConeGeometry(0.03, 0.11, 6));
    treeGeo.translate(0, 0.055, 0);
    const treeMat = track(new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.6, emissive: 0x0d3b1f }));
    let trees: THREE.InstancedMesh | null = null;
    let treePts: { lat: number; lng: number; region: number }[] = [];
    const dummy = new THREE.Object3D();

    fetch("/ghana_regions.geojson")
      .then((r) => r.json())
      .then((geo: { features: Feature[] }) => {
        if (disposed) return;
        const features = geo.features;
        regionNames = features.map(regionName);


        // Extruded regions. Shapes are drawn in the XY plane (x = lng, y = lat),
        // then rotated so latitude runs north into the screen and extrusion points up.
        features.forEach((f) => {
          const mat = track(new THREE.MeshStandardMaterial({ color: GREEN.clone(), roughness: 0.85, metalness: 0.05, transparent: true }));
          const edgeMat = track(new THREE.LineBasicMaterial({ color: 0xf5c518, transparent: true }));
          const shapes = outerRings(f.geometry).map((ring) => {
            const step = Math.max(1, Math.floor(ring.length / 400));
            const pts = ring.filter((_, i) => i % step === 0).map(([lng, lat]) => new THREE.Vector2(toX(lng), -toZ(lat)));
            return new THREE.Shape(pts);
          });
          const g = track(new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false }));
          const mesh = new THREE.Mesh(g, mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.scale.z = BASE_H;
          const edges = new THREE.LineSegments(track(new THREE.EdgesGeometry(g, 30)), edgeMat);
          mesh.add(edges);
          map.add(mesh);
          regionMeshes.push(mesh);
          regionMats.push(mat);
          edgeMats.push(edgeMat);
          heights.push(BASE_H);
        });

        const regionOf = (p: { lat: number; lng: number }) => features.findIndex((f) => pointInGeometry(p, f.geometry));

        refuges.forEach((r, i) => (r.region = regionOf(REFUGES[i])));

        // Place the real story data; re-run whenever new data arrives.
        const applyStory = () => {
          const data = storyRef.current;
          if (!data) return;
          for (const p of pins) map.remove(p.g, p.ring);
          pins.length = 0;
          data.hotspots.forEach((p) => {
            const g = new THREE.Group();
            const stem = new THREE.Mesh(stemGeo, pinMat);
            stem.position.y = 0.25;
            const head = new THREE.Mesh(headGeo, pinMat);
            head.position.y = 0.52;
            g.add(stem, head);
            g.position.set(toX(p.lng), 0, toZ(p.lat));
            const ring = new THREE.Mesh(ringGeo, pinRingMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.copy(g.position);
            map.add(g, ring);
            pins.push({ g, ring, region: regionOf(p) });
          });

          hasListener = data.listener !== null;
          if (data.listener) {
            listenerRegion = regionOf(data.listener);
            phone.position.set(toX(data.listener.lng), 0, toZ(data.listener.lat));
            for (const w of waves) w.position.set(toX(data.listener.lng), 0, toZ(data.listener.lat));
          }

          firePts = data.fires.map((p) => ({ ...p, region: regionOf(p) }));
          const fc: number[] = [];
          firePts.forEach((_, n) => {
            const col = new THREE.Color().setHSL(0.03 + ((n * 0.37) % 1) * 0.09, 1, 0.55);
            fc.push(col.r, col.g, col.b);
          });
          fireGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Array(firePts.length * 3).fill(0), 3));
          fireGeo.setAttribute("color", new THREE.Float32BufferAttribute(fc, 3));

          // A small grove drawn at each real recommended site (fixed pattern, ~2 km across).
          treePts = data.sites.flatMap((site) =>
            Array.from({ length: 9 }, (_, k) => {
              const a = (k / 9) * Math.PI * 2;
              const r = k === 0 ? 0 : 0.012 + (k % 3) * 0.006;
              const p = { lat: site.lat + Math.sin(a) * r, lng: site.lng + Math.cos(a) * r };
              return { ...p, region: regionOf(site) };
            }),
          );
          if (trees) {
            map.remove(trees);
            trees.dispose();
          }
          trees = new THREE.InstancedMesh(treeGeo, treeMat, Math.max(1, treePts.length));
          trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          map.add(trees);
        };
        applyStoryRef.current = applyStory;
        applyStory();
      })
      .catch(() => {
        /* map just stays empty; chapter text still explains everything */
      });

    // ---------- Render loop ----------
    let c = chapterPosition(progressRef.current ?? 0);
    const camPos = SHOTS[0][0].clone();
    const camLook = SHOTS[0][1].clone();
    const tmpPos = new THREE.Vector3();
    const tmpLook = new THREE.Vector3();
    const fade = (m: THREE.Material, w: number, max = 1) => {
      m.opacity = w * max;
      m.visible = w > 0.005;
    };

    let visible = true;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!visible) return;
      const t = reducedMotion ? 0 : performance.now() * 0.001;

      const target = chapterPosition(progressRef.current ?? 0);
      c += (target - c) * (reducedMotion ? 1 : 0.08);

      // Camera: hold on each chapter's shot, glide between them.
      const k = Math.min(Math.max(c - 0.5, 0), CHAPTER_COUNT - 1);
      const i = Math.min(Math.floor(k), CHAPTER_COUNT - 2);
      const f = smooth(k - i, 0.15, 0.85);
      tmpPos.lerpVectors(SHOTS[i][0], SHOTS[i + 1][0], f);
      tmpLook.lerpVectors(SHOTS[i][1], SHOTS[i + 1][1], f);
      // Pull back a little overall, and more on tall/narrow screens so the country still fits.
      const aspect = camera.aspect;
      const pull = 1.3 * (aspect < 1.2 ? Math.pow(1.2 / aspect, 0.75) : 1);
      tmpPos.sub(tmpLook).multiplyScalar(pull).add(tmpLook);
      camPos.lerp(tmpPos, 0.2);
      camLook.lerp(tmpLook, 0.2);
      camera.position.copy(camPos);
      camera.lookAt(camLook);

      // Globe → map crossfade
      const globeW = 1 - smooth(c, 0.75, 1.3);
      const mapW = smooth(c, 0.8, 1.35);
      globe.visible = globeW > 0.005;
      globe.rotation.y = -1.4 * (1 - smooth(c, 0.2, 0.75)) + t * 0.02 * globeW;
      globe.scale.setScalar(1 + (1 - globeW) * 1.6);
      earthUniforms.opacity.value = globeW;
      atmosUniforms.opacity.value = globeW;
      const pulse = reducedMotion ? 0.4 : (t / 2.2) % 1;
      beaconRing.scale.setScalar(1 + pulse * 3.2);
      fade(beaconRingMat, globeW, (1 - pulse) * 0.8);
      fade(beaconDotMat, globeW);
      fade(beaconBeamMat, globeW, 0.4 + 0.15 * Math.sin(t * 2.4));
      if (satellite) {
        const a = t * 0.25 + 0.6;
        satellite.visible = globeW > 0.01;
        satellite.scale.setScalar(satScale * globeW);
        satellite.position.set(Math.cos(a) * 2.6, 0.7 + Math.sin(a) * 0.5, Math.sin(a) * 2.6 * 0.6 + 0.8);
        satellite.rotation.y = -a;
      }

      map.position.y = -0.6 * (1 - mapW);
      map.visible = mapW > 0.005;
      fade(gridMat, mapW, 0.35);

      // Region heights and colours
      const loss = lossRef.current;
      const maxLoss = loss ? Math.max(1, ...Object.values(loss)) : 1;
      const grow = smooth(c, 0.9, 1.45) * (1 - 0.75 * smooth(c, 1.7, 2.3));
      const lossTint = 0.9 * bell(c, 1.0, 1.5, 1.8, 2.4) + 0.25 + 0.6 * bell(c, 3.8, 4.8, 5.0, 5.5);
      const restored = smooth(c, 5.6, 6.3);
      regionMeshes.forEach((mesh, r) => {
        const share = loss ? (loss[regionNames[r]] ?? 0) / maxLoss : 0.35;
        const tall = loss ? 0.04 + 1.15 * share : 0.25;
        heights[r] = BASE_H + tall * grow;
        mesh.scale.z = heights[r];
        tmpColor.copy(GREEN).lerp(LOSS, clamp01(share * lossTint * (1 - 0.8 * restored)));
        regionMats[r].color.copy(tmpColor);
        fade(regionMats[r], mapW);
        fade(edgeMats[r], mapW, 0.35);
      });
      const hAt = (region: number) => (region >= 0 ? heights[region] ?? BASE_H : BASE_H);

      // Hotspot pins drop in one by one
      const pinW = bell(c, 1.7, 2.2, 2.8, 3.3);
      fade(pinMat, pinW);
      pins.forEach((p, n) => {
        const drop = smooth(c, 1.75 + n * 0.04, 2.05 + n * 0.04);
        const y = hAt(p.region);
        p.g.position.y = y + (1 - drop) * 1.2;
        p.g.scale.setScalar(Math.max(drop, 0.001));
        p.ring.position.y = y + 0.003;
        const phase = (t * 0.6 + n * 0.13) % 1;
        p.ring.scale.setScalar(0.05 + phase * 0.3);
      });
      fade(pinRingMat, pinW, 0.5);

      // Phone listening, sound waves rippling out
      const listenW = bell(c, 2.7, 3.2, 3.8, 4.3);
      const ly = hAt(listenerRegion);
      phone.visible = hasListener && listenW > 0.005;
      phone.position.y = ly + 0.085;
      phone.scale.setScalar(listenW);
      fade(phoneMat, listenW);
      fade(screenMat, listenW, 0.7 + 0.3 * Math.sin(t * 4));
      waves.forEach((w, n) => {
        const phase = (t * 0.45 + n / waves.length) % 1;
        w.position.y = ly + 0.004;
        w.scale.setScalar(0.04 + phase * 0.55);
        fade(waveMats[n], hasListener ? listenW : 0, 1 - phase);
      });

      // Fires flicker across the forest belt
      const fireW = bell(c, 3.7, 4.2, 4.8, 5.3);
      fires.visible = fireW > 0.005;
      if (fires.visible && firePts.length) {
        const pos = fireGeo.getAttribute("position") as THREE.BufferAttribute;
        firePts.forEach((p, n) => pos.setXYZ(n, toX(p.lng), hAt(p.region) + 0.04, toZ(p.lat)));
        pos.needsUpdate = true;
      }
      fireMat.size = 0.14 * (0.85 + 0.15 * Math.sin(t * 9));
      fade(fireMat, fireW, 0.95);

      // Refuges pulse
      const refugeW = bell(c, 4.7, 5.2, 5.8, 6.3);
      refuges.forEach((r, n) => {
        r.g.visible = refugeW > 0.005;
        r.g.position.y = hAt(r.region);
        r.g.scale.setScalar(0.4 + 0.6 * refugeW);
        const phase = (t * 0.4 + n / 3) % 1;
        r.ring.scale.setScalar(0.3 + phase * 0.45);
      });
      fade(domeMat, refugeW, 0.2);
      fade(refugeRingMat, refugeW, 0.6);

      // Trees grow back, staggered
      if (trees) {
        trees.visible = c > 5.5;
        if (trees.visible) {
          treePts.forEach((p, n) => {
            const d = (n / treePts.length) * 0.4;
            const s = smooth(c, 5.6 + d, 5.9 + d);
            dummy.position.set(toX(p.lng), hAt(p.region), toZ(p.lat));
            dummy.scale.setScalar(Math.max(s, 0.0001) * (0.8 + ((n * 37) % 10) / 25));
            dummy.updateMatrix();
            trees!.setMatrixAt(n, dummy.matrix);
          });
          trees.instanceMatrix.needsUpdate = true;
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(container);

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      // On wide screens the text cards sit on the left, so shift the whole
      // picture right instead of letting the cards cover it.
      // On phones the cards sit at the bottom, so lift the picture into the top half.
      if (w >= 768) camera.setViewOffset(w, h, -Math.round(w * 0.16), 0, w, h);
      else camera.setViewOffset(w, h, 0, Math.round(h * 0.17), w, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    onResize();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      io.disconnect();
      window.removeEventListener("resize", onResize);
      disposables.forEach((d) => d.dispose());
      trees?.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [progressRef]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />;
}
