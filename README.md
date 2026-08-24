# FuelControl MCP — Data

Máy chủ [MCP](https://modelcontextprotocol.io) **chỉ đọc** cho FuelControl. Cắm vào Claude
Desktop hoặc Claude Code là hỏi được số liệu giao nhận xe và xăng dầu bằng tiếng người:

> *"Hôm qua ai thiếu check-in?"*
> *"Tuần này xăng dầu so với khách booking thế nào?"*
> *"Tóm tắt ngày 23/8."*

Kế hoạch đầy đủ ở [PLAN.md](PLAN.md). Repo này là **Giai đoạn B**.

---

## ⚠️ Còn hai việc bấm tay trước khi hỏi được số liệu thật

Hai endpoint MCP gọi xuống **đã được viết xong 24-08-2026** (Giai đoạn A, gói
`internal/reports/` trong `fuelcontrol-backend`):

```
GET /api/reports/handover-daily?date=YYYY-MM-DD
GET /api/reports/fuel-vs-booking?from=&to=
```

Nhưng chúng mới nằm trên **nhánh chưa deploy**, và **chưa ai cấp API key**. Nên còn:

1. Deploy `fuelcontrol-backend` (migration `0067` thêm quyền `reports.read`)
2. Cấp API key — xem mục dưới

Chạy `npm run check` để biết đang vướng cái nào: nó trả lời tách bạch key có sống không, chủ key
có `reports.read` không, và hai endpoint đã lên máy chủ chưa. Endpoint chưa có thì lỗi
`not_built` **nói thẳng nguyên nhân**, không để ai đi dò cấu hình.

---

## Cài

```bash
npm install
npm run build
cp .env.example .env      # rồi điền FUELCONTROL_API_KEY
npm run check             # kiểm key + kiểm hai endpoint đã có chưa
```

### Lấy API key

1. Vào `https://fleet.seudambite.com` → tab **API key** → **Cấp key mới**
2. **Chủ key**: một tài khoản có quyền `reports.read` (mặc định: `accountant`, `ceo`)
3. **Quyền**: chỉ tick **`read`**. Đừng tick `write`/`delete` — máy chủ này không ghi gì cả,
   và một key sống 12 tháng thì mỗi quyền thừa là một quyền nằm chờ bị dùng nhầm.
4. **Hạn**: 12 tháng
5. Chuỗi key hiện **đúng một lần**. Chép ngay vào `.env`. Mất thì cấp key mới, không có
   đường xem lại.

### Cắm vào Claude Desktop

`claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "fuelcontrol": {
      "command": "node",
      "args": ["D:\Fuelcontrol-New\FuelControl-MCP-Data\dist\index.js"],
      "env": {
        "FUELCONTROL_BASE_URL": "https://fleet.seudambite.com",
        "FUELCONTROL_API_KEY": "fc_..."
      }
    }
  }
}
```

### Cắm vào Claude Code

```bash
claude mcp add fuelcontrol -- node D:\Fuelcontrol-New\FuelControl-MCP-Data\dist\index.js
```

Rồi đặt hai biến môi trường ở nơi phiên Claude Code đọc được, hoặc để `.env` cạnh `dist/`.

---

## Ba tool

| Tool | Tham số | Trả về |
|---|---|---|
| `handover_daily` | `date` (bỏ trống = hôm qua) | Chuyến nào trong ngày thiếu check-in/check-out, gom theo tài xế và thuyền trưởng |
| `fuel_vs_booking` | `from`, `to` (bỏ trống = 7 ngày gần nhất) | Mỗi ngày một dòng: lít · tiền · kết quả đối soát · khách đặt · khách thực đi |
| `daily_summary` | `date` (bỏ trống = hôm qua) | Bản tin gộp cả hai, cùng khuôn với tin LINE buổi sáng |

Mọi mốc ngày theo **giờ Bangkok**. Tiền tính bằng **฿ baht Thái**.

### Đọc con số cho đúng

Phần này có trong mô tả tool để Claude đọc, nhưng người dùng cũng nên biết:

- **`reconWarning`** là chốt phát hiện gian lận nhiên liệu **thật sự** — hệ thống so lít đổ với
  đồng hồ km và định mức xe. `reconWarning > 0` là thứ đáng đi hỏi.
- **`litersPerPax`** **KHÔNG** phải bằng chứng gian lận. Xăng dầu tiêu hao theo quãng đường và
  giờ máy, không theo số khách: một chiếc van chở 2 khách đi Bangkok tốn xăng gần bằng chở 9
  khách. Chỉ dùng để so tháng này với tháng trước. Giá trị `null` nghĩa là không có khách nào
  đi nên tỉ lệ không tồn tại — **không phải bằng 0**.
- **`paxGap`** = khách thực đi − chỗ đã đặt. Đặt 9 chỗ mà đi 3 người là tiền thật: hoặc booking
  sai, hoặc có người bị bỏ lại, hoặc có doanh thu không vào sổ.
- **`depotFills`** là số phiếu tự khai "đổ tại kho" — đường **duy nhất** tắt được một quy tắc
  đối soát. Số này tăng bất thường là một tín hiệu.

---

## Bảo mật

Áp theo skill `mcp-server-security`, cắt bớt cho đúng hình dạng thật: **stdio · chạy trên máy
người dùng · chỉ đọc**. Có ba mục trong bảng kiểm của skill không áp dụng, ghi rõ ở dưới thay
vì lặng lẽ bỏ.

| Chốt | Ở đâu | Vì sao |
|---|---|---|
| Bắt buộc HTTPS ra ngoài | `src/networkPolicy.ts` | API key đi kèm **mọi** request; http trần là ai đứng giữa cũng đọc được |
| Chặn IP nội bộ + cổng metadata đám mây | `src/networkPolicy.ts` | Một cấu hình gõ sai không được phép mang key đi chỗ khác |
| **Không đi theo chuyển hướng** | `src/client.ts` | `fetch` chỉ tự gỡ vài header chuẩn khi đổi host — `X-API-Key` là header riêng nên sẽ được gửi tiếp. Một cú 302 là đủ để mất key |
| GET đóng cứng, đường dẫn theo danh sách | `src/client.ts` | Không có đường nào cho agent tự đặt path hay method |
| Kiểm đầu vào trước khi gọi API | `src/dates.ts` · zod trong `src/tools/` | Ngày sai dạng và ngày không có thật bị chặn tại chỗ, chưa rời khỏi máy |
| Trần 92 ngày một lần hỏi | `src/dates.ts` | Một câu buột miệng "cho xem cả năm ngoái" không được biến thành truy vấn nặng trên database đang phục vụ người thật |
| Phanh gọi API | `src/rateLimit.ts` | Vòng lặp hỏng của agent không được thành đợt tấn công vô tình |
| Trần dung lượng phản hồi | `src/client.ts` | 8 MB |
| Nhật ký có che chuỗi bí mật | `src/audit.ts` | Ghi ra **stderr**, xem mục dưới |
| Kiểm hình dạng phản hồi | `src/schemas.ts` | Giai đoạn A build lệch spec thì báo ngay tên trường, không để `NaN` trôi vào bản tin |
| Lỗi không bao giờ thành dữ liệu rỗng | `src/tools/run.ts` | Xem mục dưới |

**Ba mục của skill không áp dụng ở đây, và lý do:**

- *TLS / mTLS / OAuth 2.1 cho transport* — máy chủ này chạy stdio dưới tiến trình Claude trên
  máy người dùng, không mở cổng nào. Không có gì để bọc TLS. Chuyển sang HTTP (PLAN.md §7 Q5)
  thì phải làm lại toàn bộ mục 3 và 4 của skill.
- *Phân quyền tool theo vai trò* — chỉ có một người dùng và cả ba tool đều chỉ đọc. Vai trò
  thật đã được gác ở phía server bằng RBAC + scope key.
- *Seccomp / network policy / container non-root* — không chạy trong container.

### Hai chỗ cố ý làm khác mẫu chung của skill

**1. Nhật ký đi stderr, không đi stdout.** Mẫu §9.1 của skill ghi JSON log ra stdout. Với
transport stdio, **stdout LÀ đường truyền JSON-RPC** — một dòng log lọt vào đó là chèn rác vào
giữa giao thức, client đứt kết nối kèm một lỗi phân tích JSON không nói gì về nguyên nhân thật.
Có test canh (`tests/audit.test.ts`) và `npm run smoke` cũng bắt được nếu ai đó vô tình
`console.log`.

**2. Lỗi không bao giờ trả về kết quả rỗng.** Đây là luật **N3** của dự án ("hỏng thì đóng,
không mở") áp vào lớp MCP. Trả mảng rỗng khi gọi API thất bại là kiểu hỏng tệ nhất ở đây:
Claude sẽ đọc mảng rỗng rồi báo cáo *"hôm qua không ai thiếu check-in"*, trong khi sự thật là
**không hỏi được**. Mọi lỗi trả về `isError` kèm một câu nói thẳng rằng đây là lỗi.

### Đây là máy chủ CHỈ ĐỌC

Không có tool nào ghi được vào FuelControl, và method HTTP đóng cứng là `GET`. Thêm tool ghi là
một quyết định (PLAN.md §7 Q6), không phải một bước tiện tay — key sẽ phải có scope `write`, và
mọi thứ Claude làm nhầm sẽ vào sổ thật.

---

## Phát triển

```bash
npm test          # 103 test đơn vị
npm run typecheck
npm run build
npm run smoke     # chạy thử toàn tuyến với API giả, không cần key thật
npm run check     # kiểm key + endpoint thật (cần .env)
```

`npm run smoke` là phép kiểm đáng chạy nhất trước khi commit: nó dựng một API giả ở localhost,
spawn máy chủ MCP đã build, và nói chuyện với nó bằng đúng giao thức JSON-RPC — thứ mà test đơn
vị không chạm tới.

### Hợp đồng với backend

`tests/fixtures/*.json` là phản hồi **thật** của backend, chụp trên Postgres thật với đủ 67
migration bằng:

```bash
cd ../fuelcontrol-backend
REPORTS_TEST_DSN=... REPORTS_CONTRACT_OUT=<đường-dẫn>/tests/fixtures   go test ./internal/reports/ -run TestDumpContractJSON
```

`tests/contract.test.ts` cho zod ăn chính hai tệp đó. Schema ở repo này và câu SQL ở repo kia nằm
trong hai ngôn ngữ khác nhau và không có gì buộc chúng đi cùng nhau — ngày backend đổi tên một
trường, đây là thứ duy nhất phát hiện ra. **Bản mẫu lệch thì chụp lại, đừng nới lỏng schema cho
vừa.**

### Sửa gì thì nhớ

- **Không `console.log` ở bất cứ đâu.** Mọi thông báo đi `process.stderr`.
- Thêm endpoint mới thì thêm vào `ENDPOINTS` trong `src/client.ts` — không có đường nào khác.
- Đổi hình dạng phản hồi ở Giai đoạn A thì sửa `src/schemas.ts` cho khớp, và sửa cả PLAN.md.
