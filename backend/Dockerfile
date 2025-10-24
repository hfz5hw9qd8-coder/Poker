FROM node:18-alpine
WORKDIR /app

# Install dependencies (use package-lock if present)
COPY package*.json ./
RUN npm ci --only=production || npm install --production

# Copy app source
COPY . .

# Expose the port the server listens on
ENV PORT=3000
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
