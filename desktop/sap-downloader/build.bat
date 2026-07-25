@echo off
REM 在 Windows 上執行這支批次檔，把 fid_downloader_cli.py 包成單一 exe。
REM 產出結果在 dist\fid_downloader_cli.exe，Electron 會直接讀取這個路徑。

pip install -r requirements.txt
pyinstaller --onefile --console --name fid_downloader_cli fid_downloader_cli.py

echo.
echo 完成！exe 在 dist\fid_downloader_cli.exe
pause
