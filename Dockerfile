# Bullseye: API + built web desk in one container.
# node:sqlite needs Node 22.13 or newer.
FROM node:24-slim

WORKDIR /app

# install first so the layer is reused when only source changes
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
# mount a persistent volume at /data: quotes, orders and payment evidence live in this file
ENV DB_PATH=/data/bullseye.sqlite
ENV PORT=4402
EXPOSE 4402

# secrets are supplied by the host at run time; there is no .env in the image
CMD ["npm", "run", "start"]
