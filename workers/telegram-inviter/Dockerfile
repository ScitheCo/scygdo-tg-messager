FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies with resilient settings + mirror fallback
RUN npm config set registry https://registry.npmjs.org/ \
  && npm config set prefer-online true \
  && npm config set fetch-retries 6 \
  && npm config set fetch-retry-mintimeout 30000 \
  && npm config set fetch-retry-maxtimeout 180000 \
  && npm config set fetch-timeout 600000 \
  && npm config set cache /tmp/npm-cache \
  && npm cache clean --force \
  && (npm install --production --no-audit --no-fund || \
      (echo "Primary registry failed, switching to mirror" && \
       npm config set registry https://registry.npmmirror.com/ && \
       npm cache clean --force && \
       npm install --production --no-audit --no-fund))

# Copy source
COPY src ./src

# Build TypeScript
RUN npm install typescript @types/node && \
    npm run build && \
    npm uninstall typescript @types/node

# Remove source files to reduce image size
RUN rm -rf src tsconfig.json

# Set environment variables (defaults)
ENV NODE_ENV=production \
    PORT=8080 \
    WORKER_ID=telegram-inviter \
    BATCH_SIZE=10 \
    POLL_INTERVAL=5000 \
    LOG_LEVEL=info

# Health check for Cloud Run
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Start worker
CMD ["node", "dist/index.js"]
