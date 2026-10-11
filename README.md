# 系所行事曆 Dashboard

**線上網址：https://amwayfans.github.io/tsust-dept-calendar/**
**管理後台：https://amwayfans.github.io/tsust-dept-calendar/admin.html**

機械與自動化工程系的系務行事曆。**任何人免登入都能查看**，只有系辦管理員可以新增 / 編輯 / 刪除。

- 前端：純 HTML + CSS + JavaScript（**沒有建置步驟**，可直接在 GitHub 上編輯）
- 月曆元件：FullCalendar 6（CDN）
- 資料庫 / 登入：Supabase（Postgres + Auth + RLS）
- 部署：GitHub Pages（自動，push 後 1–2 分鐘生效）

---

## 檔案結構

```
.
├── index.html                 公開月曆（所有人）
├── records.html               公差/招生記錄
├── admin.html                 管理後台（僅管理員）
├── assets/
│   ├── config.js              ⚙️ 設定（Supabase 連線、類別、標題）
│   ├── common.js              共用工具（連線、時區、事件查詢、登入）
│   ├── calendar.js            月曆頁邏輯
│   ├── records.js             公差/招生記錄頁邏輯（表單、圖表、CSV）
│   ├── records.css            公差/招生記錄頁專屬樣式
│   ├── admin.js               後台 CRUD 邏輯
│   └── styles.css             共用樣式
└── supabase/
    ├── migration.sql          行事曆：events 表 + RLS        ← 必跑
    ├── migration_records.sql  教師記錄：profiles 等 + RLS    ← 必跑
    ├── seed.sql               行事曆測試資料（可選）
    └── seed_roster.sql        教師名冊（19 位）              ← 必跑
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

### 5. 部署到 GitHub Pages（已完成）

本專案已部署，push 到 `main` 之後 1–2 分鐘會自動更新：

**https://amwayfans.github.io/tsust-dept-calendar/**

設定方式（供日後參考）：Repo → **Settings → Pages** → Source 選 `Deploy from a branch` → Branch `main` / `root`。

> 私人 repo 要用 GitHub Pages 需要 GitHub Pro；本專案為免費帳號，因此 repo 設為 **public**。
> 這個網站本來就是公開行事曆，程式碼公開沒有問題——**前提是 `config.js` 裡只有 anon key**。
> 修改檔案後只要 push，GitHub Pages 會自動重新建置，不需要任何額外步驟。

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
| exam 考試 | `#7C3AED` 紫 |
| activity 活動 | `#F59E0B` 橘 |
| holiday 假日 | `#DC2626` 紅 |
| other 其他 | `#64748B` 灰 |

要改顏色或新增類別，編輯 `assets/config.js` 的 `CATEGORIES`，
並同步更新 `supabase/migration.sql` 裡的 `events_category` check 條件。

---

## 介面設計系統

視覺規範由 UI UX Pro Max 產出，風格為 **Swiss Modernism 2.0 × 資料密集型儀表板**，
色盤為 **學術海軍藍 + 金色點綴**。所有樣式權杖都定義在 `assets/styles.css` 的 `:root`，
**改顏色只要改這裡**，三頁（行事曆／公差/招生記錄／管理後台）會一起同步。

| 權杖 | 值 | 用途 |
|---|---|---|
| `--c-primary` | `#1E3A5F` | 頁首底色、主要按鈕、標題 |
| `--c-secondary` | `#2563EB` | 連結、次要強調 |
| `--c-accent` | `#A16207` | 金色點綴（頁首底線、焦點提示） |
| `--c-bg` | `#F8FAFC` | 頁面底色 |
| `--c-surface` | `#FFFFFF` | 卡片底色 |
| `--c-text` | `#0F172A` | 主要文字 |
| `--c-text-2` | `#475569` | 次要文字、說明 |
| `--c-muted` | `#64748B` | 淡文字（**注意：是文字色，不是底色**） |
| `--c-border` | `#CBD5E1` | 框線 |
| `--c-border-soft` | `#E9EEF5` | 淡框線、分隔線 |
| `--c-surface-2` | `#F1F5F9` | 淺色區塊底 |
| `--maxw` / `--gut` | `1180px` / `18px` | 內容寬度與左右留白 |
| `--ring` | 海軍藍光暈 | 輸入框焦點 |

**字型**：Latin 與數字用 `Inter`（Google Fonts），中文用系統字型
（`Noto Sans TC` → `PingFang TC` → `Microsoft JhengHei`）。
數字欄位加 `tabular-nums`，直排時不會跳動。

### 改樣式時的三個地雷

1. **`--c-muted` 是文字色**。它曾經同時被當成「次要文字」和「淺色底」，
   導致 HTML 內嵌的 `color:var(--c-muted)` 幾乎看不見。淺色底請用 `--c-surface-2`。
2. **左右留白只能有一個來源**。頁首用 `--gut`、內容用 `--gut`，
   內容的 `max-width` 要寫成 `calc(var(--maxw) + var(--gut) * 2)`，
   否則卡片會比頁首內縮一個留白寬度，看起來就是沒對齊。
3. **卡片標題要用 `.card h2` 不要用 `.card > h2`**。
   標題若放在 `.toolbar` 裡（例如統計卡）就不是直接子元素，
   會吃不到樣式而變成瀏覽器預設的超大標題。

### 日曆格子裡的文字

月曆格子很窄，事件標題一定會被截斷，所以：

- `.fc-event-title` 有 `text-overflow: ellipsis`，**不會從字中間切一半**
- `calendar.js` 的 `eventDidMount` 會把完整資訊（時間範圍、標題、地點）
  寫進 `title` 屬性，**滑鼠移上去才看得到全名**
- 跨日事件頭尾有圓角，看得出起迄日

新增事件欄位時，記得同步 `eventDidMount` 裡的 tooltip 組合邏輯。

---

## 公差/招生記錄分頁（records.html）

> **手勢切換**：手機上「行事曆 ⇄ 公差/招生記錄」可以直接**左右滑動**切換
> （往左滑去下一頁、往右滑回上一頁），也可以點上方的頁籤。
> 實作在 `assets/common.js`（滑動門檻 55px、手勢需在 0.7 秒內完成、
> 水平位移須大於垂直的 1.5 倍，所以不會跟上下捲動打架；開著視窗時不切頁）。

老師自行登入後輸入「招生」「公差」記錄，系統即時統計成橫式長條圖，
可匯出 CSV 作為教師評鑑參考。

### 啟用步驟

**① 執行資料庫 SQL**（順序很重要）

1. `supabase/migration_records.sql` → 建立 `profiles`、`teacher_roster`、`teacher_records` 與權限規則
2. `supabase/seed_roster.sql` → 匯入 19 位教師名冊

**② 建立教師帳號**

到 Supabase 後台 → **Authentication → Users → Add user**，逐一建立：

- Email：要跟 `teacher_roster` 裡的**完全一致**
- 密碼：設定一組，並**勾選 Auto Confirm User**
- 姓名會由系統自動從名冊帶入，**不需要手動填**

> 帳號建好後，`profiles` 會自動建立並帶入正確姓名。
> 若某個帳號不在名冊中，該帳號登入後**無法新增記錄**，會提示洽系辦。

**③ 指派管理員**

`is_admin()` 目前以 `sr0035@tsust.edu.tw` 判斷（沿用行事曆的設定）。
要換人：改 `supabase/migration.sql` 裡 `is_admin()` 的那行 email，重跑一次。

### 姓名一致性（重要）

教師姓名**一律以 `teacher_roster` 為準**，老師無法自行輸入或修改：

- 寫入時由資料庫 trigger 從 `profiles` 帶入 `teacher_name`，前端送什麼都會被覆蓋
- 因此不可能出現「王小明」與「王 小明」被算成兩個人的情況

要新增／移除老師：改 `seed_roster.sql` 的清單後重跑，或執行

```sql
delete from public.teacher_roster where email = 'xxx@tsust.edu.tw';
```

### 學年度

台灣學年度制：**8/1 ～ 次年 7/31**。

- 115 學年度 = 2026/08/01 ~ 2027/07/31
- 寫入時由資料庫自動計算 `academic_year`，前端不能指定
- 換算函式：`select public.get_academic_year('2026-10-10');` → `115`

### 權限一覽

| 動作 | 訪客 | 教師 | 助理 | 管理員 |
|---|---|---|---|---|
| 看統計圖表 | ✅ | ✅ | ✅ | ✅ |
| 看記錄明細 | ❌ | ✅ | ✅ | ✅ |
| 新增記錄 | ❌ | 只能新增自己的 | 任何人（可代輸入） | 任何人（可代輸入） |
| 編輯／刪除 | ❌ | 只能改自己的 | 任何人 | 任何人 |
| 管理行事曆 | ❌ | ❌ | ❌ | ✅ |
| 匯出 CSV | ✅ | ✅ | ✅ | ✅ |

> 訪客看到的是 `record_stats()` 這支函式回傳的**加總結果**，
> 不含任何一筆的事由、地點。所以「公開統計但不公開明細」是真的做到，
> 不是靠前端把表格藏起來。

### 代輸入

管理員與助理登入後，表單上方會多一個「以哪位教師名義新增」的選單。
代輸入的記錄在列表上會標示「**由管理員代輸入**」，並額外記錄是哪位操作。

**助理的判斷不寫死信箱**，一律看資料庫 `profiles.role`（`admin` 或 `assistant`）。
要新增或移除助理，改 `record_assistants` 這張表即可，前端不必動。

---

## 教師記錄照片（v2）

每筆記錄可以附**一張當日照片**（選填）。

### 存放方式

照片存在 **Supabase Storage 的私有桶 `record-photos`**，
路徑規則 `{teacher_id}/{uuid}.jpg` —— 這個規則同時是 Storage RLS 的判斷依據
（教師只能上傳到自己資料夾，助理／管理員可上傳到任何資料夾）。

私有桶代表**要登入才看得到**，前端用簽章網址（預設 1 小時）顯示。

### 自動同步到 Google Drive

因為網站是靜態的，照片不會直接進 Google Drive。改用排程同步：

```bash
python3 scripts/sync_photos.py
```

排程會把照片整理成
`G:\folder_tmp\AE Dashboard\教師記錄照片\{學年度}\{教師姓名}\{日期}_{事由}_{編號}.jpg`。

- **只新增、不刪除** —— Drive 那份是備份，跟著刪就失去意義。
- 重複執行安全：只下載 Drive 上還沒有的檔案。
- 對應不到記錄的照片會收在 `_未對應\`，不會被丟掉。

### 上傳前的處理

手機照片動輒 4000px、5MB，所以**上傳前先在瀏覽器壓縮**：
等比縮到最長邊 1600px、轉 JPEG（品質 0.82），通常只剩 200～400KB。
這在 `config.js` 可調（`PHOTO_MAX_PX` / `PHOTO_QUALITY`）。

### 照片相關欄位

| 欄位 | 說明 |
|---|---|
| `photo_path` | Storage 內路徑，null = 沒有照片 |
| `photo_name` | 原始檔名，方便人眼對照 |

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
