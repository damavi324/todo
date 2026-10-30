FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
# Render injects PORT at runtime (usually 10000) and that overrides this default.
ENV NODE_ENV=production PORT=5050 CALLPILOT_DATA_DIR=/data
EXPOSE 5050
CMD ["node", "src/server.js"]
