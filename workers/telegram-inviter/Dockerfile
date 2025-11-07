FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (production only for smaller image)
RUN npm install --production

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
