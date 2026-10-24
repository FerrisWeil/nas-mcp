FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM tailscale/tailscale:stable AS tailscale

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache \
      ca-certificates \
      iptables \
      ip6tables \
      iproute2 \
      su-exec \
    && if [ -x /usr/sbin/iptables-legacy ]; then \
         rm -f /usr/sbin/iptables /usr/sbin/ip6tables; \
         ln -s /usr/sbin/iptables-legacy /usr/sbin/iptables; \
         ln -s /usr/sbin/ip6tables-legacy /usr/sbin/ip6tables; \
       fi \
    && mkdir -p /var/run/tailscale /var/lib/tailscale /tmp

COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh \
    && chown -R node:node /app

# Root is required only so tailscaled can create tailscale0 when TS_AUTHKEY is set.
# The MCP process always drops to user `node`.
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
