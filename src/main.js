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

// ---------- Camera (device) ----------
async function startCamera() {
  if (stream) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" }, // 後鏡頭優先
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

// ---------- Three.js ----------
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,      // 透明，才能看到底下 video
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();

// 這是「Three.js 的相機」（不是手機相機）
// 我們用它來渲染 3D 疊在畫面上
const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
camera.position.set(0, 0, 2);

const light = new THREE.HemisphereLight(0xffffff, 0x222222, 1.2);
scene.add(light);

// 一個測試方塊（之後你把它換成木頭、準星、野獸）
const box = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.4, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x66ccff })
);
scene.add(box);

// Resize：讓 canvas 尺寸跟螢幕同步
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// Render loop
function animate() {
  requestAnimationFrame(animate);

  box.rotation.y += 0.01;
  box.rotation.x += 0.006;

  renderer.render(scene, camera);
}
animate();

// 支援性提示
if (!navigator.mediaDevices?.getUserMedia) {
  setStatus("此瀏覽器不支援 getUserMedia");
  btnStart.disabled = true;
}
