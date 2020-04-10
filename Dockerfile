FROM hassanamin994/node_ffmpeg

WORKDIR /transcriber-service

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir ~/.aws
RUN mv aws_creds ~/.aws/credentials

CMD ["npm", "run", "docker:prod"]
