FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY public ./public
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
