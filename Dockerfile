FROM node:24-alpine AS build
WORKDIR /game
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-alpine
WORKDIR /game
COPY --from=build /game/dist/client ./dist/client
COPY --from=build /game/package.json /game/server.js /game/play.js /game/base-rules.js ./
ENV PORT=3001 MATCHES_DIR=/data/matches
EXPOSE 3001
CMD ["node","server.js"]
