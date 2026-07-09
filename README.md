# lambom

BOM(物料清單)比對工具。從 Supabase 讀取多台機器的 BOM 資料,選擇兩份進行差異比對。

Next.js (App Router) + Tailwind v4 + shadcn/ui,UI 風格延續 gallery205_admin_web。

## 開發

```bash
npm install
cp .env.example .env.local  # 填入 Supabase URL / anon key
npm run dev
```

## 環境變數

見 `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
