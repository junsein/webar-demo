import "./style.css";
import * as THREE from "three";

// ---------------- DOM ----------------
const video = document.getElementById("video");
const canvas = document.getElementById("three");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
}

// 讓 video 不吃觸控（避免點不到 canvas）
if (video) video.style.pointerEvents = "none";

// ---------------- Camera ----------------
let stream = null;

async function startCamera() {
  if (stream) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    video.srcObject = stream;
    await video.play();

    btnStart.disabled = true;
    btnStop.disabled = false;

    setStatus("拖拉木頭進圈內並保持穩定");
  } catch (err) {
    console.error(err);
    stream = null;
    setStatus(`啟動失敗：${err.name}`);
    alert(
      `相機啟動失敗：${err.name}\n\n` +
        `請確認：\n1) HTTPS 網址（手機必須）\n2) 已允許相機權限`
    );
  }
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;

  btnStart.disabled = false;
  btnStop.disabled = true;

  setStatus("相機已關閉");
}

btnStart.addEventListener("click", startCamera);
btnStop.addEventListener("click", stopCamera);

if (!navigator.mediaDevices?.getUserMedia) {
  setStatus("此瀏覽器不支援 getUserMedia");
  btnStart.disabled = true;
}

// ---------------- Three.js ----------------
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
camera.position.set(0, 0, 2);

scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.2));

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------------- Game State ----------------
const GameState = Object.freeze({
  FIRE: "FIRE",
  HUNT: "HUNT",
  DONE: "DONE",
});
let state = GameState.FIRE;

// ---------------- Shared Raycaster ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setPointer(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

// ============================================================
// 1) FIRE TASK (drag woods into circle)
// ============================================================
const fireRadius = 0.6;
const STABLE_SECONDS_FIRE = 2.5;

const fireCircle = new THREE.Mesh(
  new THREE.RingGeometry(fireRadius - 0.02, fireRadius, 32),
  new THREE.MeshBasicMaterial({
    color: 0xffaa33,
    transparent: true,
    opacity: 0.85,
  })
);
fireCircle.rotation.x = -Math.PI / 2;
fireCircle.position.set(0, -0.6, 0);
scene.add(fireCircle);

const woods = [];
function createWood(x, z, rotY = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
  );
  mesh.position.set(x, -0.6, z);
  mesh.rotation.y = rotY;
  scene.add(mesh);
  woods.push(mesh);
}

createWood(-0.6, 0.3, 0.2);
createWood(0.6, 0.2, -0.4);
createWood(0.2, -0.6, 0.9);

let draggingWood = null;

// 固定拖拉平面（y = -0.6）
const firePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.6);

function pointOnFirePlane(event) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const p = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(firePlane, p);
  return hit ? p : null;
}

let fired = false;
let stableTimeFire = 0;
let flame = null;

function allWoodsInside() {
  return woods.every((w) => {
    const dx = w.position.x - fireCircle.position.x;
    const dz = w.position.z - fireCircle.position.z;
    return Math.sqrt(dx * dx + dz * dz) < fireRadius;
  });
}

function igniteFire() {
  if (fired) return;
  fired = true;

  fireCircle.material.color.set(0xff3300);
  fireCircle.material.opacity = 1;

  flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xff5522 })
  );
  flame.position.set(0, -0.35, 0);
  scene.add(flame);

  setStatus("🔥 生火成功！進入狩獵任務…");

  // 0.8 秒後切任務（讓玩家看一下成功）
  setTimeout(() => {
    startHuntTask();
  }, 800);
}

function updateFire(dt) {
  if (fired) return;

  const inside = allWoodsInside();
  if (inside) stableTimeFire += dt;
  else stableTimeFire = 0;

  const progress = Math.min(stableTimeFire / STABLE_SECONDS_FIRE, 1);
  const pct = Math.round(progress * 100);

  if (inside) setStatus(`穩定中：${pct}%（生火）`);
  else setStatus("拖拉木頭進圈內並保持穩定");

  fireCircle.material.opacity = 0.4 + 0.6 * progress;

  if (stableTimeFire >= STABLE_SECONDS_FIRE) igniteFire();
}

// ============================================================
// 2) HUNT TASK (tap to shoot targets)
// ============================================================
/**
 * 簡化狩獵 demo：
 * - 野獸在前方區域（x: [-1,1], y: [-0.2,0.7], z: -2.2）隨機竄出
 * - 玩家用點擊（pointerdown）射擊
 * - 指定目標：adult（大隻）= 加分
 * - 禁止目標：juvenile（幼獸）或 decoy（非指定）= 扣分
 * - 達到 targetScore 結束
 */

// 狩獵區域（世界座標）
const HUNT_Z = -2.2;
const HUNT_X_RANGE = 1.2;
const HUNT_Y_MIN = -0.15;
const HUNT_Y_MAX = 0.75;

// 分數設定
let score = 0;
const targetScore = 5;

// 生成節奏
let spawnCooldown = 0;

// 目標容器
const huntTargets = []; // { mesh, kind, ttl, speed, dir }
let crosshair = null;

function makeCrosshair() {
  // 很簡單的準星（線框環）
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.035, 0.045, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  );
  m.position.set(0, 0, -0.8);
  return m;
}

function createTargetMesh(kind) {
  // 用顏色區分（你之後可換成真正動物模型/貼圖）
  // adult: 深色；juvenile: 淺色；decoy: 偏紅
  const color =
    kind === "adult" ? 0x2e2e2e : kind === "juvenile" ? 0xbdbdbd : 0xaa3333;

  const size =
    kind === "adult" ? 0.18 : kind === "juvenile" ? 0.12 : 0.16;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 16, 12),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(0, 0, HUNT_Z);
  return mesh;
}

function spawnTarget() {
  // 出現機率：adult 55%、juvenile 25%、decoy 20%
  const r = Math.random();
  const kind = r < 0.55 ? "adult" : r < 0.8 ? "juvenile" : "decoy";

  const mesh = createTargetMesh(kind);

  // 從左→右或右→左竄出
  const fromLeft = Math.random() < 0.5;
  const x0 = fromLeft ? -HUNT_X_RANGE : HUNT_X_RANGE;
  const y0 = HUNT_Y_MIN + Math.random() * (HUNT_Y_MAX - HUNT_Y_MIN);

  mesh.position.set(x0, y0, HUNT_Z);

  // 速度/存活時間
  const speed = kind === "adult" ? 0.9 : kind === "juvenile" ? 1.2 : 1.1;
  const ttl = kind === "adult" ? 1.6 : kind === "juvenile" ? 1.4 : 1.5;
  const dir = fromLeft ? 1 : -1;

  scene.add(mesh);
  huntTargets.push({ mesh, kind, ttl, speed, dir });
}

function clearHunt() {
  for (const t of huntTargets) scene.remove(t.mesh);
  huntTargets.length = 0;
}

function startHuntTask() {
  // 切 state
  state = GameState.HUNT;

  // 清掉生火互動（你也可保留火堆當背景）
  draggingWood = null;

  // 顯示準星
  if (!crosshair) {
    crosshair = makeCrosshair();
    scene.add(crosshair);
  }

  // 初始化分數/節奏
  score = 0;
  spawnCooldown = 0.4;
  clearHunt();

  setStatus("🎯 狩獵開始：只打「指定野獸」！別打幼獸或非指定目標");
}

function endHuntTask() {
  state = GameState.DONE;
  clearHunt();
  if (crosshair) {
    scene.remove(crosshair);
    crosshair = null;
  }
  setStatus("✅ 狩獵完成！任務結束（Demo）");
}

function updateHunt(dt) {
  // 生怪
  spawnCooldown -= dt;
  if (spawnCooldown <= 0) {
    spawnTarget();
    // 節奏：0.35~0.8 秒
    spawnCooldown = 0.35 + Math.random() * 0.45;
  }

  // 更新目標移動/消失
  for (let i = huntTargets.length - 1; i >= 0; i--) {
    const t = huntTargets[i];
    t.ttl -= dt;
    t.mesh.position.x += t.dir * t.speed * dt;

    if (t.ttl <= 0) {
      scene.remove(t.mesh);
      huntTargets.splice(i, 1);
    }
  }

  // 顯示分數
  setStatus(
    `🎯 狩獵中：分數 ${score}/${targetScore}（打 adult +1；打 juvenile/decoy -1）`
  );

  if (score >= targetScore) endHuntTask();
  if (score <= -3) {
    // 你也可以改成「失敗」分支
    setStatus("⚠️ 太多誤擊！請重新整理再試（Demo）");
    state = GameState.DONE;
  }
}

// ---------------- Shooting (click to hit) ----------------
function shoot(event) {
  if (state !== GameState.HUNT) return;

  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const meshes = huntTargets.map((t) => t.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return;

  const hitMesh = hits[0].object;
  const idx = huntTargets.findIndex((t) => t.mesh === hitMesh);
  if (idx === -1) return;

  const t = huntTargets[idx];

  // 計分規則
  if (t.kind === "adult") score += 1;
  else score -= 1;

  // 命中效果：快速縮放一下
  hitMesh.scale.setScalar(0.6);
  setTimeout(() => {
    // 移除目標
    scene.remove(hitMesh);
  }, 60);

  huntTargets.splice(idx, 1);
}

// ============================================================
// Pointer events (two modes)
// ============================================================
function onPointerDown(event) {
  if (state === GameState.FIRE) {
    if (fired) return;

    setPointer(event);
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObjects(woods);
    if (hits.length > 0) draggingWood = hits[0].object;
    return;
  }

  if (state === GameState.HUNT) {
    shoot(event);
    return;
  }
}

function onPointerMove(event) {
  if (state !== GameState.FIRE) return;
  if (!draggingWood || fired) return;

  const p = pointOnFirePlane(event);
  if (!p) return;

  draggingWood.position.set(p.x, -0.6, p.z);
}

function onPointerUp() {
  draggingWood = null;
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// ---------------- Loop ----------------
let lastT = performance.now();
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastT) / 1000;
  lastT = now;

  if (state === GameState.FIRE) updateFire(dt);
  else if (state === GameState.HUNT) updateHunt(dt);

  renderer.render(scene, camera);
}
animate();
