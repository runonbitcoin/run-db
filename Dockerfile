FROM node:16-slim

RUN mkdir /app
WORKDIR /app

COPY package.json .
COPY package-lock.json .

RUN npm install --production

COPY . .

CMD ["npm", "start"]