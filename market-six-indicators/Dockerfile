FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npx playwright install --with-deps chromium
COPY src ./src
ENV TZ=Asia/Shanghai STATE_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "src/cloud-daemon.mjs"]
