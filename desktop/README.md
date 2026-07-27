# lambom 桌面版

把 lambom 網頁版包成 Windows 桌面程式(視窗形式,不是叫瀏覽器開分頁),另外內建
SAP FID 下載工具(從 `fid_downloader_gui.py` 搬過來的自動化邏輯)。

跟原本的 lambom 網頁專案完全獨立,不會影響 Vercel 上的部署——這整個 `desktop/`
資料夾只在你想包桌面版的時候才需要用到。

## 這裡面有什麼

```
desktop/
  electron/          Electron 桌面殼(視窗、preload 橋接)
  sap-downloader/     fid_downloader_gui.py 拿掉視窗介面後的命令列版本
```

**主視窗**直接載入 lambom 網頁版的正式網址(不是把 Next.js 打包進 exe),所以
你以後 push 到 main、Vercel 自動部署,桌面版看到的也會自動是最新版本,不用重新
發一次 exe。

**「SAP 下載」不是獨立視窗,是內嵌在 `/machines`(編輯機台)頁面裡的一個區塊**
(`components/fid-downloader-panel.tsx`),透過 `window.fidDownloader`(preload
注入)判斷是不是在桌面版裡執行,一般瀏覽器打開同一個網址完全看不到這塊。

- **FID** 欄位 → 完整 BOM(IB53),輸出 `<FID>.xlsx`
- **SO** 欄位(選填,留空會用 FID 反查)→ Modules(ZOOBOM_CE_FMT),輸出
  `<SO>_modules.xlsx`,裡面每個模組一個分頁

ZOOBOM_CE_FMT 原本會一次產生好幾個檔案(檔名由 SAP 決定、儲存格座標也是壞
的,只有容錯過的解析器讀得出來),程式會自動把這些原始檔案讀出來、合併成一份
座標正常的多分頁 xlsx,原始檔案跟 Tool BOM 用的中繼 txt 都會自動清掉,你拿到
的永遠是「一份」乾淨的 xlsx。

兩個欄位填哪個就跑哪個,都填就依序都跑。下載完只會把檔案存到你的「下載」資料
夾,不會自動上傳——你一樣照現在的習慣,去 lambom 網頁版的「上傳 BOM」手動選
檔案。

## 設定正式網址

編輯 `electron/config.js`,把 `LAMBOM_URL` 換成 lambom 實際的 Vercel 正式網址。

## 開發 / 測試(macOS 也能跑主視窗部分)

```bash
cd desktop/electron
npm install
npm start
```

這樣可以在 Mac 上測試視窗殼本身(主視窗、選單、SAP 下載小視窗的畫面/log 顯示
邏輯)。但「SAP 下載」按下去實際會不會動,只能在裝了 SAP GUI 的 Windows 機器
上驗證,因為 `fid_downloader_cli.py` 用的 `win32com` 是 Windows 專屬的 COM
自動化,Mac 上完全跑不起來。

## 在 Windows 上包成正式 exe

**第一步:先包 SAP 下載工具**

```bat
cd desktop\sap-downloader
build.bat
```

會產出 `desktop\sap-downloader\dist\fid_downloader_cli.exe`。這一步可以先單獨
用命令列測試,確認 SAP 自動化真的能動,再繼續下一步：

```bat
dist\fid_downloader_cli.exe 264059
```

(把 264059 換成你要測試的真實 FID,跑完應該會在目前資料夾看到 `264059.xlsx`,
最後一行印出 `RESULT_PATH:...`。)

測試 Modules(需要真實 SO):

```bat
dist\fid_downloader_cli.exe --mode modules --so R0542
```

跑完應該會在目前資料夾看到一份 `R0542_modules.xlsx`,裡面每個模組一個分頁
(SAP 原始產生的多個檔案已經自動合併、清除)。

**第二步:包 Electron 桌面版**

```bat
cd desktop\electron
npm install
npm run dist
```

`electron-builder` 設定裡已經指定會把上一步產出的 `fid_downloader_cli.exe` 一併
打包進去(`extraResources`),完成後在 `desktop\electron\dist\` 會看到安裝檔
(`.exe` NSIS 安裝程式)。

## 已知限制 / 之後可以做的事

- 目前沒有圖示(app icon),electron-builder 會用預設圖示。如果要換成自訂圖示,
  在 `electron/build/icon.ico` 放一個 256x256 的 .ico,並在 `package.json` 的
  `build.win` 底下加 `"icon": "build/icon.ico"`。
- 目前沒有簽章(code signing),Windows SmartScreen 可能會跳出警告,這跟現在
  BOM Manager 的 exe 是一樣的狀況,內部工具通常可以接受。
- 下載工具目前只知道 FID,不知道對應機台名稱——這是刻意的(你選的是「兩步驟：
  先下載、再手動上傳」,上傳時機台名稱一樣在 lambom 網頁版的上傳視窗手動輸入)。
