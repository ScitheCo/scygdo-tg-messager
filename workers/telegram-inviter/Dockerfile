FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Start worker
CMD ["node", "dist/index.js"]
