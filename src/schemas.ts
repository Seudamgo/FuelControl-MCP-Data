import { z } from 'zod';
import { FuelControlError } from './errors.js';

/**
 * Hình dạng phản hồi hai endpoint báo cáo, chép từ PLAN.md §A1/§A2.
 *
 * Kiểm lại phản hồi ở đây KHÔNG phải vì nghi ngờ máy chủ của chính mình. Nó
 * canh một ca cụ thể: Giai đoạn A được build lệch khỏi bản thiết kế này. Khi đó
 * lỗi sẽ nói thẳng "thiếu trường X" ngay tại chỗ, thay vì để một undefined trôi
 * xuống lớp định dạng rồi hiện ra bản tin có chữ "NaN" giữa mấy con số thật.
 *
 * Không dùng .strict(): backend thêm trường mới là chuyện lành, không nên làm
 * gãy MCP. Chỉ những trường MCP thật sự đọc mới bị bắt buộc.
 */

const roleCount = z.object({
  people: z.number(),
  trips: z.number(),
  complete: z.number(),
  missingCheckin: z.number(),
  missingCheckout: z.number(),
  missingBoth: z.number(),
});

export const handoverDailySchema = z.object({
  date: z.string(),
  summary: z.object({
    driver: roleCount,
    captain: roleCount,
  }),
  incomplete: z.array(
    z.object({
      staffName: z.string(),
      staffCode: z.string().nullable().optional(),
      role: z.string(),
      tripCode: z.string(),
      vehicle: z.string().nullable().optional(),
      hasCheckout: z.boolean(),
      hasCheckin: z.boolean(),
      scheduledDepartureAt: z.string().nullable().optional(),
      plannedEnd: z.string().nullable().optional(),
    }),
  ),
});

export const fuelVsBookingSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      fuel: z.object({
        logs: z.number(),
        liters: z.number(),
        cost: z.number(),
        reconOk: z.number(),
        reconWarning: z.number(),
        reconSkipped: z.number(),
        depotFills: z.number(),
      }),
      trips: z.object({
        count: z.number(),
        bookedPax: z.number(),
        actualPax: z.number(),
        paxGap: z.number(),
      }),
      // null khi actualPax = 0 — PLAN.md §A2 điểm 4. Trả 0 sẽ đọc ra như "rất
      // tiết kiệm", trong khi sự thật là tỉ lệ đó không tồn tại.
      litersPerPax: z.number().nullable(),
    }),
  ),
});

export const meSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable().optional(),
  }),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export type HandoverDaily = z.infer<typeof handoverDailySchema>;
export type FuelVsBooking = z.infer<typeof fuelVsBookingSchema>;
export type Me = z.infer<typeof meSchema>;

export function parseResponse<T>(schema: z.ZodType<T>, raw: unknown, endpoint: string): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  const detail = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`)
    .join(' · ');

  throw new FuelControlError(
    'bad_response',
    `${endpoint} trả về hình dạng khác bản thiết kế trong PLAN.md — ${detail}. ` +
      'Hoặc Giai đoạn A build lệch khỏi spec, hoặc PLAN.md cần cập nhật. Đừng đoán số từ phần đọc được.',
  );
}
