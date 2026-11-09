FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-team ./dist-team
COPY --from=build /app/dist-team-web ./dist-team-web
COPY --from=build /app/node_modules/ipaddr.js ./node_modules/ipaddr.js
COPY --from=build /app/node_modules/yauzl ./node_modules/yauzl
COPY --from=build /app/node_modules/yazl ./node_modules/yazl
COPY --from=build /app/node_modules/pend ./node_modules/pend
COPY --from=build /app/node_modules/buffer-crc32 ./node_modules/buffer-crc32
COPY --from=build /app/node_modules/fflate ./node_modules/fflate
COPY server ./server
COPY shared ./shared
ENV HOST=0.0.0.0 PORT=1420
EXPOSE 1420
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
CMD ["node","server/start.mjs"]
