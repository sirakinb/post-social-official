# Post Social worker. Build the bundle first: worker/build.sh (scripts/deploy-worker.sh does).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
# ffmpeg makes the still frames for videos (worker/src/posters.ts); it reads the video over
# https, which needs the system certificates (Node brings its own, ffmpeg doesn't).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY dist/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY dist/ ./
USER node
EXPOSE 8080
CMD ["node", "worker.mjs"]
