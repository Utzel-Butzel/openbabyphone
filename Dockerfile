FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json frontend/
COPY backend/package*.json backend/

RUN npm install

COPY . .

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
COPY backend/package*.json backend/

RUN npm install --omit=dev --workspace backend --include-workspace-root=false && npm cache clean --force

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "backend"]