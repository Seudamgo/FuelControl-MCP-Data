/**
 * Nhật ký mọi lần gọi tool, ghi ra STDERR.
 *
 * ⚠️ Chỗ này khác hẳn mẫu chung của skill mcp-server-security (§9.1), và khác có
 * lý do sống còn: với transport stdio, STDOUT LÀ ĐƯỜNG TRUYỀN JSON-RPC. Ghi một
 * dòng log ra stdout là chèn rác vào giữa giao thức — client sẽ đứt kết nối với
 * một lỗi phân tích JSON không nói gì về nguyên nhân thật.
 *
 * Nên: mọi thứ không phải phản hồi MCP đều đi stderr. Không có ngoại lệ nào.
 */

const REDACT = ['key', 'token', 'secret', 'password', 'authorization', 'apikey'];

export type Outcome = 'success' | 'error' | 'denied';

export interface ToolCallLog {
  tool: string;
  params: Record<string, unknown>;
  outcome: Outcome;
  durationMs: number;
  errorKind?: string;
  error?: string;
}

/**
 * Che giá trị của mọi khoá nghe như một chuỗi bí mật.
 *
 * Che theo TÊN KHOÁ chứ không theo hình dạng giá trị: một API key và một mã
 * chuyến đều là chuỗi chữ-số, không phân biệt được bằng regex. Tên khoá thì
 * người viết code kiểm soát được.
 */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6 || input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (REDACT.some((needle) => lower.includes(needle))) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

export function logToolCall(entry: ToolCallLog, write: (line: string) => void = writeStderr): void {
  write(
    JSON.stringify({
      ts: new Date().toISOString(),
      source: 'fuelcontrol-mcp',
      ...entry,
      params: redact(entry.params),
    }) + '\n',
  );
}

function writeStderr(line: string): void {
  process.stderr.write(line);
}
