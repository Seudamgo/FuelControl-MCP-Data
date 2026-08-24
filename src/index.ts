#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { FuelControlClient } from './client.js';
import { loadConfig, loadDotEnv } from './config.js';
import { FuelControlError } from './errors.js';
import { registerTools } from './tools/index.js';

/**
 * Điểm khởi động máy chủ MCP FuelControl (transport stdio).
 *
 * LUẬT SỐ MỘT CỦA TỆP NÀY: không bao giờ console.log. Với stdio, stdout là
 * đường truyền JSON-RPC — một dòng chữ lọt vào đó là hỏng giao thức. Mọi thông
 * báo đi stderr.
 */
async function main(): Promise<void> {
  loadDotEnv();

  let client: FuelControlClient;
  try {
    const cfg = loadConfig();
    client = new FuelControlClient(cfg);
    process.stderr.write(`[fuelcontrol-mcp] sẵn sàng · API ${cfg.baseUrl}\n`);
  } catch (err) {
    // Chết ngay còn hơn khởi động rồi hỏng ở mọi câu hỏi: một máy chủ chạy được
    // nhưng trả lời sai mọi lần khó lần ra hơn hẳn một máy chủ không lên.
    const msg = err instanceof FuelControlError ? err.message : String(err);
    process.stderr.write(`[fuelcontrol-mcp] KHÔNG KHỞI ĐỘNG ĐƯỢC: ${msg}\n`);
    process.exit(1);
    return;
  }

  const server = new McpServer(
    { name: 'fuelcontrol-mcp-data', version: '0.1.0' },
    {
      instructions:
        'Máy chủ chỉ-đọc cho FuelControl (đội xe và tàu của resort ở Koh Kood, Thái Lan). ' +
        'Mọi mốc ngày theo giờ Bangkok. Tiền tính bằng ฿ baht Thái. ' +
        'Không có tool nào ghi được vào hệ thống. ' +
        'Khi một tool báo lỗi, đó là KHÔNG HỎI ĐƯỢC — không phải "không có dữ liệu".',
    },
  );

  registerTools(server, client);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`[fuelcontrol-mcp] sập: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
