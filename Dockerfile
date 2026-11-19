FROM node:24-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/rules/rules-catalog.json backend/rules/candidate_review_prompt.txt ./rules/
COPY docs/schema /app/docs/schema
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app/backend
ENV NODE_ENV=production APP_HOST=0.0.0.0 PORT=3001 REPORT_SNAPSHOT_DIR=/data
RUN mkdir /data && chown node:node /data
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY frontend/public /app/frontend/public
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"]
CMD ["node", "dist/index.js"]
