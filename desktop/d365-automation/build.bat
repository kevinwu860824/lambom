@echo off
REM 在 Windows 上執行這支批次檔，把 d365_order_cli.py 包成單一 exe。
REM 產出結果在 dist\d365_order_cli.exe，Electron 會直接讀取這個路徑。

REM playwright 這個套件公司內部的 pip 鏡像（Artifactory）沒有代理，
REM requirements.txt 裡已經加了 --index-url 直接接官方 PyPI，兩個套件一起裝。
pip install -r requirements.txt
playwright install msedge
pyinstaller --noconfirm --clean --noupx --onefile --console --name d365_order_cli d365_order_cli.py

echo.
echo 完成！exe 在 dist\d365_order_cli.exe
pause
