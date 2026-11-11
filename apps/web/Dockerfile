# SayItPayIt web app (Next.js) for `docker compose --profile full up`.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3000
EXPOSE 3000
# Apply migrations and the deterministic demo seed, then serve.
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm run start"]
