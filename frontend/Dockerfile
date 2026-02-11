FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files and install vite for preview
COPY package.json package-lock.json* ./
RUN npm ci

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY vite.config.ts tsconfig.json tsconfig.node.json ./

# Support PORT env variable for Coolify
ENV PORT=5173
EXPOSE ${PORT}

# Use vite preview to serve the built app with shell form to expand PORT
CMD npm run preview -- --host 0.0.0.0 --port ${PORT}
