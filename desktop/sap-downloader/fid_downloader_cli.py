r"""
FID BOM Downloader (CLI 版)
---------------------------
跟 fid_downloader_gui.py 是同一套 SAP 自動化邏輯(IB53 搜尋 + 展開匯出 +
轉存 Excel),差別只在這支沒有自己的 tkinter 視窗——改成純命令列工具,
專門給 lambom 桌面版(Electron)呼叫用:Electron 負責畫視窗、顯示進度,
這支負責真正去跑 SAP。

使用方式：
    fid_downloader_cli.exe <FID> [--out-dir 輸出資料夾]                      (預設 tool 模式,完整 BOM,單一 xlsx)
    fid_downloader_cli.exe --mode modules --so <SO> [--out-dir 輸出資料夾]   (Module BOM,ZOOBOM_CE_FMT,輸出到一個資料夾,裡面多個檔案)

行為：
- 進度訊息一行一行印到 stdout(供呼叫端即時顯示)。
- tool 模式執行成功的最後一行一定是 `RESULT_PATH:<輸出的 xlsx 完整路徑>`；
  modules 模式則是 `RESULT_PATH:<輸出資料夾路徑>`(資料夾裡有多個檔案)，
  呼叫端可以用這個 marker 抓出結果檔案位置，不用去猜字串。
- 任何失敗都印 `[錯誤] ...` 並以非 0 的 exit code 結束。

使用前提（跟 fid_downloader_gui.py 一樣）：
1. Windows 電腦，SAP 帳號是自動登入(SSO)，不需要手動打帳密。
2. 先安裝套件：pip install pywin32 openpyxl
3. SAP GUI Scripting 要是開啟狀態。
4. SAP_PORTAL_URL 換成你自己的公司 Portal 開啟 SAP 那個連結。

打包成 exe（在 Windows 上執行）：
    pip install pyinstaller
    pyinstaller --onefile --console --name fid_downloader_cli fid_downloader_cli.py
   （這支要保留 console 輸出，不能加 --noconsole，Electron 要讀 stdout。）
"""

import argparse
import os
import subprocess
import sys
import time

import win32com.client
import openpyxl

# 被 Electron 當子程序執行時,stdout/stderr 沒有接到真正的主控台,Windows 上
# Python 預設會退回 cp1252 之類編不了中文的編碼,一印中文 log 就會
# UnicodeEncodeError 崩潰。強制改成 utf-8,編不了的字元用替代符號頂著,不當機。
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# 公司 Portal 裡「開啟 SAP」那個連結的網址，開這個網址會透過 SSO 自動幫你連進 SAP。
# 這是你個人的 navurl，換人用要換成那個人自己的連結。
SAP_PORTAL_URL = (
    "https://epp.fremont.lamrc.net/irj/portal"
    "?NavigationTarget=navurl://e9dc0731c19963b952ca3fbeceed6db3"
)
SAP_PROCESS_NAMES = ["saplogon.exe", "sapgui.exe"]


def log(msg):
    print(msg, flush=True)


# ---------- SAP 自動化邏輯(跟 fid_downloader_gui.py 完全相同) ----------

def is_sap_process_running():
    """用 tasklist 檢查 SAP 相關程序是否在跑。"""
    try:
        output = subprocess.check_output(
            ["tasklist"], text=True, errors="ignore",
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception:
        return False
    output_lower = output.lower()
    return any(name in output_lower for name in SAP_PROCESS_NAMES)


def kill_sap_processes():
    for name in SAP_PROCESS_NAMES:
        subprocess.run(
            ["taskkill", "/F", "/IM", name],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    time.sleep(2)


def launch_sap_logon():
    """模擬你平常點公司 Portal 連結開 SAP 的動作：直接開網址，交給預設瀏覽器 + SSO 處理。"""
    os.startfile(SAP_PORTAL_URL)


def try_connect_sap():
    """嘗試連線並簡單測試一下是否真的可用，成功回傳 session，失敗回傳 None。"""
    try:
        sap_gui_auto = win32com.client.GetObject("SAPGUI")
        application = sap_gui_auto.GetScriptingEngine
        if application.Children.Count == 0:
            return None
        connection = application.Children(0)
        if connection.Children.Count == 0:
            return None
        session = connection.Children(0)
        _ = session.Info.SystemName  # 順手測試一下 session 是否真的能動
        return session
    except Exception:
        return None


def ensure_sap_connected(max_wait_seconds=120):
    """
    確保 SAP 已連線並回傳可用的 session：
      1. 先測試目前有沒有能用的連線，能連就直接用
      2. 連不上但 SAP 程序有在跑 -> 砍掉重開
      3. SAP 根本沒開 -> 直接啟動
      4. 啟動後輪詢等待自動登入(SSO) + Scripting 註冊完成
    """
    log("測試目前 SAP 連線...")
    session = try_connect_sap()
    if session is not None:
        log("已有可用連線，直接使用。")
        return session

    if is_sap_process_running():
        log("偵測到 SAP 程序在跑但連不上，砍掉重開...")
        kill_sap_processes()
    else:
        log("SAP 目前沒有開啟，準備啟動...")

    log("啟動 SAP Logon...")
    launch_sap_logon()

    log("等待 SAP 自動登入、Scripting 就緒...")
    waited = 0
    interval = 2
    while waited < max_wait_seconds:
        time.sleep(interval)
        waited += interval
        session = try_connect_sap()
        if session is not None:
            log(f"SAP 連線成功（等待約 {waited} 秒）。")
            return session
        if waited % 10 == 0:
            log(f"還在等待登入完成...（已等 {waited} 秒）")

    raise RuntimeError(f"等了 {max_wait_seconds} 秒仍無法連上 SAP，請確認自動登入是否正常完成。")


def open_ib53_with_fid(session, fid):
    session.findById("wnd[0]/tbar[0]/okcd").text = "/nIB53"
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(1)

    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOF-IBASE").text = "0"
    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOF-IBASE").caretPosition = 1
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(1)

    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOFO-EQUNO").setFocus()
    session.findById("wnd[0]/usr/subENTRANCE:SAPLIBOF_R3:0100/ctxtRIBOFO-EQUNO").caretPosition = 0
    session.findById("wnd[0]").sendVKey(4)  # F4 -> 搜尋輔助
    time.sleep(1)

    # Tab 5 = "F: Equipment by technical ID number"
    session.findById("wnd[1]/usr/tabsG_SELONETABSTRIP/tabpTAB005").select()
    session.findById(
        "wnd[1]/usr/tabsG_SELONETABSTRIP/tabpTAB005"
        "/ssubSUBSCR_PRESEL:SAPLSDH4:0220/sub:SAPLSDH4:0220/txtG_SELFLD_TAB-LOW[0,24]"
    ).text = fid

    session.findById("wnd[1]/tbar[0]/btn[0]").press()
    session.findById("wnd[1]/tbar[0]/btn[0]").press()
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(3)


def export_installed_base(session, save_path, filename):
    tree = session.findById("wnd[0]/shellcont/shell/shellcont[1]/shell[0]")
    tree.pressButton("IBOCX_AUFR")
    tree.pressContextButton("&PRINT_BACK")
    tree.selectContextMenuItem("&PRINT_PREV_ALL")

    session.findById("wnd[0]/mbar/menu[3]/menu[5]/menu[2]/menu[1]").select()

    session.findById(
        "wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[1,0]"
    ).select()
    session.findById("wnd[1]/tbar[0]/btn[0]").press()

    session.findById("wnd[1]/usr/ctxtDY_PATH").text = save_path
    session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = filename
    session.findById("wnd[1]/tbar[0]/btn[0]").press()

    # 存完之後按 3 次 F3 退回到基礎畫面,讓 session 回到乾淨狀態(跟 Script
    # Recording 錄製結果一致),避免殘留畫面影響後面接著跑 Modules。
    session.findById("wnd[0]").sendVKey(3)
    session.findById("wnd[0]").sendVKey(3)
    session.findById("wnd[0]").sendVKey(3)


def resolve_so_from_fid(session, fid):
    """
    用 FID 反查對應的 SO——開 VA03、對 Sales Document 欄位按 F4,切到分頁
    「A: Sales document according to customer PO number」,用 FID 當
    wildcard(<FID>*)搜尋,選搜尋結果清單第一筆,再讀回 VA03 訂單欄位
    (VBAK-VBELN)確認選到的 SO。這段已經用 SAP GUI 的 Script Recording and
    Playback 錄過、逐行對過。

    已知風險(使用者確認過,不是我猜的):同一個 FID 如果 BOM 改版過,可能
    會搜到不只一筆結果。這裡目前固定選清單第一筆,不保證一定是你要的那個
    版本——如果之後發現抓到的 SO 不對,要再調整規則(例如改成選最後一筆,
    或是先列出所有結果讓你自己選)。
    """
    session.findById("wnd[0]/tbar[0]/okcd").text = "VA03"
    session.findById("wnd[0]/tbar[0]/btn[0]").press()
    session.findById("wnd[0]").sendVKey(4)
    time.sleep(1)

    session.findById(
        "wnd[1]/usr/tabsG_SELONETABSTRIP/tabpTAB001"
        "/ssubSUBSCR_PRESEL:SAPLSDH4:0220/sub:SAPLSDH4:0220/txtG_SELFLD_TAB-LOW[2,24]"
    ).text = f"{fid}*"
    session.findById("wnd[1]").sendVKey(0)
    time.sleep(1)

    session.findById("wnd[1]/usr/lbl[1,3]").caretPosition = 10
    session.findById("wnd[1]").sendVKey(2)
    time.sleep(1)

    so = (session.findById("wnd[0]/usr/ctxtVBAK-VBELN").text or "").strip()
    if not so:
        raise RuntimeError(
            "用 FID 反查 SO 失敗,VA03 的訂單欄位讀不到值——可能卡在某個清單"
            "畫面需要人工確認(例如出現不只一筆搜尋結果),請檢查 SAP 畫面,"
            "或改成直接輸入 SO。"
        )

    log(f"從 VA03 反查到 SO:{so}")
    return so


def download_module_bom(session, so, out_dir):
    """
    Module BOM 下載——完整流程已經用 SAP GUI 的 Script Recording and
    Playback 錄過、逐行對過:
      1. 交易代碼輸入 /nZOOBOM_CE_FMT,按 Enter
      2. Sales Document 欄位(S_VBELN-LOW)輸入 SO
      3. Folder 欄位(P_FOLDER)按 F4,跳出資料夾選擇視窗,用跟 Tool BOM
         匯出一樣的 DY_PATH 欄位指定輸出資料夾、按確認
      4. 按 Execute(tbar[1]/btn[8],F8)——ZOOBOM_CE_FMT 會自動把多個
         Excel 檔案直接寫進剛剛指定的資料夾,不會再跳出任何存檔視窗
      5. 按 2 次 F3 返回

    跟 Tool BOM 不同,這裡不知道 SAP 會產生幾個檔案、確切檔名是什麼(由
    ZOOBOM_CE_FMT 自己決定),所以用「執行前後資料夾內容的差異」來抓出
    新產生的檔案,而不是等單一固定檔名。
    """
    os.makedirs(out_dir, exist_ok=True)
    before = set(os.listdir(out_dir))

    session.findById("wnd[0]/tbar[0]/okcd").text = "/nZOOBOM_CE_FMT"
    session.findById("wnd[0]").sendVKey(0)
    time.sleep(1)

    session.findById("wnd[0]/usr/ctxtS_VBELN-LOW").text = so

    session.findById("wnd[0]/usr/ctxtP_FOLDER").setFocus()
    session.findById("wnd[0]/usr/ctxtP_FOLDER").caretPosition = 0
    session.findById("wnd[0]").sendVKey(4)  # F4 -> 資料夾選擇
    time.sleep(1)

    session.findById("wnd[1]/usr/ctxtDY_PATH").text = out_dir
    session.findById("wnd[1]/usr/ctxtDY_PATH").setFocus()
    session.findById("wnd[1]/usr/ctxtDY_PATH").caretPosition = len(out_dir)
    session.findById("wnd[1]/tbar[0]/btn[0]").press()
    time.sleep(1)

    session.findById("wnd[0]/tbar[1]/btn[8]").press()  # Execute (F8)
    time.sleep(3)

    session.findById("wnd[0]").sendVKey(3)
    session.findById("wnd[0]").sendVKey(3)

    log("等待 SAP 寫入檔案...")
    new_files = []
    for _ in range(30):
        time.sleep(1)
        after = set(os.listdir(out_dir))
        new_files = sorted(after - before)
        if new_files:
            time.sleep(2)  # 再多等一下,確保檔案是不是還在陸續寫入
            after = set(os.listdir(out_dir))
            new_files = sorted(after - before)
            break

    if not new_files:
        raise RuntimeError("等不到新的檔案,請檢查 SAP 畫面是否卡住,或確認輸出資料夾是否正確。")

    return [os.path.join(out_dir, name) for name in new_files]


def parse_tab_export(txt_path):
    with open(txt_path, encoding="utf-8-sig", errors="replace") as f:
        lines = f.readlines()
    rows = []
    for line in lines:
        line = line.rstrip("\n")
        if not line.strip():
            continue
        tokens = [t.strip() for t in line.split("\t") if t.strip() != ""]
        if len(tokens) != 4:
            continue
        desc, record, qty, unit = tokens
        indent = len(line) - len(line.lstrip("\t"))
        rows.append((record, desc, indent, qty, unit))
    return rows


def write_bom_xlsx(rows, out_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "BOM"
    ws.append(["Part Number", "Description", "Indent(raw tab depth)", "Qty", "Unit"])
    for record, desc, indent, qty, unit in rows:
        try:
            qty_val = float(qty)
        except ValueError:
            qty_val = qty
        ws.append([record, desc, indent, qty_val, unit])
    wb.save(out_path)


# ---------- CLI 進入點 ----------

def run(fid, out_dir, mode="tool", so=None):
    if mode == "modules":
        if not so and not fid:
            raise RuntimeError("Module BOM 下載需要 SO 或 FID(沒有 SO 的話,會用 FID 自動反查)。")

        session = ensure_sap_connected()

        if not so:
            log(f"沒有輸入 SO,改用 FID {fid} 反查對應的 SO...")
            so = resolve_so_from_fid(session, fid)

        module_dir = os.path.join(out_dir, f"{so}_modules")
        log(f"開啟 ZOOBOM_CE_FMT,用 SO {so} 執行...")
        files = download_module_bom(session, so, module_dir)

        log(f"完成!共產生 {len(files)} 個檔案:")
        for f in files:
            log(f"  - {f}")
        return module_dir

    os.makedirs(out_dir, exist_ok=True)
    txt_name = f"{fid}.txt"
    xlsx_name = f"{fid}.xlsx"
    txt_path = os.path.join(out_dir, txt_name)

    session = ensure_sap_connected()

    log(f"開啟 IB53，用 FID {fid} 搜尋設備...")
    open_ib53_with_fid(session, fid)

    log("展開結構並匯出...")
    export_installed_base(session, out_dir, txt_name)

    log("等待 SAP 寫入檔案...")
    for _ in range(60):
        if os.path.exists(txt_path):
            break
        time.sleep(1)
    else:
        raise RuntimeError("等不到匯出的檔案，請檢查 SAP 畫面是否卡住。")

    log("解析並轉存成 Excel...")
    rows = parse_tab_export(txt_path)
    if not rows:
        raise RuntimeError("解析出 0 筆資料，請打開 txt 檔確認格式。")

    xlsx_path = os.path.join(out_dir, xlsx_name)
    write_bom_xlsx(rows, xlsx_path)

    log(f"完成！共 {len(rows)} 筆料號。")
    return xlsx_path


def main():
    parser = argparse.ArgumentParser(description="用 FID/SO 從 SAP 下載 BOM，轉存成 xlsx")
    parser.add_argument("fid", nargs="?", default=None, help="要查詢的 FID(tool 模式需要)")
    parser.add_argument("--out-dir", default=os.getcwd(), help="輸出資料夾(預設目前工作目錄)")
    parser.add_argument(
        "--mode",
        choices=["tool", "modules"],
        default="tool",
        help="tool = 完整 BOM(IB53,預設,需要 FID);modules = 依模組拆分(ZOOBOM_CE_FMT,需要 SO)",
    )
    parser.add_argument("--so", default=None, help="SO 號碼(modules 模式需要)")
    args = parser.parse_args()

    if args.mode == "tool" and not args.fid:
        log("[錯誤] tool 模式需要 FID。")
        sys.exit(1)

    try:
        fid = args.fid.strip() if args.fid else None
        so = args.so.strip() if args.so else None
        xlsx_path = run(fid, args.out_dir, args.mode, so)
    except Exception as e:
        log(f"[錯誤] {e}")
        sys.exit(1)

    log(f"RESULT_PATH:{xlsx_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
