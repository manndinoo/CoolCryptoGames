FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY web ./web
COPY scripts ./scripts
COPY demo ./demo
ENV NODE_ENV=production LINEWATCH_DATA_DIR=/data PORT=3000
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
