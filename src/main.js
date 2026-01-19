import "./style.css";
import * as THREE from "three";

// ---------- DOM ----------
const video = document.getElementById("video");
const canvas = document.getElementById("three");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
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
    setStatus("相機已啟動");
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

const light = new THREE.HemisphereLight(0xffffff, 0x222222, 1.2);
scene.add(light);

// Resize
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Campfire Objects ----------
const fireRadius = 0.6;
const groundY = -0.6;

const fireCircle = new THREE.Mesh(
  new THREE.RingGeometry(fireRadius - 0.02, fireRadius, 32),
  new THREE.MeshBasicMaterial({
    color: 0xffaa33,
    transparent: true,
    opacity: 0.85,
  })
);
fireCircle.rotation.x = -Math.PI / 2;
fireCircle.position.set(0, groundY, 0);
scene.add(fireCircle);

const woods = [];

function createWood(x, z, rot = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
  );
  mesh.position.set(x, groundY, z);
  mesh.rotation.y = rot;
  scene.add(mesh);
  woods.push(mesh);
}

createWood(-0.6, 0.3, 0.2);
createWood(0.6, 0.2, -0.4);
createWood(0.2, -0.6, 0.9);

// ---------- Drag Controls ----------
/**
 * 讓 canvas 可接收觸控：
 * 你需要把 style.css 的 #three pointer-events 改成 auto
 * 如果你已經改了可忽略。
 */
canvas.style.pointerEvents = "auto";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = null;

function setPointer(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onPointerDown(event) {
  if (fired) return;

  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(woods);
  if (hits.length > 0) {
    dragging = hits[0].object;
  }
}

function onPointerMove(event) {
  if (!dragging || fired) return;

  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  // 平面：y = groundY
  // Plane 定義：normal · p + constant = 0
  // 對 y=groundY => y + constant = 0 => constant = -groundY
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
  const point = new THREE.Vector3();

  if (raycaster.ray.intersectPlane(plane, point)) {
    dragging.position.x = point.x;
    dragging.position.z = point.z;
  }
}

function onPointerUp() {
  dragging = null;
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// ---------- Stability Check (2~3s) ----------
const STABLE_SECONDS = 2.5; // ✅ 你要的穩定秒數（可調 2.0~3.0）
let stableTime = 0;
let lastT = performance.now();
let fired = false;

function allWoodsInside() {
  const cx = fireCircle.position.x;
  const cz = fireCircle.position.z;

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

  // 簡單火焰假象（可換粒子）
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xff5522 })
  );
  flame.position.set(0, groundY + 0.25, 0);
  scene.add(flame);
}

function updateStability(dt) {
  if (fired) return;

  const inside = allWoodsInside();

  if (inside) {
    stableTime += dt;
  } else {
    stableTime = 0;
  }

  const progress = Math.min(stableTime / STABLE_SECONDS, 1);
  const pct = Math.round(progress * 100);

  if (inside) {
    setStatus(`穩定中：${pct}%`);
  } else {
    setStatus("把木頭拖進圈內並保持穩定");
  }

  // 視覺回饋：進度越高圈越亮
  fireCircle.material.opacity = 0.4 + 0.6 * progress;

  if (stableTime >= STABLE_SECONDS) {
    igniteFire();
  }
}

// ---------- Render loop ----------
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastT) / 1000;
  lastT = now;

  updateStability(dt);
  renderer.render(scene, camera);
}
animate();
