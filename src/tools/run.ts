import { logToolCall } from '../audit.js';
import { FuelControlError } from '../errors.js';

export interface ToolResult {
  // Chữ ký chỉ mục là thứ SDK MCP đòi ở kiểu trả về của tool (nó cho phép gắn
  // thêm trường _meta). Không có dòng này thì TypeScript từ chối, dù cấu trúc
  // đã đúng.
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Vỏ bọc chung cho mọi tool: đo giờ, ghi nhật ký, và biến lỗi thành một câu nói
 * rõ ràng là LỖI.
 *
 * Câu cuối trong thông báo lỗi ("đây là lỗi, không phải không có dữ liệu") nhắm
 * thẳng vào Claude chứ không phải người đọc. Không có nó, một lỗi mạng rất dễ
 * bị tóm tắt lại thành "hôm qua mọi thứ đều ổn" — kiểu hỏng nguy hiểm nhất mà
 * lớp này có thể tạo ra (luật N3: hỏng thì đóng, không mở).
 */
export async function runTool(
  tool: string,
  params: Record<string, unknown>,
  fn: () => Promise<string>,
): Promise<ToolResult> {
  const started = Date.now();
  try {
    const text = await fn();
    logToolCall({ tool, params, outcome: 'success', durationMs: Date.now() - started });
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const fe =
      err instanceof FuelControlError
        ? err
        : new FuelControlError('server', err instanceof Error ? err.message : String(err));

    logToolCall({
      tool,
      params,
      outcome: fe.kind === 'input' ? 'denied' : 'error',
      durationMs: Date.now() - started,
      errorKind: fe.kind,
      error: fe.message,
    });

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `❌ KHÔNG LẤY ĐƯỢC SỐ LIỆU (${fe.kind})\n\n${fe.message}\n\n` +
            '⚠️ Đây là một LỖI, không phải "không có dữ liệu". Không được kết luận gì về ' +
            'giao nhận xe hay xăng dầu từ câu trả lời này.',
        },
      ],
    };
  }
}
