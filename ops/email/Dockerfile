FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d \
    && apt-get update && apt-get install -y --no-install-recommends postfix opendkim opendkim-tools python3 ca-certificates openssl tini util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10000 tickets-mail && useradd --uid 10000 --gid 10000 --no-create-home tickets-mail
COPY mailer.py /app/mailer.py
COPY start.sh /app/start.sh
COPY opendkim.conf /etc/opendkim.conf
RUN chmod 0755 /app/start.sh
EXPOSE 8826
ENTRYPOINT ["/usr/bin/tini", "--", "/app/start.sh"]
