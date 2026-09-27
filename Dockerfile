# Runs web/server.ts directly via tsx rather than adding a separate build
# step for it -- tsup only builds src/index.ts and src/cli.ts (the npm
# package); the web dashboard has never needed compiling for local dev
# (`npm run web` already runs it through tsx), so this just does the same
# thing inside the container.
FROM node:20-slim

WORKDIR /app

# Installed inside the (Linux) container rather than copied from the host,
# so sharp's native binary resolves for the actual target platform.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 4173

CMD ["npx", "tsx", "web/server.ts"]
