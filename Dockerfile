FROM node:18
WORKDIR /app
COPY package.json ./
RUN npm install --package-lock=false
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
