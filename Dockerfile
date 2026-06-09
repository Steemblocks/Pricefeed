FROM alpine:3.20

WORKDIR /app

RUN apk --no-cache add nodejs npm

ADD . /app

RUN npm install --omit=dev

CMD ["node", "feed.js"]
