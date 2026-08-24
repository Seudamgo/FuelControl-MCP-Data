# Nối Claude vào FuelControl

Tài liệu MỘT TRANG cho người dùng cuối. Không cần biết gì về Docker hay MCP.

**Hai đường, chọn một:**

| | Dùng khi | Cần cầm chìa khoá không |
|---|---|---|
| [A. Claude app / web](#a--claude-app--web-oauth) | Người dùng thường, kể cả CEO | **Không** — đăng nhập Fleet như mọi khi |
| [B. Claude Code](#b--claude-code-chìa-khoá-api) | Lập trình viên, script | Có |

---

## A — Claude app / web (OAuth)

Đường này **không ai phải cầm một chuỗi bí mật nào**. Bấm Connect, đăng nhập
Fleet, bấm Đồng ý, xong.

1. Trong Claude: **Settings → Connectors → Add custom connector**
2. Đường dẫn: `https://fleet.seudambite.com/mcp`
3. Mở **Advanced settings**, điền:
   - **OAuth Client ID**: `fleet-claude`
   - **Client Secret**: **để TRỐNG**
4. **Add** → **Connect** → trình duyệt mở màn đăng nhập Fleet → **Đồng ý**

> **Vì sao phải điền Client ID bằng tay:** máy chủ cố ý không làm Dynamic Client
> Registration — đó là một cửa công khai ai gọi cũng được, và bỏ nó là bớt một
> bề mặt tấn công. `fleet-claude` **không phải bí mật**, nó chỉ là tên.

Quyền nhận được:

- **chỉ đọc** — không sửa, không xoá, không tạo được gì
- **đúng phần bạn được xem**, không hơn: thẻ mang chính quyền RBAC của bạn
- **tự hết hạn sau 90 ngày**
- thu hồi bất cứ lúc nào ở tab **API key** (dòng tên "Claude")

Bấm Connect lại lần nữa thì thẻ cũ **chết ngay** — một ứng dụng, một thẻ.

---

## B — Claude Code (chìa khoá API)

### Bạn cần hai thứ

1. **Claude Code** đã cài trên máy.
2. **Một chìa khoá API** — xin ở app: đăng nhập `https://fleet.seudambite.com`
   → tab **API key** → **Tạo key**:
   - Scope: **chỉ tick `read`**
   - Chủ key phải có quyền `reports.read`
   - Chuỗi key hiện **đúng một lần**. Chép ngay. Mất thì tạo key mới, không có
     đường nào xem lại — hệ thống chỉ lưu bản băm.

---

### Nối, một dòng

```bash
claude mcp add --transport http fleet https://fleet.seudambite.com/mcp \
  --header "X-API-Key: fc_xxxxxxxx_..."
```

Kiểm:

```bash
claude mcp list
```

Thấy `fleet` là xong. Từ giờ hỏi thẳng trong Claude Code bằng tiếng Việt:

> hôm qua có ai quên làm giao nhận xe không
>
> tuần này đội tàu tốn bao nhiêu tiền dầu
>
> so số khách đặt với số khách đi thật ngày 23/08

---

## Ba tool, và chúng KHÔNG ghi được gì

| Tool | Trả lời câu gì |
|---|---|
| `handover_daily` | Ai nhận / trả xe hôm ấy, ai còn thiếu bước nào |
| `fuel_vs_booking` | Dầu đổ so với chuyến chạy |
| `daily_summary` | Gộp hai cái trên cho một ngày |

Máy chủ này **chỉ đọc**. Không có tool nào tạo, sửa, hay xoá. Đó là thiết kế, và
có một chốt trong mã dừng cả máy chủ nếu ai đó thêm một tool ghi mà quên khai
báo (`src/toolPolicy.ts`).

---

## Chìa khoá của bạn đi đâu

Nó đi thẳng từ máy bạn tới API, qua HTTPS. **Máy chủ MCP không lưu nó**, không
có cơ sở dữ liệu nào của riêng nó, và trong nhật ký chỉ ghi tám ký tự đầu
(`fc_a1b2c3d4`) — đủ để tra ra là key nào, không đủ để dùng lại.

Hệ quả thực tế:

- Bạn thấy **đúng những gì tài khoản bạn được thấy** trong app, không hơn.
- Mọi truy vấn ghi vào nhật ký kiểm toán **mang tên bạn**.
- Mất máy hoặc nghi lộ key → vào app **Thu hồi** key đó. Đường MCP đứt ngay ở
  lần gọi kế tiếp, không phải chờ hết phiên.

---

## Khi nó không chạy

| Thấy gì | Nghĩa là |
|---|---|
| `401 unauthorized` | Thiếu header, hoặc chép thiếu ký tự. Key có dạng `fc_` + 8 ký tự + `_` + phần dài |
| `429` kèm `Retry-After` | Hỏi quá dày. Chờ đúng số giây nó nói rồi hỏi lại |
| Câu trả lời mở đầu bằng `❌ KHÔNG LẤY ĐƯỢC SỐ LIỆU` | Đây là **LỖI**, không phải "không có dữ liệu". Đừng kết luận gì từ nó |
| `403` / thiếu quyền | Chủ key không có `reports.read`. Nhờ admin cấp |

---

## Gỡ ra

```bash
claude mcp remove fleet
```

Gỡ ở máy chỉ ngắt máy bạn. Muốn chắc chắn thì **thu hồi key** trong app — đó mới
là thứ cắt đường thật.
