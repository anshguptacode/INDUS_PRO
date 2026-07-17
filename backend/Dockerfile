FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
# non-root user
USER node
EXPOSE 4000
CMD ["node", "src/index.js"]
