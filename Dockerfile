FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libxshmfence1 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  dumb-init \
  curl \
  bash \
  ca-certificates \
  --no-install-recommends && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./

RUN npm install -g @nestjs/cli
RUN npm install --no-audit --loglevel=error

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 3005

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start"]
