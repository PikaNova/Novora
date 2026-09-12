ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm ci --ignore-scripts --registry=${NPM_REGISTRY} --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY . .
ARG VITE_SPEED_INSIGHTS=false
ENV VITE_SPEED_INSIGHTS=$VITE_SPEED_INSIGHTS
RUN npm run build
RUN npm run serve:build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm ci --omit=dev --ignore-scripts --registry=${NPM_REGISTRY} --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-build ./server-build
EXPOSE 3000
CMD ["node", "server-build/server/serve.js"]
