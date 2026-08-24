import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { FuelControlClient } from '../client.js';
import { FuelControlError } from '../errors.js';
import { bangkokYesterday, checkRange, defaultRange, parseIsoDate } from '../dates.js';
import { formatDailySummary } from '../format.js';
import { fuelVsBookingSchema, handoverDailySchema, parseResponse } from '../schemas.js';
import { runTool } from './run.js';

/**
 * Ba tool đọc, đúng như PLAN.md §B2.
 *
 * Phần mô tả tool KHÔNG phải chỗ để viết cho gọn. Claude đọc chính những dòng
 * này để quyết định gọi tool nào và diễn giải con số ra sao — nên đơn vị, mốc
 * thời gian, và những chỗ dễ hiểu sai đều phải nằm ngay trong mô tả. Đặc biệt là
 * litersPerPax: không nói rõ thì nó sẽ bị đọc thành bằng chứng gian lận
 * (PLAN.md §0.3).
 */

const dateArg = z
  .string()
  .describe('Ngày theo giờ Bangkok, dạng YYYY-MM-DD. Bỏ trống = hôm qua.')
  .optional();

function requireDate(input: string | undefined, fallback: string): string {
  if (input === undefined || input.trim() === '') return fallback;
  const parsed = parseIsoDate(input);
  if (!parsed.ok) throw new FuelControlError('input', parsed.reason);
  return input.trim();
}

export function registerTools(server: McpServer, client: FuelControlClient, now: () => Date = () => new Date()): void {
  server.registerTool(
    'handover_daily',
    {
      title: 'Giao nhận xe theo ngày',
      description:
        'Đếm chuyến trong MỘT ngày đã có đủ cả hai bước giao nhận chưa: check-out (nhận xe) và ' +
        'check-in (trả xe). Trả về số liệu tổng theo vai trò (tài xế / thuyền trưởng) và danh sách ' +
        'từng chuyến còn thiếu, kèm tên người, mã chuyến, và biển số.\n\n' +
        'Ngày tính theo giờ Bangkok (UTC+7) và lấy theo giờ khởi hành đã lên lịch của chuyến, ' +
        'không phải lúc bản ghi được nhập. Chuyến đã huỷ không được đếm; chuyến quá hạn thì có. ' +
        'Chuyến thuê xe ngoài không có người của công ty nên không xuất hiện.\n\n' +
        'Dùng khi được hỏi: ai quên check-in, hôm qua giao nhận có đủ không, ai hay thiếu.',
      inputSchema: { date: dateArg },
    },
    async ({ date }) =>
      runTool('handover_daily', { date }, async () => {
        const d = requireDate(date, bangkokYesterday(now()));
        const raw = await client.get('handoverDaily', { date: d });
        const data = parseResponse(handoverDailySchema, raw, '/api/reports/handover-daily');
        return JSON.stringify(data, null, 2);
      }),
  );

  server.registerTool(
    'fuel_vs_booking',
    {
      title: 'Xăng dầu so với khách booking',
      description:
        'Mỗi ngày một dòng, đặt cạnh nhau: số phiếu đổ dầu, số lít, số tiền (đơn vị ฿ baht Thái), ' +
        'kết quả đối soát nhiên liệu, số chỗ điều phối đã đặt (bookedPax), và số khách thực đi ' +
        '(actualPax).\n\n' +
        'ĐỌC ĐÚNG HAI CON SỐ NÀY:\n' +
        '• reconWarning — số phiếu bị hệ thống đối soát báo CẢNH BÁO (so lít đổ với đồng hồ km và ' +
        'định mức xe). ĐÂY mới là chốt phát hiện gian lận nhiên liệu thật sự. reconWarning > 0 là ' +
        'thứ đáng đi hỏi.\n' +
        '• litersPerPax — lít chia cho số khách. CHỈ LÀ CHỈ SỐ XU HƯỚNG, KHÔNG PHẢI BẰNG CHỨNG ' +
        'GIAN LẬN. Xăng dầu tiêu hao theo quãng đường và giờ máy, không theo số khách: một chiếc ' +
        'van chở 2 khách đi Bangkok tốn xăng gần bằng chở 9 khách. Chỉ dùng nó để so tháng này với ' +
        'tháng trước, tuyệt đối không kết luận ai gian lận từ con số này. Giá trị null nghĩa là ' +
        'không có khách nào đi, nên tỉ lệ không tồn tại — không phải bằng 0.\n' +
        '• paxGap = actualPax − bookedPax. Đặt 9 chỗ mà đi 3 người thì hoặc booking sai, hoặc có ' +
        'người bị bỏ lại, hoặc có doanh thu không vào sổ. Đây là cặp số đáng soi nhất.\n' +
        '• agencyTrips — số chuyến thuê xe ngoài trong ngày. Những chuyến này chở khách thật ' +
        'nhưng KHÔNG dùng dầu của công ty, nên agencyTrips cao thì litersPerPax tụt xuống vì một lý ' +
        'do hoàn toàn bình thường — kiểm con số này trước khi kết luận gì từ litersPerPax.\n' +
        '• depotFills — số phiếu khai là "đổ tại kho". Cờ này do chính người nhập tự khai và là ' +
        'đường duy nhất tắt được một quy tắc đối soát, nên nó tăng bất thường là một tín hiệu.\n\n' +
        'Ngày đổ dầu lấy theo lúc dầu vào bình, không phải lúc kế toán ngồi nhập. Bỏ trống ' +
        'from/to = 7 ngày gần nhất. Tối đa 92 ngày một lần hỏi.',
      inputSchema: {
        from: z.string().describe('Ngày đầu, YYYY-MM-DD, giờ Bangkok.').optional(),
        to: z.string().describe('Ngày cuối, YYYY-MM-DD, giờ Bangkok.').optional(),
      },
    },
    async ({ from, to }) =>
      runTool('fuel_vs_booking', { from, to }, async () => {
        const fallback = defaultRange(now());
        const a = requireDate(from, fallback.from);
        const b = requireDate(to, fallback.to);
        const check = checkRange(a, b);
        if (!check.ok) throw new FuelControlError('input', check.reason);

        const raw = await client.get('fuelVsBooking', { from: check.range.from, to: check.range.to });
        const data = parseResponse(fuelVsBookingSchema, raw, '/api/reports/fuel-vs-booking');
        return JSON.stringify(data, null, 2);
      }),
  );

  server.registerTool(
    'daily_summary',
    {
      title: 'Bản tin tóm tắt một ngày',
      description:
        'Gộp cả hai báo cáo trên thành một bản tin đọc bằng mắt, cùng khuôn với bản tin gửi vào ' +
        'group LINE mỗi sáng. Bất thường xếp lên đầu, tổng kết xuống dưới — ngày sạch thì bản tin ' +
        'ngắn hẳn.\n\n' +
        'Dùng khi được hỏi chung chung: "hôm qua thế nào", "tóm tắt ngày 23/8". Cần số liệu thô để ' +
        'tự tính thì gọi handover_daily hoặc fuel_vs_booking.\n\n' +
        'Một trong hai nguồn hỏng thì tool này báo lỗi, KHÔNG trả về nửa bản tin — nửa bản tin đọc ' +
        'y hệt một ngày bình yên.',
      inputSchema: { date: dateArg },
    },
    async ({ date }) =>
      runTool('daily_summary', { date }, async () => {
        const d = requireDate(date, bangkokYesterday(now()));

        // Gọi song song: hai endpoint độc lập, không cái nào cần kết quả cái kia.
        // Promise.all cố ý — một bên hỏng thì cả tool hỏng, đúng như mô tả ở trên.
        const [rawHandover, rawFuel] = await Promise.all([
          client.get('handoverDaily', { date: d }),
          client.get('fuelVsBooking', { from: d, to: d }),
        ]);

        const handover = parseResponse(handoverDailySchema, rawHandover, '/api/reports/handover-daily');
        const fuel = parseResponse(fuelVsBookingSchema, rawFuel, '/api/reports/fuel-vs-booking');
        return formatDailySummary(handover, fuel);
      }),
  );
}
