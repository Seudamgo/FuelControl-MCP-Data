# Container cho máy chủ MCP (skill §10.1).
#
# Hai tầng: tầng build có TypeScript và devDependencies, tầng chạy không có gì
# ngoài mã đã dịch. Gộp một tầng thì trình biên dịch và toàn bộ cây dev nằm luôn
# trên máy phục vụ Internet — một đống công cụ không ai cần mà ai cũng dùng được.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: một gói phụ thuộc KHÔNG được chạy mã lúc cài. Đây là đường
# tấn công chuỗi cung ứng thường gặp nhất, và ở đây không gói nào cần script.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
# node:alpine đã có sẵn user "node" (uid 1000). Dùng lại thay vì tạo user mới.
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./

# Chạy KHÔNG phải root (skill §10.1). Container này nói chuyện với Internet; một
# lỗ hổng trong nó mà chạy bằng root là một lỗ hổng có quyền root.
USER node

ENV NODE_ENV=production
EXPOSE 3001

# Tự kiểm bằng chính /health của máy chủ. Không cài curl/wget: mỗi công cụ mạng
# thêm vào là một công cụ sẵn cho kẻ vào được container dùng lại.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/serve.js"]
