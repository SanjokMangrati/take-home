FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem
WORKDIR /app
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem rds-global-bundle.pem
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY src/core ./src/core
COPY src/shared ./src/shared
COPY src/server ./src/server
COPY data/*.xer ./data/
USER node
EXPOSE 3000
CMD ["node", "src/server/main.ts"]
