# Post Social worker. Build the bundle first: worker/build.sh (scripts/deploy-worker.sh does).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY dist/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY dist/ ./
USER node
EXPOSE 8080
CMD ["node", "worker.mjs"]
