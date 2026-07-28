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

畫面是「機台編號」+「FID」兩個欄位,填完按「新增」加入下面的佇列(可以一次
排好好幾台),排好之後按「下載(N 台)」才會依序處理,一筆一筆自動跑完不用一直
盯著。FID 打完 blur 掉欄位時,如果「機台編號」還是空的,會自動用
`fid_machine_map` 表查這個 FID 之前存過的機台編號並帶入(可以再手動改)。

一筆一筆手動新增之外,也可以整批用 Excel 匯入:「下載 Excel 範本」會存一份只有
「機台編號」「FID」兩欄標題的 xlsx,填好每一列(不用理會欄位順序,認欄名不認
位置)後用「匯入 Excel」選檔,會把每一列都加進佇列尾端(缺任一欄的列會自動略
過,不會整個檔案匯入失敗)。

**SO 已經不能手動指定了**——每一筆都是拿 FID 透過 VA03 自動反查 SO(細節見下面
「已知限制」)。「機台編號」欄位就是上傳 Supabase 用的機台名稱(machine_name),
不用再另外查表或跳出來問。

佇列裡每一筆會依序做:

1. **完整 BOM**(IB53)→ `<FID>.xlsx`,只存到「下載」資料夾當輔助參考,
   **不會**自動上傳,一樣要去「上傳 BOM」手動匯入。這步失敗不會中斷這一筆,
   會直接繼續下一步。
2. **Modules**(ZOOBOM_CE_FMT)→ 自動反查的 SO 對應輸出 `<SO>_modules.xlsx`。
   ZOOBOM_CE_FMT 原本會一次產生好幾個檔案(檔名由 SAP 決定、儲存格座標也是壞
   的,只有容錯過的解析器讀得出來),程式會自動讀出來、合併成一份座標正常的
   多分頁 xlsx,原始檔案跟中繼檔都會自動清掉。
3. **自動上傳到 Supabase**:合併後 xlsx 裡每個分頁(模組)會各自變成這台機台
   底下的一個子項,上傳完自動跑一次既有的「重要零件自動比對」,並把這個
   FID→機台編號的對應存進 `fid_machine_map`(下次同一個 FID 就會自動帶出來)。

其中一筆處理失敗(不管是哪個步驟)不會中斷整批,會繼續處理佇列裡的下一筆,
失敗的那筆會在清單上標示「失敗」,詳細錯誤看下面的 log。

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
- FID→SO 反查(`resolve_so_from_fid`)如果同一個 FID 的 BOM 改版過,VA03 可能
  搜到不只一筆,目前固定選第一筆,不保證一定是你要的版本——目前還沒遇過選錯,
  之後如果發現抓錯再調整。
