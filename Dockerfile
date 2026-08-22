FROM nginx:1.29.8 AS www

FROM oven/bun:1.3.10 AS bun

FROM bun AS build
# Umami tracking (public: both values ship in the served HTML) and the commit
# stamp vite.config.ts appends to each HTML file (no .git in the build
# context, so the sha arrives as a build arg — see bin/release.sh).
ARG VITE_UMAMI_URL=https://whomst.colonpipe.org/script.js
ARG VITE_UMAMI_SITE_ID=87f79409-e89b-4d08-97e6-1de61e5b6097
ARG GIT_SHA=unknown
ENV VITE_UMAMI_URL=$VITE_UMAMI_URL \
    VITE_UMAMI_SITE_ID=$VITE_UMAMI_SITE_ID \
    GIT_SHA=$GIT_SHA
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
# --ignore-scripts: lefthook's postinstall wants a git checkout
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

FROM www AS release
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
