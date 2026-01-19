import './style.css'

const video = document.getElementById("video");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const statusEl = document.getElementById("status");

let stream = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function startCamera() {
  if (stream) return;

  try {
    // 建議：優先後鏡頭（environment）
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
    setStatus("相機已啟動（後鏡頭優先）");
  } catch (err) {
    console.error(err);
    stream = null;

    // 常見原因：非 HTTPS、權限被拒、裝置不支援
    setStatus(`啟動失敗：${err.name}`);
    alert(
      `相機啟動失敗：${err.name}\n\n` +
        `請確認：\n` +
        `1) 網址是 HTTPS（手機必須）\n` +
        `2) 已允許相機權限\n` +
        `3) 使用 Safari/Chrome 最新版`
    );
  }
}

function stopCamera() {
  if (!stream) return;

  for (const track of stream.getTracks()) track.stop();
  stream = null;

  video.srcObject = null;
  btnStart.disabled = false;
  btnStop.disabled = true;
  setStatus("相機已關閉");
}

btnStart.addEventListener("click", startCamera);
btnStop.addEventListener("click", stopCamera);

// 提醒：如果瀏覽器不支援
if (!navigator.mediaDevices?.getUserMedia) {
  setStatus("此瀏覽器不支援 getUserMedia");
  btnStart.disabled = true;
}
