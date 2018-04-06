FROM node:9-alpine

WORKDIR /app
ENTRYPOINT ["node", "app/service.js"]
ENV NODE_ENV=production
EXPOSE 9000

COPY package.json .
COPY .npmrc .
RUN npm install --production
COPY ./ .
