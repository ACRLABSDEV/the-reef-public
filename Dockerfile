FROM node:22-slim

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./

# Use npm (handles native modules cleanly)
RUN npm install

# Copy source
COPY . .

# Create data directory
RUN mkdir -p /app/data

EXPOSE 8080

CMD ["npm", "start"]
