// lambom 網頁版的正式網址(Vercel 部署後的網址)。
// 主視窗會直接載入這個網址,不會把網頁打包進 exe 裡——
// 這樣以後 push 到 main、Vercel 自動部署,exe 打開看到的就是最新版本,
// 不用重新發一次 exe。
//
// 已經實際測試過,這個網址載入起來就是正式的 lambom(標題正確顯示「BOM 比對
// 工具」),如果之後換了網域記得回來改這裡。
module.exports = {
  LAMBOM_URL: "https://lambom.vercel.app",
};
