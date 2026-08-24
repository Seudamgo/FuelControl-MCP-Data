# FuelControl MCP — Kế hoạch xây dựng

> Sinh ngày **24-08-2026**, dựa trên đọc trực tiếp mã nguồn FuelControl đang chạy thật ở
> `https://fleet.seudambite.com` (backend commit `caf2ff7`). Mọi tên bảng, tên cột, tên endpoint
> trong tài liệu này đều đã kiểm chứng trong code — **không có chỗ nào suy đoán**. Chỗ nào chưa
> tồn tại thì ghi rõ là *chưa có, phải build*.

**Mục lục**
- [0. Ba điều phải đọc trước](#0-ba-điều-phải-đọc-trước) ⚠️
- [1. Việc cần làm](#1-việc-cần-làm)
- [2. Hệ thống hiện có gì rồi](#2-hệ-thống-hiện-có-gì-rồi)
- [3. Kiến trúc](#3-kiến-trúc)
- [4. Giai đoạn A — Hai endpoint báo cáo](#giai-đoạn-a--hai-endpoint-báo-cáo-backend)
- [5. Giai đoạn B — Máy chủ MCP](#giai-đoạn-b--máy-chủ-mcp)
- [6. Giai đoạn C — Báo cáo tự động vào LINE](#giai-đoạn-c--báo-cáo-tự-động-vào-line)
- [7. Quyết định treo](#7-quyết-định-treo--cần-bee-chốt)
- [8. Ước tính](#8-ước-tính)

---

## 0. Ba điều phải đọc trước

Ba điều này đổi hình dạng của cả kế hoạch. Đọc trước khi xem phần còn lại.

### ⚠️ 0.1 — MCP **không** chạy được báo cáo tự động

MCP là giao thức **hỏi–đáp**: một AI (Claude) gọi tool, máy chủ MCP trả lời, hết. Nó **không có
đồng hồ**, không tự thức dậy lúc 7 giờ sáng. Không ai gọi thì nó nằm im.

Nên việc số 3 của Bee — *"báo cáo tự động vào group chat Line"* — **không phải việc của MCP**.
Nó là một cron, và chỗ đúng của nó là backend Go, nằm cạnh 4 cron đã có sẵn.

Việc 3 vì vậy tách làm hai, và **cả hai đều nên làm**:

| | Ai làm | Khi nào chạy |
|---|---|---|
| Báo cáo **tự động** mỗi sáng vào group LINE | cron trong backend Go | 7:00 giờ Bangkok mỗi ngày |
| Bee/Claude **hỏi** số liệu bất kỳ lúc nào | máy chủ MCP | khi Bee gõ câu hỏi |

Hai đường này **dùng chung đúng một nguồn số liệu** (Giai đoạn A). Đây không phải chi tiết kỹ
thuật vụn vặt — nó là luật **N1** của dự án: một công thức chỉ được viết một lần. Để cron tự
viết SQL riêng còn MCP viết SQL riêng là tái tạo đúng cái lỗi đã làm cùng một khoản sửa xe
฿42.000 hiện ra ba con số khác nhau trên ba màn hình.

### ⚠️ 0.2 — LINE **chưa được bật** trên production

Đã kiểm trên máy thật hôm nay:

```
/opt/fuelcontrol/fuelcontrol-infra/.env
  ALERT_WEBHOOK_URL=        ← rỗng
  ALERT_WEBHOOK_TOKEN=      ← rỗng
```

Package `internal/notify` **đã viết xong** và dùng LINE Messaging API. Nhưng token rỗng làm
`Send()` trở thành lệnh rỗng — im lặng bỏ qua, không báo lỗi (đây là chủ đích, để môi trường dev
chạy được). Hệ quả trên prod: **4 cron cảnh báo của hệ thống chưa từng gửi được một tin nào**.

Đó là luật **H1** đang bị vi phạm ngay trên máy đang phục vụ người dùng thật: *"Mọi tiến trình
chạy nền phải có đường báo động ra ngoài khi hỏng."* Backup hỏng lúc 2h sáng thì hiện giờ
không ai biết.

Nên **Giai đoạn C phải bắt đầu bằng việc bật LINE lên**, và việc đó tự nó đã đáng làm dù không
có MCP nào cả.

Còn một khoảng trống nữa: `notify` hiện gửi **broadcast** (mọi người kết bạn với bot đều nhận),
không phải **push vào một group**. Hai thứ này là hai endpoint khác nhau của LINE:

| | Endpoint | Ai nhận |
|---|---|---|
| Đang có | `POST /v2/bot/message/broadcast` | mọi người đã kết bạn với bot |
| Bee cần | `POST /v2/bot/message/push` + `to: <groupId>` | đúng một group chat |

### ⚠️ 0.3 — So xăng dầu với số khách: nói thẳng trước khi build

Bee muốn *"so sánh nhật ký đổ xăng với số lượng khách theo booking"*. Tôi sẽ làm đúng như vậy,
nhưng phải nói rõ một điều trước, để Bee đọc con số ra đúng nghĩa:

**Xăng dầu tiêu hao theo QUÃNG ĐƯỜNG và GIỜ MÁY, không theo số khách.** Một chiếc van chở 2
khách đi Bangkok tốn xăng gần bằng chở 9 khách đi Bangkok. Nên tỉ lệ "lít / khách" **không phải
một chốt phát hiện gian lận** — nó chỉ là một chỉ số xu hướng: tháng này lệch mạnh so với tháng
trước thì đáng đi hỏi tại sao.

Chốt phát hiện gian lận nhiên liệu thật sự đã có sẵn trong hệ: **4 quy tắc đối soát** trong
`internal/fuellogs/service.go`, so lít đổ với đồng hồ km và định mức xe. Báo cáo này nên **hiện
kèm** kết quả đối soát đó (`reconciliation_status`), vì đó mới là thứ trả lời được câu hỏi Bee
đang thật sự lo.

Còn cặp số **đáng soi nhất** trong dữ liệu booking thì lại không phải "khách so với xăng", mà là:

> `trips.booked_pax` (điều phối đặt bao nhiêu chỗ) **so với** `trips.pax` (thực tế đi bao nhiêu người)

Hai cột này đã có sẵn từ migration `0015`, và chênh lệch giữa chúng là tiền thật: đặt 9 chỗ mà
đi 3 người thì hoặc booking sai, hoặc có người bị bỏ lại, hoặc có doanh thu không vào sổ.
Báo cáo sẽ hiện **cả ba** con số cạnh nhau — lít, booked_pax, pax — để Bee tự thấy.

---

## 1. Việc cần làm

Ba việc Bee giao, dịch sang ngôn ngữ dữ liệu:

| # | Bee cần | Nghĩa trong dữ liệu |
|---|---|---|
| 1 | Đếm tài xế/thuyền trưởng **check-in check-out đầy đủ và không đầy đủ** theo ngày | Với mỗi chuyến trong ngày: có đủ **cả hai** dòng `handovers` (`type='checkout'` và `type='checkin'`) chưa. Gom theo người, tách theo `staff.role` |
| 2 | Nhật ký xăng dầu theo ngày **so với** số khách booking điều phối đã điều phối | `fuel_logs` gom theo `filled_at` (ngày đổ THẬT), đặt cạnh `trips.booked_pax` + `trips.pax` cùng ngày |
| 3 | **Báo cáo tự động** vào group chat LINE | cron 7:00 giờ Bangkok → `POST /v2/bot/message/push` |

---

## 2. Hệ thống hiện có gì rồi

Phần này quan trọng: nó quyết định phải viết mới bao nhiêu.

### 2.1 Dữ liệu — **có đủ hết**, không cần thêm bảng nào

| Bảng | Cột dùng tới | Nguồn |
|---|---|---|
| `handovers` | `trip_id` · `type` (`checkout`/`checkin`) · `created_at` · `odometer` | `0003_domain.sql:48` |
| `trips` | `driver_id` · `status` · `scheduled_departure_at` · `planned_end` · `mode` (`land`/`sea`) · `trip_code` | `0003` + `0008` + `0015` |
| `trips` | **`booked_pax`** (điều phối đặt) · **`pax`** (thực tế) | `0015_trip_codes_booking.sql:5` · `0004_phase2.sql:1` |
| `fuel_logs` | **`filled_at`** (ngày đổ thật) · `liters` · `price` · `reconciliation_status` · `is_depot_fill` | `0003` + `0056_fuel_logs_filled_at.sql` |
| `staff` | `role` ∈ `driver`/`captain`/`crew`/`pier_staff` · `name` · `code` | `0009_staff_profiles.sql:11` |

> **Dùng `filled_at`, KHÔNG dùng `created_at`** cho ngày đổ dầu. Migration `0056` tách hai cột này
> có chủ đích: `created_at` là lúc kế toán ngồi nhập (có thể nhập bù mấy ngày một lần), `filled_at`
> là lúc dầu vào bình. Gom nhóm nhầm cột là báo cáo sai ngày mà không ai nhận ra.

### 2.2 Code — có sẵn 3 thứ tái dùng được

| Đã có | Ở đâu | Dùng cho |
|---|---|---|
| **API key có phân quyền** | `internal/apikeys/` (migration `0066`, deploy 24-08-2026) | MCP dùng key `read` để gọi API — đây là lý do tính năng đó vừa được build |
| **LINE Messaging API** | `internal/notify/notify.go` | Gửi tin, nhưng mới có `broadcast` (xem §0.2) |
| **Khuôn cron chạy nền** | 4 cron trong `main.go` | Copy khuôn cho cron báo cáo hằng ngày |

### 2.3 **Chưa có** — đây là phần phải build

| Thiếu | Vì sao không tái dùng được cái đang có |
|---|---|
| Endpoint đếm check-in/out đầy đủ theo ngày | `driverpoints.TallyForDate` đếm **TRỄ**, mà "trễ" gộp chung *không nhận xe* với *nhận xe muộn*. Bee hỏi **có/không**, không hỏi *sớm/muộn* — hai câu hỏi khác nhau |
| Endpoint xăng dầu ↔ booking theo ngày | Không có endpoint nào nối `fuel_logs` với `trips.booked_pax`. `/api/dashboard/cost-series` chỉ trả tiền, không trả lít và không trả khách |
| Push vào group LINE | Xem §0.2 |
| ~~Máy chủ MCP~~ | ✅ **XONG 24-08-2026** — xem Giai đoạn B bên dưới |

---

## 3. Kiến trúc

```
┌──────────────────────────────┐
│  Bee + Claude (máy tính)      │
│  hỏi: "hôm qua ai thiếu       │
│        check-in?"             │
└───────────┬──────────────────┘
            │ MCP (stdio)
            ▼
┌──────────────────────────────┐
│  Máy chủ MCP                  │
│  FuelControl-MCP-Data         │
│  3 tool đọc                   │
└───────────┬──────────────────┘
            │ HTTPS + header X-API-Key
            │ (key scope = CHỈ read)
            ▼
┌───────────────────────────────────────────────┐
│  FuelControl API — fleet.seudambite.com        │
│                                                │
│   GET /api/reports/handover-daily   ← MỚI     │
│   GET /api/reports/fuel-vs-booking  ← MỚI     │
│                                                │
│   cron 7:00 Bangkok ──┐  (gọi CÙNG hàm,       │
│                       │   không viết SQL riêng)│
└───────────────────────┼───────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  LINE group chat  │
              │  push + groupId   │
              └──────────────────┘
```

### Quyết định kiến trúc: MCP gọi **REST API**, không nối thẳng database

Đây là quyết định quan trọng nhất của tài liệu, nên ghi rõ lý do:

| | Gọi REST API ✅ | Nối thẳng Postgres ❌ |
|---|---|---|
| Công thức | Một chỗ duy nhất, trong Go | Chép SQL ra chỗ thứ hai → hai bên trôi lệch |
| Phân quyền | Đi qua RBAC + scope key sẵn có | Bỏ qua sạch, kết nối DB thấy hết mọi thứ |
| Mật khẩu DB | MCP không cần biết | Phải để mật khẩu Postgres trên máy Bee |
| Đổi schema | API che chắn, MCP không gãy | Đổi tên một cột là MCP hỏng câm lặng |
| Cổng mạng | 443 đã mở sẵn | Phải mở 5432 ra Internet — **`/harden` cấm** |

Nối thẳng database thoạt nhìn nhanh hơn, nhưng nó **tạo ra một định nghĩa thứ hai** cho "đầy đủ
nghĩa là gì". Đúng cái đó là gốc của ba lỗi tiền nặng nhất trong `AUDIT-REPORT.md`.

---

## Giai đoạn A — Hai endpoint báo cáo (backend)

> Nền móng của cả hai giai đoạn sau. **Làm xong A rồi mới sang B hoặc C.**
> Repo: `fuelcontrol-backend` · Ước tính **1–2 ngày**

### A1 — `GET /api/reports/handover-daily?date=YYYY-MM-DD` `[M]`

- [ ] Package mới `internal/reports/`, gác sau quyền **mới** `reports.read`

**Trả về:**

```jsonc
{
  "date": "2026-08-23",
  "summary": {
    "driver":  { "people": 8, "trips": 14, "complete": 11, "missingCheckin": 2, "missingCheckout": 0, "missingBoth": 1 },
    "captain": { "people": 3, "trips": 5,  "complete": 5,  "missingCheckin": 0, "missingCheckout": 0, "missingBoth": 0 }
  },
  "incomplete": [
    { "staffName": "GO040-Mr. Worawit", "staffCode": "GO040", "role": "captain",
      "tripCode": "TRIP/SEA/2026/0182", "vehicle": "CAT-02",
      "hasCheckout": true, "hasCheckin": false,
      "scheduledDepartureAt": "...", "plannedEnd": "..." }
  ]
}
```

**Bốn quyết định phải theo cho đúng, không được tự chế:**

1. **Ngày lấy theo `scheduled_departure_at` giờ Bangkok**, không phải `created_at`:
   `(t.scheduled_departure_at AT TIME ZONE 'Asia/Bangkok')::date = $1`.
   Đây là luật **N2** và là đúng cách `driverpoints.TallyForDate` đang làm — lệch đi thì hai màn
   hình cùng một ngày ra hai tập chuyến khác nhau.
2. **Bỏ chuyến `cancelled`**, giữ chuyến `expired`. Huỷ là quyết định của điều phối đã qua kế
   toán duyệt, không phải lỗi người lái; còn `expired` đúng là ca người lái không ra nhận xe.
   Cùng lý lẽ với `driverpoints/repo.go:55-63`.
3. **Bỏ chuyến thuê xe ngoài** (`t.driver_id IS NULL`) — không có người của mình thì không có ai
   để đếm.
4. **Tách `driver` và `captain` bằng `staff.role`**, không đoán từ `trips.mode`. Một thuyền
   trưởng vẫn có thể được điều một chuyến đường bộ.

- [ ] Test: chuyến đủ 2 dòng handover → `complete`; thiếu `checkin` → đúng ô đó; chuyến `cancelled`
      không lọt vào phép đếm; chuyến lúc 23:30 UTC rơi vào **ngày hôm sau** giờ Bangkok

### A2 — `GET /api/reports/fuel-vs-booking?from=&to=` `[M]`

- [ ] Cùng package `internal/reports/`

**Trả về mỗi ngày một dòng:**

```jsonc
{
  "days": [{
    "date": "2026-08-23",
    "fuel":  { "logs": 6, "liters": 412.5, "cost": 15230,
               "reconOk": 4, "reconWarning": 1, "reconSkipped": 1, "depotFills": 2 },
    "trips": { "count": 14, "bookedPax": 96, "actualPax": 88, "paxGap": -8 },
    "litersPerPax": 4.69            // xem §0.3 — chỉ số xu hướng, KHÔNG phải chốt gian lận
  }]
}
```

**Bốn điều phải làm đúng:**

1. **Xăng dầu gom theo `filled_at`**, chuyến gom theo `scheduled_departure_at` — cả hai quy về
   ngày giờ Bangkok. Đây là hai mốc thời gian khác nhau về bản chất, đừng gộp cột.
2. **Hiện `reconciliation_status` kèm theo.** Đó là chốt chống gian lận thật sự (§0.3). Con số
   `reconWarning > 0` đáng chú ý hơn nhiều so với tỉ lệ lít/khách.
3. **Đếm riêng `is_depot_fill`.** Cờ này là đường **duy nhất** tắt được quy tắc đối soát 1, và
   theo `plan.md` mục 4C nó vẫn do chính người nhập tự khai — số này tăng bất thường là tín hiệu.
4. **`litersPerPax` để `null` khi `actualPax = 0`**, đừng trả `0`. Không có khách thì tỉ lệ đó
   không tồn tại; trả `0` đọc ra như "rất tiết kiệm".

- [ ] Test: ngày không có chuyến nào vẫn phải có dòng (giá trị 0), không được biến mất khỏi mảng —
      một ngày trống là một câu trả lời, không phải một lỗ hổng

### A3 — Migration `0067_reports_read.sql` `[S]`

- [ ] Thêm quyền `reports.read`, gán cho `accountant` · `ceo` (admin đi lọt sẵn nhờ bypass)

> Gán cho vai trò thật, **không** để trống như `api_keys.manage`. Đây là báo cáo vận hành hằng
> ngày, không phải cửa quản trị hệ thống.

### A4 — Cấp API key cho MCP `[S]`

- [ ] Vào `fleet.seudambite.com` → tab **API key** → Cấp key mới
- [ ] Chủ key: một tài khoản có `reports.read` · Quyền: **chỉ tick `read`** · Đặt hạn 12 tháng
- [ ] Chép chuỗi key **ngay** (hiện đúng một lần), cất vào `.env` của MCP

---

## Giai đoạn B — Máy chủ MCP

> Repo: `FuelControl-MCP-Data` (đang rỗng) · Ước tính **1–2 ngày**

### B1 — Dựng khung `[M]`

- [x] TypeScript + `@modelcontextprotocol/sdk` 1.30, transport **stdio** (theo khuyến nghị Q1 + Q5)
- [x] `.env` (gitignore) + `.env.example` (key rỗng): `FUELCONTROL_BASE_URL` · `FUELCONTROL_API_KEY`
- [x] Client HTTP gắn sẵn header `X-API-Key`, timeout 15s (`src/client.ts`)

> **Vì sao TypeScript chứ không phải Go** dù cả hệ FuelControl là Go: bộ SDK MCP của TypeScript
> là bản chính thức đầy đủ nhất, và MCP chạy trên **máy của Bee** chứ không phải trên VPS — cài
> bằng `npx` là xong, không phải build nhị phân cho Windows. Đổi lại: thêm một ngôn ngữ nữa vào
> dự án. Nếu Bee muốn giữ một ngôn ngữ duy nhất thì Go cũng có SDK MCP, chỉ tốn thêm bước build.

### B2 — Ba tool `[M]`

| Tool | Tham số | Gọi xuống |
|---|---|---|
| `handover_daily` | `date` (mặc định: hôm qua) | `GET /api/reports/handover-daily` |
| `fuel_vs_booking` | `from`, `to` (mặc định: 7 ngày gần nhất) | `GET /api/reports/fuel-vs-booking` |
| `daily_summary` | `date` | gọi **cả hai** trên, ghép thành một bản tóm tắt |

- [x] Ba tool đã đăng ký, đúng ba, có test canh không ai thêm tool thứ tư bằng tay
- [x] Mô tả tool nói rõ **đơn vị và ý nghĩa** — Claude đọc mô tả để quyết định gọi tool nào.
      Riêng `litersPerPax` ghi thẳng trong mô tả rằng đây là chỉ số xu hướng, không phải
      chốt phát hiện gian lận (§0.3), nếu không Claude sẽ diễn giải nó thành kết luận sai.
      Có test đọc thẳng chuỗi mô tả để câu cảnh báo đó không bị ai rút gọn đi cho "sạch".

### B3 — Xử lý lỗi cho ra hồn `[S]`

- [x] `401 API_KEY_EXPIRED` → nói thẳng *"key hết hạn, cấp key mới ở tab API key"*
- [x] `403 API_KEY_SCOPE` → *"key này thiếu quyền read"*
- [x] Mất mạng → nói rõ là mất mạng, đừng trả mảng rỗng
- [x] **404 → nói thẳng "Giai đoạn A chưa build/deploy"** — thêm ngoài kế hoạch, vì trong giai
      đoạn này của dự án đó gần như luôn là nguyên nhân thật, và nói đúng nguyên nhân tiết kiệm
      cho người đọc cả buổi đi dò cấu hình

> Trả mảng rỗng khi lỗi là kiểu hỏng tệ nhất ở đây: Claude sẽ báo cáo *"hôm qua không ai thiếu
> check-in"* trong khi sự thật là **không hỏi được**. Luật **N3**: hỏng thì đóng, không mở.

- [x] `README.md`: cách cài vào Claude Desktop / Claude Code + cách lấy API key + mục bảo mật

### B4 — Đã làm thêm ngoài kế hoạch `[M]`

Bốn thứ không có trong bản kế hoạch nhưng phát sinh khi thật sự viết code:

- [x] **Chốt địa chỉ đích** (`src/networkPolicy.ts`) — bắt buộc HTTPS, chặn IP nội bộ và cổng
      metadata đám mây. API key đi kèm **mọi** request và sống 12 tháng, nên một cấu hình gõ sai
      không được phép mang nó đi chỗ khác.
- [x] **Không đi theo chuyển hướng** (`redirect: 'manual'`). `fetch` chỉ tự gỡ vài header chuẩn
      khi đổi host; `X-API-Key` là header riêng nên nó sẽ được gửi tiếp sang đích mới — một cú
      302 là đủ để mất key.
- [x] **Phanh gọi API + trần 92 ngày một lần hỏi.** Đầu kia là API đang phục vụ người thật đứng
      ở quầy; một vòng lặp hỏng của agent không được thành đợt tấn công vô tình.
- [x] **Kiểm hình dạng phản hồi bằng zod** (`src/schemas.ts`). Nếu Giai đoạn A được build lệch
      khỏi §A1/§A2 thì lỗi nói thẳng tên trường thiếu, thay vì để một `undefined` trôi xuống lớp
      định dạng rồi hiện ra chữ `NaN` nằm giữa mấy con số thật.

**Kiểm chứng:** 103 test đơn vị + `npm run smoke` chạy toàn tuyến JSON-RPC qua stdio với một API
giả ở localhost (không cần key thật). Đã kiểm bằng đột biến — gỡ từng chốt ở trên ra thì có test
đỏ đúng chỗ. Một bài từng xanh vì lý do sai (chốt giao thức chặn trước nên chốt mạng nội bộ chưa
bao giờ được chạm tới) đã được vá.

> ⛔ **Vẫn chưa hỏi được số liệu thật.** Hai endpoint của Giai đoạn A chưa tồn tại —
> `internal/reports/` chưa có trong `fuelcontrol-backend`. Kiểm bằng `npm run check`.

---

## Giai đoạn C — Báo cáo tự động vào LINE

> Repo: `fuelcontrol-backend` · Ước tính **1 ngày**

### C1 — ⚠️ Bật LINE lên trước đã `[S]`

**Việc này đáng làm ngay dù chưa có MCP** — xem §0.2.

- [ ] Tạo channel **Messaging API** ở LINE Developers Console (không phải "LINE Login")
- [ ] Lấy **Channel access token** → điền `ALERT_WEBHOOK_TOKEN` vào `.env` trên prod
- [ ] Mời bot vào group chat, lấy `groupId`
- [ ] Kiểm: làm một cron hỏng có chủ ý → phải thấy tin trong LINE

> **`groupId` không tra được từ Console.** Nó chỉ đến trong một webhook event khi bot được mời
> vào group. Cách lấy sẽ viết chi tiết vào runbook lúc làm.

### C2 — Thêm `PushToGroup` vào `internal/notify` `[S]`

- [ ] Hàm mới dùng `POST /v2/bot/message/push` + `{"to": groupId, "messages": [...]}`
- [ ] Env mới `LINE_REPORT_GROUP_ID`; để trống → im lặng bỏ qua, **giống hệt** cách `Send` đang
      làm với token rỗng
- [ ] **Giữ nguyên** `Send()` broadcast cho cảnh báo cron — cảnh báo hỏng hóc và báo cáo hằng
      ngày là hai loại tin khác nhau, gộp một kênh thì tin quan trọng chìm giữa tin thường

### C3 — Cron báo cáo hằng ngày `[M]`

- [ ] 7:00 giờ Bangkok, gọi **cùng hàm service** mà endpoint A1/A2 gọi (luật **N1**)
- [ ] `recover()` trong goroutine — plan.md mục 0.10, panic trong goroutine giết cả tiến trình API
- [ ] Env `DAILY_REPORT_ENABLED` để tắt được ở dev
- [ ] Báo cáo **ngày hôm qua**, không phải hôm nay: 7 giờ sáng thì hôm nay chưa có gì để báo

**Bản tin mẫu:**

```
📊 FuelControl — 23/08/2026

🚗 Giao nhận xe
  Tài xế:        11/14 chuyến đủ  ·  3 thiếu
  Thuyền trưởng:  5/5  chuyến đủ

  ⚠️ Thiếu check-in:
    · GO040 Worawit — TRIP/SEA/2026/0182 (CAT-02)

⛽ Xăng dầu
  6 phiếu · 412,5 L · ฿15.230
  Đối soát: 4 ok · 1 CẢNH BÁO · 1 bỏ qua
  Đổ tại kho: 2 phiếu

👥 Khách
  Booking 96  ·  Thực đi 88  ·  lệch −8
```

- [ ] Test: ngày không có dữ liệu → vẫn gửi tin, ghi rõ *"không có chuyến nào"*

> Ngày im lặng và ngày hệ thống hỏng **phải phân biệt được**. Không gửi gì cả thì hai ca đó
> trông giống hệt nhau, và người đọc sẽ học cách bỏ qua sự im lặng.

---

## 7. Quyết định treo — cần Bee chốt

| # | Câu hỏi | Vì sao chặn | Chặn việc nào |
|---|---|---|---|
| ~~**Q1**~~ | ✅ **Đã chốt 24-08-2026: TypeScript**, theo đúng khuyến nghị. Đổi sang Go thì phải viết lại toàn bộ `src/` | — | ~~B1~~ |
| **Q2** | Đã có channel LINE Messaging API chưa, hay phải tạo mới? | Nếu chưa có thì C1 mất thêm ~1 giờ bấm Console | C1 |
| **Q3** | Giờ gửi báo cáo? (đề xuất **7:00** giờ Bangkok) | | C3 |
| **Q4** | Báo cáo gửi **mỗi ngày** hay chỉ gửi **khi có bất thường**? | Ngày nào cũng "mọi thứ ổn" thì người ta ngừng đọc — và ngừng đọc đúng hôm có chuyện | C3 |
| ~~**Q5**~~ | ✅ **Đã chốt 24-08-2026: máy Bee**, transport stdio, theo đúng khuyến nghị. Chuyển sang VPS sau này thì phải làm lại lớp transport và thêm TLS + xác thực đầu vào | — | ~~B1~~ |
| **Q6** | Có cần tool **ghi** không (vd Claude tạo chuyến)? | Kế hoạch này cố ý **chỉ đọc**. Thêm ghi thì key phải có scope `write`, và mọi thứ Claude làm nhầm sẽ vào sổ thật | B2 |

> **Khuyến nghị cho Q4:** gửi mỗi ngày, nhưng **đảo thứ tự** — bất thường lên đầu, tổng kết
> xuống dưới. Ngày sạch thì bản tin ngắn hơn hẳn, và mắt nhận ra sự khác biệt đó trước khi kịp
> đọc chữ.

---

## 8. Ước tính

| Giai đoạn | Nội dung | Thời gian | Chặn ai |
|---|---|---:|---|
| **A** | 2 endpoint + migration + cấp key | 1–2 ngày | chặn cả B lẫn C |
| ~~**B**~~ | ✅ **XONG 24-08-2026** — máy chủ MCP, 3 tool | | |
| **C** | Bật LINE + push group + cron | 1 ngày | cần A |
| | **Tổng** | **3–5 ngày** | |

**Đường găng:** Giai đoạn A chặn cả hai giai đoạn sau, nên làm A trước, xong rồi **B và C chạy
song song được** — chúng không đụng nhau.

**Nếu Bee chỉ làm được một việc:** làm **C1** (bật LINE trên prod). Nó tách rời hoàn toàn khỏi
MCP, mất chưa tới một giờ, và nó vá một lỗ hổng đang tồn tại thật trên máy đang phục vụ người
dùng — hiện giờ backup hỏng lúc 2 giờ sáng thì không ai nhận được tín hiệu nào.

---

*Nguồn: đọc mã nguồn FuelControl 24-08-2026 — `internal/db/migrations/0003·0004·0009·0015·0056·0066`,
`internal/driverpoints/repo.go`, `internal/fuellogs/service.go`, `internal/notify/notify.go`,
`internal/apikeys/`, `main.go`; và kiểm cấu hình thật trên `fleet.seudambite.com`.*
