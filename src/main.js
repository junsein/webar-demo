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

    startFireTask(); // ✅ 相機開啟後才生成木柴/營火

    setStatus("拖拉木柴進圈內並保持穩定");
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

  // 停止時清掉所有 3D 物件
  resetAllTasks();
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
  IDLE: "IDLE",
  FIRE: "FIRE",
  HUNT: "HUNT",
  DONE: "DONE",
});
let state = GameState.IDLE;

// ---------------- Shared Raycaster ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setPointer(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

// ============================================================
// 1) FIRE TASK (drag woods into circle)
//    - 相機開啟後才生成
//    - 完成後全部移除
// ============================================================
const fireRadius = 0.6;
const STABLE_SECONDS_FIRE = 2.5;

let fireCircle = null;
let woods = [];
let flame = null;

let draggingWood = null;
const firePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.6); // y = -0.6
let fired = false;
let stableTimeFire = 0;

function createFireCircle() {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(fireRadius - 0.02, fireRadius, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.85,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, -0.6, 0);
  return m;
}

function createWood(x, z, rotY = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
  );
  mesh.position.set(x, -0.6, z);
  mesh.rotation.y = rotY;
  return mesh;
}

function startFireTask() {
  resetAllTasks();

  state = GameState.FIRE;
  fired = false;
  stableTimeFire = 0;
  draggingWood = null;

  fireCircle = createFireCircle();
  scene.add(fireCircle);

  woods = [
    createWood(-0.6, 0.3, 0.2),
    createWood(0.6, 0.2, -0.4),
    createWood(0.2, -0.6, 0.9),
  ];
  woods.forEach((w) => scene.add(w));
}

function removeFireTaskObjects() {
  if (fireCircle) scene.remove(fireCircle);
  fireCircle = null;

  for (const w of woods) scene.remove(w);
  woods = [];

  if (flame) scene.remove(flame);
  flame = null;

  draggingWood = null;
}

function pointOnFirePlane(event) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const p = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(firePlane, p);
  return hit ? p : null;
}

function allWoodsInside() {
  if (!fireCircle) return false;

  return woods.every((w) => {
    const dx = w.position.x - fireCircle.position.x;
    const dz = w.position.z - fireCircle.position.z;
    return Math.sqrt(dx * dx + dz * dz) < fireRadius;
  });
}

function igniteFire() {
  if (fired) return;
  fired = true;

  // 變色 + 火焰
  fireCircle.material.color.set(0xff3300);
  fireCircle.material.opacity = 1;

  flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xff5522 })
  );
  flame.position.set(0, -0.35, 0);
  scene.add(flame);

  setStatus("🔥 生火成功！切換到狩獵任務…");

  // 0.8 秒後切任務（給玩家看到成功）
  setTimeout(() => {
    removeFireTaskObjects(); // ✅ 生火完成：木柴+營火全部消失
    startHuntTask(); // ✅ 進入狩獵
  }, 800);
}

function updateFire(dt) {
  if (!fireCircle || fired) return;

  const inside = allWoodsInside();
  if (inside) stableTimeFire += dt;
  else stableTimeFire = 0;

  const progress = Math.min(stableTimeFire / STABLE_SECONDS_FIRE, 1);
  const pct = Math.round(progress * 100);

  if (inside) setStatus(`穩定中：${pct}%（生火）`);
  else setStatus("拖拉木柴進圈內並保持穩定");

  fireCircle.material.opacity = 0.4 + 0.6 * progress;

  if (stableTimeFire >= STABLE_SECONDS_FIRE) igniteFire();
}

// ============================================================
// 2) HUNT TASK (tap to shoot targets)
//    - 使用中文命名（野獸類型/提示文案）
// ============================================================

// 狩獵區域（世界座標）
const HUNT_Z = -2.2;
const HUNT_X_RANGE = 1.2;
const HUNT_Y_MIN = -0.15;
const HUNT_Y_MAX = 0.75;

let score = 0;
const targetScore = 5;

// 生怪節奏
let spawnCooldown = 0;

// 目標：{ mesh, 類型, ttl, speed, dir }
const huntTargets = [];
let crosshair = null;

function makeCrosshair() {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.035, 0.045, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  );
  m.position.set(0, 0, -0.8);
  return m;
}

function createTargetMesh(類型) {
  // 顏色 + 尺寸（之後可換模型）
  const color =
    類型 === "指定野獸" ? 0x2e2e2e : 類型 === "幼獸" ? 0xbdbdbd : 0xaa3333;

  const size = 類型 === "指定野獸" ? 0.18 : 類型 === "幼獸" ? 0.12 : 0.16;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 16, 12),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(0, 0, HUNT_Z);
  return mesh;
}

function spawnTarget() {
  // 出現機率：指定野獸 55%、幼獸 25%、非指定動物 20%
  const r = Math.random();
  const 類型 = r < 0.55 ? "指定野獸" : r < 0.8 ? "幼獸" : "非指定動物";

  const mesh = createTargetMesh(類型);

  const fromLeft = Math.random() < 0.5;
  const x0 = fromLeft ? -HUNT_X_RANGE : HUNT_X_RANGE;
  const y0 = HUNT_Y_MIN + Math.random() * (HUNT_Y_MAX - HUNT_Y_MIN);

  mesh.position.set(x0, y0, HUNT_Z);

  const speed = 類型 === "指定野獸" ? 0.9 : 類型 === "幼獸" ? 1.2 : 1.1;
  const ttl = 類型 === "指定野獸" ? 1.6 : 類型 === "幼獸" ? 1.4 : 1.5;
  const dir = fromLeft ? 1 : -1;

  scene.add(mesh);
  huntTargets.push({ mesh, 類型, ttl, speed, dir });
}

function clearHunt() {
  for (const t of huntTargets) scene.remove(t.mesh);
  huntTargets.length = 0;
}

function startHuntTask() {
  state = GameState.HUNT;

  score = 0;
  spawnCooldown = 0.4;
  clearHunt();

  if (!crosshair) {
    crosshair = makeCrosshair();
    scene.add(crosshair);
  }

  setStatus("🎯 狩獵開始：只打「指定野獸」！別打「幼獸」或「非指定動物」");
}

function endHuntTask() {
  state = GameState.DONE;

  clearHunt();

  if (crosshair) {
    scene.remove(crosshair);
    crosshair = null;
  }

  setStatus("✅ 狩獵完成！Demo 結束");
}

function updateHunt(dt) {
  // 生怪
  spawnCooldown -= dt;
  if (spawnCooldown <= 0) {
    spawnTarget();
    spawnCooldown = 0.35 + Math.random() * 0.45;
  }

  // 更新目標
  for (let i = huntTargets.length - 1; i >= 0; i--) {
    const t = huntTargets[i];
    t.ttl -= dt;
    t.mesh.position.x += t.dir * t.speed * dt;

    if (t.ttl <= 0) {
      scene.remove(t.mesh);
      huntTargets.splice(i, 1);
    }
  }

  setStatus(
    `🎯 狩獵中：分數 ${score}/${targetScore}（打「指定野獸」+1；打「幼獸/非指定動物」-1）`
  );

  if (score >= targetScore) endHuntTask();
  if (score <= -3) {
    setStatus("⚠️ 誤擊太多！Demo 結束（請重新整理再試）");
    state = GameState.DONE;
  }
}

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

  // 計分（中文類型）
  if (t.類型 === "指定野獸") score += 1;
  else score -= 1;

  // 命中效果
  hitMesh.scale.setScalar(0.6);
  setTimeout(() => {
    scene.remove(hitMesh);
  }, 60);

  huntTargets.splice(idx, 1);
}

// ============================================================
// Pointer events
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

// ---------------- Reset ----------------
function resetAllTasks() {
  // fire objects
  removeFireTaskObjects();

  // hunt objects
  clearHunt();
  if (crosshair) {
    scene.remove(crosshair);
    crosshair = null;
  }

  state = GameState.IDLE;
  fired = false;
  stableTimeFire = 0;
  score = 0;
}

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
