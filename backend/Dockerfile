# Post Social API (Node). Build the bundle first: backend/build.sh.
FROM node:24-slim
WORKDIR /app
# UTC so dates read from the database come out as they did on InsForge (backend/lib/database.ts).
ENV NODE_ENV=production PORT=8080 TZ=UTC DATABASE_CA_FILE=/app/rds-ca.pem
# AWS's certificate authorities for RDS, so the database's certificate can be checked.
ADD --chmod=444 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
COPY dist/ ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
