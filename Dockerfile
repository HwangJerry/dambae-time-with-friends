FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data/d1
# Only the local Worker runtime is needed after bundling the app.
COPY --from=build /app/node_modules/miniflare/package.json /tmp/miniflare-package.json
RUN node -e "const fs=require('fs');fs.writeFileSync('package.json',JSON.stringify({type:'module',dependencies:{miniflare:require('/tmp/miniflare-package.json').version}}))" && npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY server ./server
RUN mkdir -p /data/d1 && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/start.mjs"]
