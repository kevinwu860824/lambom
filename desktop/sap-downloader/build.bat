@echo off
REM 在 Windows 上執行這支批次檔，把 fid_downloader_cli.py 跟 inventory_lookup_cli.py 各自包成單一 exe。
REM 產出結果在 dist\fid_downloader_cli.exe 跟 dist\inventory_lookup_cli.exe，Electron 會直接讀取這兩個路徑。

pip install -r requirements.txt
pyinstaller --onefile --console --name fid_downloader_cli fid_downloader_cli.py
pyinstaller --onefile --console --name inventory_lookup_cli inventory_lookup_cli.py

echo.
echo 完成！exe 在 dist\fid_downloader_cli.exe 跟 dist\inventory_lookup_cli.exe
pause
