# Nối Claude Code vào FuelControl

Tài liệu MỘT TRANG cho người dùng cuối. Không cần biết gì về Docker hay MCP.

---

## Bạn cần hai thứ

1. **Claude Code** đã cài trên máy.
2. **Một chìa khoá API** — xin ở app: đăng nhập `https://fleet.seudambite.com`
   → tab **API key** → **Tạo key**:
   - Scope: **chỉ tick `read`**
   - Chủ key phải có quyền `reports.read`
   - Chuỗi key hiện **đúng một lần**. Chép ngay. Mất thì tạo key mới, không có
     đường nào xem lại — hệ thống chỉ lưu bản băm.

---

## Nối, một dòng

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
