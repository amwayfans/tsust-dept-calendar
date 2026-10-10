# 系所行事曆 Dashboard

機械與自動化工程系的系務行事曆。**任何人免登入都能查看**，只有系辦管理員可以新增 / 編輯 / 刪除。

- 前端：純 HTML + CSS + JavaScript（**沒有建置步驟**，可直接在 GitHub 上編輯）
- 月曆元件：FullCalendar 6（CDN）
- 資料庫 / 登入：Supabase（Postgres + Auth + RLS）
- 部署：GitHub Pages（或任何靜態網頁空間）

---

## 檔案結構

```
.
├── index.html                 公開月曆（所有人）
├── admin.html                 管理後台（僅管理員）
├── assets/
│   ├── config.js              ⚙️ 設定（Supabase 連線、類別、標題）
│   ├── common.js              共用工具（連線、時區、事件查詢、登入）
│   ├── calendar.js            月曆頁邏輯
│   ├── admin.js               後台 CRUD 邏輯
│   └── styles.css             樣式
└── supabase/
    ├── migration.sql          資料表 + RLS + is_admin()  ← 必跑
    └── seed.sql               測試資料（可選）
```

---

## 快速開始

### 1. 建立資料表

到 Supabase 後台 → 你的專案 → **SQL Editor** → 貼上 `supabase/migration.sql` 整份 → Run。

> 可以重複執行，不會出錯。
> **換管理員**：改 `migration.sql` 裡 `is_admin()` 的那個 email，再跑一次。

（可選）想先看到畫面有東西，再跑 `supabase/seed.sql` 寫入幾筆測試資料。

### 2. 建立管理員帳號

Supabase 後台 → **Authentication → Users → Add user**：

- Email：`sr0035@tsust.edu.tw`（要跟 `is_admin()` 裡的一致）
- Password：設定一組密碼
- **勾選 Auto Confirm User**（否則會卡在信箱驗證）

接著到 **Authentication → Providers → Email**，**關閉「允許公開註冊」**，避免有人自己註冊帳號。

### 3. 設定前端連線

打開 `assets/config.js`，填入：

```js
SUPABASE_URL: 'https://你的專案.supabase.co',
SUPABASE_ANON_KEY: '你的 publishable / anon key',
ADMIN_EMAIL: 'sr0035@tsust.edu.tw',
```

> ⚠️ 這裡只放 **publishable / anon key**。`service_role` key **絕對不可以**放在前端或進版控。
> anon key 本來就是設計給瀏覽器用的，真正把關的是資料庫的 RLS。

### 4. 本機預覽

不用安裝任何東西，只要一個靜態伺服器：

```bash
python3 -m http.server 8080
# 開啟 http://localhost:8080
```

（直接用 `file://` 開也可以，但用 http 伺服器比較不會遇到瀏覽器限制。）

### 5. 部署到 GitHub Pages

1. 把專案 push 到 GitHub
2. Repo → **Settings → Pages**
3. Source 選 `Deploy from a branch`，Branch 選 `main` / `root`
4. 等 1–2 分鐘，網址會是 `https://<帳號>.github.io/<repo>/`

> 私人 repo 要用 GitHub Pages 需要 GitHub Pro；免費帳號請把 repo 設為 public。
> 這個網站本來就是公開行事曆，程式碼公開沒有問題——**前提是 `config.js` 裡只有 anon key**。

---

## 權限設計

| 角色 | 可以做的事 |
|---|---|
| 訪客（未登入） | 讀取 `visibility = department` 的事件 |
| 管理員（登入後） | 讀取全部（含 private）、新增、編輯、刪除 |

權限**全部由資料庫的 RLS 控制**，不是靠前端把按鈕藏起來：

- 訪客就算打開開發者工具、直接呼叫 Supabase API 寫入，也會被 RLS 拒絕。
- 前端隱藏按鈕只是為了介面乾淨，不是安全機制。

想自己驗證這件事，可以用 curl 直接試著寫入（把 `<ANON_KEY>` 換成你的 key）：

```bash
curl -i -X POST "https://<專案>.supabase.co/rest/v1/events" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"title":"測試","start_at":"2026-01-01T00:00:00Z","end_at":"2026-01-01T01:00:00Z"}'
```

應該會回 **401 / 403**（RLS 擋下），而不是新增成功。

---

## 時區

- 資料庫一律存 **UTC**（`timestamptz`）
- 畫面一律顯示 **Asia/Taipei**
- 台灣全年固定 UTC+8、沒有日光節約時間，所以 `common.js` 直接用固定位移換算，不引入額外套件。

---

## 類別與顏色

| 類別 | 顏色 |
|---|---|
| meeting 會議 | `#2563EB` 藍 |
| course 課程 | `#16A34A` 綠 |
| exam 考試 | `#DC2626` 紅 |
| activity 活動 | `#F59E0B` 橘 |
| holiday 假日 | `#7C3AED` 紫 |
| other 其他 | `#64748B` 灰 |

要改顏色或新增類別，編輯 `assets/config.js` 的 `CATEGORIES`，
並同步更新 `supabase/migration.sql` 裡的 `events_category` check 條件。

---

## 響應式設計

| 寬度 | 行為 |
|---|---|
| ≥ 768px | 月曆檢視（dayGridMonth） |
| < 768px | 自動切換為議程列表（listMonth），可手動切回月曆 |

---

## 常見問題

**畫面顯示「資料表尚未建立」**
→ `supabase/migration.sql` 還沒執行，或跑失敗了。到 SQL Editor 重跑一次。

**登入後仍看不到「新增事件」按鈕**
→ `config.js` 的 `ADMIN_EMAIL` 要和資料庫 `is_admin()` 裡的 email 一致，且大小寫相同。

**登入成功但寫入被拒**
→ 帳號不是 `is_admin()` 指定的那個 email。前端會自動登出非管理員帳號。

**月曆上跨日事件少一天**
→ 全天事件的 `end` 在 FullCalendar 是「不含」的，程式已自動 +1 天；若自行改動 `calendar.js` 的 `toFcEvent()` 要留意這點。
