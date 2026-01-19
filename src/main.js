import "./style.css";
import * as THREE from "three";

// ---------------- DOM ----------------
const video = document.getElementById("video");
const canvas = document.getElementById("three");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnPlace = document.getElementById("btnPlace");
const statusEl = document.getElementById("status");

let stream = null;
function setStatus(msg) {
  statusEl.textContent = msg;
}

// ---------------- Device camera ----------------
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

    resetAll();
    ensureScanGrid();
    setStatus("相機已啟動。按「準備放置」以啟用地面偵測（iPhone 需要授權）");
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

  resetAll();
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

// Three 的相機（後面會接手機陀螺儀旋轉）
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

// ---------------- "Fake AR plane" model ----------------
/**
 * 這是一個「不用 WebXR」的穩定 Demo 作法：
 * - 用固定高度平面 y=groundY 當作地面
 * - 掃描網格永遠跟著「相機中心射線」打到地面的交點，讓玩家永遠看得到
 * - 放置後移除網格 & 鎖定 anchor
 * - 再用 deviceorientation 去轉動 three camera（3DOF），提升「物件固定在世界」的感覺
 */
const groundY = -0.6;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);

// 放置限制：避免點太遠導致物件出畫
const MAX_PLACE_RADIUS = 1.2;

// ---------------- Game objects ----------------
const fireRadius = 0.6;
const STABLE_SECONDS = 2.5;

let scanGrid = null;
let fireCircle = null;
let woods = [];
let flame = null;

// anchor = 火堆中心（放置點）
const anchor = new THREE.Vector3(0, groundY, 0);

// ---------------- State ----------------
canvas.style.pointerEvents = "auto";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let motionListening = false;
let floorReady = false; // 用「傾角 beta > 55°」當作地面就緒信號
let placingMode = false;
let gameStarted = false;
let fired = false;

let dragging = null;

let stableTime = 0;
let lastT = performance.now();

// --- Camera gyro control (3DOF) ---
let camControlEnabled = false;
let baseYaw = 0; // 校正初始 yaw，避免一開始方向亂飄

// ---------------- Reset / cleanup ----------------
function resetAll() {
  removeGameObjects();
  removeScanGrid();

  // motion
  motionListening = false;
  floorReady = false;

  // modes
  placingMode = false;
  gameStarted = false;
  fired = false;

  // drag + timer
  dragging = null;
  stableTime = 0;
  lastT = performance.now();

  // camera control
  camControlEnabled = false;
  baseYaw = 0;

  // UI
  btnPlace.disabled = false; // 允許按，以便觸發 iOS motion 授權
  btnPlace.textContent = "準備放置";

  // 將相機姿態回到預設（避免上一局殘留）
  camera.quaternion.identity();
  camera.position.set(0, 0, 2);
}

function removeGameObjects() {
  if (fireCircle) scene.remove(fireCircle);
  for (const w of woods) scene.remove(w);
  if (flame) scene.remove(flame);

  fireCircle = null;
  woods = [];
  flame = null;

  anchor.set(0, groundY, 0);
}

function removeScanGrid() {
  if (scanGrid) scene.remove(scanGrid);
  scanGrid = null;
}

// ---------------- iOS motion permission ----------------
async function requestMotionPermissionIfNeeded() {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res !== "granted") throw new Error("Motion permission not granted");
  }
}

// ---------------- Scan grid ----------------
function createScanGrid() {
  const grid = new THREE.GridHelper(4, 20, 0x00ffaa, 0x00ffaa);
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  grid.position.set(anchor.x, groundY, anchor.z);
  return grid;
}

function ensureScanGrid() {
  if (scanGrid) return;
  scanGrid = createScanGrid();
  scene.add(scanGrid);
}

/**
 * 每一幀用相機中心射線（0,0）打地面
 * - scanGrid 跟著交點走，永遠在可視位置（不會跑很遠）
 * - 只有在「尚未放置」時更新；放置後 gameStarted=true 就停止
 */
function updateScanGrid() {
  if (!scanGrid || gameStarted) return;

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const p = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(groundPlane, p);

  if (hit) {
    scanGrid.position.set(p.x, groundY, p.z);
    // placing 前，anchor 只是「建議放置點」；真正放置後會鎖定
    anchor.set(p.x, groundY, p.z);

    scanGrid.material.opacity = floorReady ? 0.55 : 0.2;
  } else {
    scanGrid.material.opacity = 0.1;
  }
}

// ---------------- DeviceOrientation -> Three camera (3DOF) ----------------
function applyDeviceOrientationToCamera(e) {
  const alpha = e.alpha ?? 0; // yaw-ish
  const beta = e.beta ?? 0; // pitch
  const gamma = e.gamma ?? 0; // roll

  const deg2rad = Math.PI / 180;
  const a = (alpha - baseYaw) * deg2rad;
  const b = beta * deg2rad;
  const g = gamma * deg2rad;

  // 常見轉換：deviceorientation (ZXY) -> quaternion
  const zee = new THREE.Vector3(0, 0, 1);
  const euler = new THREE.Euler();
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X

  euler.set(b, a, -g, "ZXY");
  camera.quaternion.setFromEuler(euler);
  camera.quaternion.multiply(q1);

  // 螢幕方向補償
  const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * deg2rad;
  q0.setFromAxisAngle(zee, -orient);
  camera.quaternion.multiply(q0);
}

// ---------------- "Floor readiness" via tilt + camera control ----------------
let orientationHandler = null;

function startMotionListening() {
  if (motionListening) return;

  orientationHandler = (e) => {
    // 1) 用 beta 做「地面就緒」提示
    const beta = e.beta;
    if (typeof beta === "number") {
      if (!floorReady && beta > 55) {
        floorReady = true;
        setStatus("已偵測到地面 ✅ 請在掃描網格附近點一下放置火堆");
      }
    }

    // 2) 套用旋轉到 three camera，讓物件更像固定在世界（3DOF）
    if (camControlEnabled) {
      applyDeviceOrientationToCamera(e);
    }
  };

  window.addEventListener("deviceorientation", orientationHandler, true);
  motionListening = true;
}

// ---------------- Create game objects ----------------
function createFireCircle() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(fireRadius - 0.02, fireRadius, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.85,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(anchor);
  return mesh;
}

function createWood(localX, localZ, rotY = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
  );
  mesh.position.set(anchor.x + localX, groundY, anchor.z + localZ);
  mesh.rotation.y = rotY;
  return mesh;
}

function startGameAt(pointOnGround) {
  if (gameStarted) return;

  // 重要：放置後鎖定 anchor（不再被 updateScanGrid 改動）
  anchor.set(pointOnGround.x, groundY, pointOnGround.z);

  fireCircle = createFireCircle();
  woods = [
    createWood(-0.6, 0.3, 0.2),
    createWood(0.6, 0.2, -0.4),
    createWood(0.2, -0.6, 0.9),
  ];

  scene.add(fireCircle);
  woods.forEach((w) => scene.add(w));

  // 放置後移除掃描網格，畫面乾淨
  removeScanGrid();

  gameStarted = true;
  placingMode = false;
  fired = false;

  stableTime = 0;

  btnPlace.disabled = true;
  btnPlace.textContent = "已放置";
  setStatus("把木頭拖進圈內並保持穩定");
}

// ---------------- Place button ----------------
btnPlace.addEventListener("click", async () => {
  if (!stream) {
    setStatus("請先開啟相機");
    return;
  }

  ensureScanGrid();

  // 第一次按：iOS motion 授權（必須手勢觸發），並啟用相機旋轉控制
  if (!motionListening) {
    try {
      await requestMotionPermissionIfNeeded();
      startMotionListening();
      camControlEnabled = true;

      // 校正 yaw：讓此刻朝向視為 0
      baseYaw = 0; // 先清
      setStatus("請對準地面並緩慢移動以偵測平面…");
    } catch (e) {
      // 沒授權也不阻止 Demo：仍可放置，但 floorReady 可能不會變 true
      startMotionListening();
      camControlEnabled = true;
      setStatus("未取得動作/方向授權；仍可點一下地面放置火堆（掃描網格仍會顯示）");
    }
  } else {
    // 已在 listening：確保相機控制開著
    camControlEnabled = true;
  }

  placingMode = true;
  btnPlace.textContent = "點一下地面…";
  setStatus("請在掃描網格附近點一下地面放置火堆");
});

// ---------------- Pointer interaction ----------------
function setPointer(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function getPointOnGround(event) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const p = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(groundPlane, p);
  return hit ? p : null;
}

function onPointerDown(event) {
  // 放置模式：點一下放置火堆（限制在掃描網格附近，避免太遠）
  if (placingMode && !gameStarted) {
    const p = getPointOnGround(event);
    if (!p) return;

    if (scanGrid) {
      const dx = p.x - scanGrid.position.x;
      const dz = p.z - scanGrid.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > MAX_PLACE_RADIUS) {
        setStatus("太遠了！請在掃描網格附近點一下放置");
        return;
      }
    }

    // 即使 floorReady 尚未 true 也允許放置，避免 iOS 權限卡死
    startGameAt(p);
    return;
  }

  // 遊戲未開始或已點燃：不可拖
  if (!gameStarted || fired) return;

  // 拖拉木頭
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(woods);
  if (hits.length > 0) dragging = hits[0].object;
}

function onPointerMove(event) {
  if (!dragging || fired || !gameStarted) return;

  const p = getPointOnGround(event);
  if (!p) return;

  dragging.position.set(p.x, groundY, p.z);
}

function onPointerUp() {
  dragging = null;
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// ---------------- Stability logic ----------------
function allWoodsInside() {
  if (!fireCircle) return false;

  const cx = anchor.x;
  const cz = anchor.z;

  return woods.every((w) => {
    const dx = w.position.x - cx;
    const dz = w.position.z - cz;
    return Math.sqrt(dx * dx + dz * dz) < fireRadius;
  });
}

function igniteFire() {
  if (fired) return;
  fired = true;

  fireCircle.material.color.set(0xff3300);
  fireCircle.material.opacity = 1;

  setStatus("🔥 生火成功");

  flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xff5522 })
  );
  flame.position.set(anchor.x, groundY + 0.25, anchor.z);
  scene.add(flame);
}

function updateStability(dt) {
  if (!gameStarted || fired) return;

  const inside = allWoodsInside();
  if (inside) stableTime += dt;
  else stableTime = 0;

  const progress = Math.min(stableTime / STABLE_SECONDS, 1);
  const pct = Math.round(progress * 100);

  if (inside) setStatus(`穩定中：${pct}%`);
  else setStatus("把木頭拖進圈內並保持穩定");

  fireCircle.material.opacity = 0.4 + 0.6 * progress;

  if (stableTime >= STABLE_SECONDS) igniteFire();
}

// ---------------- Render loop ----------------
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastT) / 1000;
  lastT = now;

  // 放置前：掃描網格跟著視線中心更新
  updateScanGrid();

  // 放置後：物件位置已鎖定，只有相機姿態會跟著手機旋轉 -> 看起來更像固定在世界
  updateStability(dt);

  renderer.render(scene, camera);
}
animate();
