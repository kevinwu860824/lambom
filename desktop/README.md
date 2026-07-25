# lambom 桌面版

把 lambom 網頁版包成 Windows 桌面程式(視窗形式,不是叫瀏覽器開分頁),另外內建
SAP FID 下載工具(從 `fid_downloader_gui.py` 搬過來的自動化邏輯)。

跟原本的 lambom 網頁專案完全獨立,不會影響 Vercel 上的部署——這整個 `desktop/`
資料夾只在你想包桌面版的時候才需要用到。

## 這裡面有什麼

```
desktop/
  electron/          Electron 桌面殼(視窗、選單、SAP 下載小視窗)
  sap-downloader/     fid_downloader_gui.py 拿掉視窗介面後的命令列版本
```

**主視窗**直接載入 lambom 網頁版的正式網址(不是把 Next.js 打包進 exe),所以
你以後 push 到 main、Vercel 自動部署,桌面版看到的也會自動是最新版本,不用重新
發一次 exe。

**「工具 > SAP 下載」**選單會開一個小視窗(長得像 fid_downloader_gui.py 那個
tkinter 視窗),輸入 FID、按下載,背後會呼叫包好的 `fid_downloader_cli.exe` 去
跑 SAP 自動化,即時把進度顯示出來。下載完只會把 xlsx 存到你的「下載」資料夾,
不會自動上傳——你一樣照現在的習慣,去 lambom 網頁版的「上傳 BOM」手動選檔案。

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
