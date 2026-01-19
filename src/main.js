import "./style.css";
import * as THREE from "three";

// ---------- DOM ----------
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

// ---------- Device Camera ----------
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

    // Reset placement/game state
    resetGame();
    enableFloorDetection();
    scanGrid = createScanGrid();
    scene.add(scanGrid);
    setStatus("請對準地面並緩慢移動以偵測平面…");
    if (scanGrid) scene.remove(scanGrid);
    scanGrid = null;
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

  resetGame();
  setStatus("相機已關閉");
}

btnStart.addEventListener("click", startCamera);
btnStop.addEventListener("click", stopCamera);

if (!navigator.mediaDevices?.getUserMedia) {
  setStatus("此瀏覽器不支援 getUserMedia");
  btnStart.disabled = true;
}

// ---------- Three.js ----------
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

// ---------- "Ground" setup (fake AR plane) ----------
const groundY = -0.6; // 我們的「地面」高度（世界座標）
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);

// ---------- Game Objects (created on placement) ----------
const fireRadius = 0.6;
const STABLE_SECONDS = 2.5;

let fireCircle = null;
let woods = [];
let flame = null;
let scanGrid = null;
const MAX_PLACE_RADIUS = 1.2; // 限制放置距離：避免點太遠看不到

let anchor = new THREE.Vector3(0, groundY, 0); // 放置點（火堆中心）

// ---------- Interaction / State ----------
canvas.style.pointerEvents = "auto";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let floorReady = false;     // "地面已偵測到"
let placingMode = false;    // 正在等待玩家點一下放置
let gameStarted = false;    // 物件已生成，可開始拖拉/判定
let fired = false;

let dragging = null;

let stableTime = 0;
let lastT = performance.now();

function resetGame() {
  // 移除舊物件
  if (fireCircle) scene.remove(fireCircle);
  for (const w of woods) scene.remove(w);
  if (flame) scene.remove(flame);

  fireCircle = null;
  woods = [];
  flame = null;

  anchor.set(0, groundY, 0);

  floorReady = false;
  placingMode = false;
  gameStarted = false;
  fired = false;

  dragging = null;

  stableTime = 0;
  lastT = performance.now();

  btnPlace.disabled = true;
  btnPlace.textContent = "準備放置";
}

// ---------- Floor detection (tilt-based, works without WebXR) ----------
function enableFloorDetection() {
  floorReady = false;
  btnPlace.disabled = true;
  btnPlace.textContent = "準備放置";

  const requestIOSPermission = async () => {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") throw new Error("DeviceOrientation permission denied");
    }
  };

  const onOrientation = (e) => {
    // beta: 前後傾角（度）
    const beta = e.beta;
    if (typeof beta !== "number") return;

    // 當手機朝向地面（大概 55~90 度）視為「地面就緒」
    if (!floorReady && beta > 55) {
      floorReady = true;
      btnPlace.disabled = false;
      setStatus("已偵測到地面 ✅ 按「準備放置」後，點一下地面放置火堆");
    }
  };

  requestIOSPermission()
    .then(() => {
      window.addEventListener("deviceorientation", onOrientation, true);
    })
    .catch(() => {
      // 沒有 orientation 權限或不支援：退而求其次，允許直接放置
      floorReady = true;
      btnPlace.disabled = false;
      setStatus("裝置未提供地面偵測；仍可按「準備放置」並點一下地面放置火堆");
    });
}

// ---------- Create objects on placement ----------
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

function createScanGrid() {
  // 一個地面網格，半透明，讓玩家知道「地面在哪」
  const grid = new THREE.GridHelper(4, 20, 0x00ffaa, 0x00ffaa);
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.position.set(0, groundY, 0);

  // GridHelper 預設是 XZ 平面，本來就符合地面，不用旋轉
  return grid;
}

function createWood(localX, localZ, rotY = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
  );
  mesh.position.set(anchor.x + localX, anchor.y, anchor.z + localZ);
  mesh.rotation.y = rotY;
  return mesh;
}

function startGameAt(pointOnGround) {
  if (gameStarted) return;

  anchor.set(pointOnGround.x, groundY, pointOnGround.z);

  fireCircle = createFireCircle();
  woods = [
    createWood(-0.6, 0.3, 0.2),
    createWood(0.6, 0.2, -0.4),
    createWood(0.2, -0.6, 0.9),
  ];

  scene.add(fireCircle);
  if (scanGrid) {
    scene.remove(scanGrid);
    scanGrid = null;
  }
  woods.forEach((w) => scene.add(w));

  gameStarted = true;
  placingMode = false;
  btnPlace.disabled = true;
  btnPlace.textContent = "已放置";

  stableTime = 0;
  setStatus("把木頭拖進圈內並保持穩定");
}

// ---------- Placement button ----------
btnPlace.addEventListener("click", () => {
  if (!floorReady) return;

  placingMode = true;
  btnPlace.textContent = "點一下地面…";
  setStatus("請在畫面上點一下你要放火堆的位置（地面）");
});

// ---------- Drag / Place Controls ----------
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
  // 1) 放置模式：點一下地面放置火堆
  if (placingMode && !gameStarted) {
    const p = getPointOnGround(event);

    // 沒打到地面就不放
    if (!p) return;

    // 距離限制：避免放到很遠看不到
    const dx = p.x - scanGrid.position.x;
    const dz = p.z - scanGrid.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > MAX_PLACE_RADIUS) {
      setStatus("太遠了！請在掃描網格附近點一下放置");
      return;
    }

    startGameAt(p);
    return;
  }

  // 2) 遊戲未開始，不能拖
  if (!gameStarted || fired) return;

  // 3) 拖拉木頭
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(woods);
  if (hits.length > 0) {
    dragging = hits[0].object;
  }
}

function onPointerMove(event) {
  if (!dragging || fired || !gameStarted) return;

  const p = getPointOnGround(event);
  if (!p) return;

  dragging.position.x = p.x;
  dragging.position.z = p.z;
  dragging.position.y = groundY;
}

function onPointerUp() {
  dragging = null;
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// ---------- Stability Check ----------
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

  // 視覺回饋：進度越高圈越亮
  fireCircle.material.opacity = 0.4 + 0.6 * progress;

  if (stableTime >= STABLE_SECONDS) igniteFire();
}

// ---------- Render loop ----------
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastT) / 1000;
  lastT = now;

  updateScanGrid();
  updateStability(dt);
  renderer.render(scene, camera);
}

function updateScanGrid() {
  if (!scanGrid || gameStarted) return;

  // 用相機中心射線 (0,0) 去打地面
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const p = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(groundPlane, p);

  if (hit) {
    // 永遠放在視線前方的地面
    scanGrid.position.set(p.x, groundY, p.z);
    anchor.set(p.x, groundY, p.z);

    // 視覺提示：地面就緒 vs 正在找地面
    scanGrid.material.opacity = floorReady ? 0.5 : 0.2;
  } else {
    // 如果沒打到地面（例如鏡頭朝天），就淡出
    scanGrid.material.opacity = 0.1;
  }
}
animate();


