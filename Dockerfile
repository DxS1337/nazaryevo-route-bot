FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --chown=node:node . .
RUN chown node:node /app
USER node
ENV BOT_MODE=webhook PORT=10000
EXPOSE 10000
CMD ["node", "bot.mjs"]
