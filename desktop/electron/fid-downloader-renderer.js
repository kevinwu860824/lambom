const fidInput = document.getElementById("fid");
const downloadBtn = document.getElementById("downloadBtn");
const logEl = document.getElementById("log");
const resultEl = document.getElementById("result");
const resultPathEl = document.getElementById("resultPath");
const openFolderBtn = document.getElementById("openFolderBtn");

let lastResultPath = null;

function appendLog(line) {
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

window.fidDownloader.onLog((line) => appendLog(line));

async function startDownload() {
  const fid = fidInput.value.trim();
  if (!fid) {
    appendLog("[提醒] 請先輸入 FID");
    return;
  }

  downloadBtn.disabled = true;
  resultEl.style.display = "none";
  logEl.textContent = "";
  appendLog(`開始下載 FID ${fid} ...`);

  const { ok, resultPath } = await window.fidDownloader.start(fid);

  if (ok) {
    appendLog(`完成!檔案位置:${resultPath}`);
    lastResultPath = resultPath;
    resultPathEl.textContent = resultPath;
    resultEl.style.display = "block";
  } else {
    appendLog("[錯誤] 下載失敗,請檢查上面的訊息。");
  }

  downloadBtn.disabled = false;
}

downloadBtn.addEventListener("click", startDownload);

openFolderBtn.addEventListener("click", () => {
  if (lastResultPath) window.fidDownloader.openFolder(lastResultPath);
});

fidInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startDownload();
});
