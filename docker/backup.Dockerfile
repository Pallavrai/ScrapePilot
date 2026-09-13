FROM postgres:18.6
RUN apt-get update && apt-get install -y --no-install-recommends gnupg openssh-client && rm -rf /var/lib/apt/lists/*
COPY scripts/backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh
ENTRYPOINT ["bash", "-c", "while true; do /usr/local/bin/backup.sh || exit 1; sleep 86400; done"]
