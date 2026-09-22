#!/bin/sh
set -eu
umask 077
install -d -o opendkim -g opendkim -m 0750 /run/opendkim
install -o opendkim -g opendkim -m 0400 /secrets/dkim.private /run/opendkim/tickets.private
install -o tickets-mail -g tickets-mail -m 0400 /secrets/api.key /run/tickets-api.key
chown tickets-mail:tickets-mail /data
chmod 0700 /data
install -d -o root -g tickets-mail -m 0750 /mail-log
touch /mail-log/mail.log
chown root:tickets-mail /mail-log/mail.log
chmod 0640 /mail-log/mail.log
postconf -e 'myhostname = mail.becoreops.com' 'myorigin = becoreops.com' 'mydestination =' \
    'inet_interfaces = loopback-only' 'inet_protocols = ipv4' 'mynetworks = 127.0.0.1/32' \
    'smtpd_relay_restrictions = permit_mynetworks, reject' 'smtpd_recipient_restrictions = permit_mynetworks, reject' \
    'smtpd_milters = inet:127.0.0.1:8891' 'non_smtpd_milters = inet:127.0.0.1:8891' \
    'milter_default_action = tempfail' 'milter_protocol = 6' \
    'smtp_tls_security_level = verify' 'smtp_tls_verify_cert_match = hostname' \
    'smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt' 'smtp_tls_loglevel = 1' \
    'smtp_helo_name = mail.becoreops.com' 'maillog_file = /mail-log/mail.log' 'maillog_file_prefixes = /mail-log' \
    'maximal_queue_lifetime = 30m' 'bounce_queue_lifetime = 30m' \
    'minimal_backoff_time = 60s' 'maximal_backoff_time = 300s' 'queue_run_delay = 60s' \
    'default_process_limit = 10' 'smtp_destination_concurrency_limit = 2' \
    'smtp_destination_rate_delay = 1s' 'message_size_limit = 524288'
# Chroot DNS and CA files are unnecessary for this isolated container.
postconf -F 'smtp/inet/chroot=n' 'smtp/unix/chroot=n' 'cleanup/unix/chroot=n'
opendkim -x /etc/opendkim.conf
postfix check
postfix start
exec setpriv --reuid=tickets-mail --regid=tickets-mail --init-groups python3 /app/mailer.py
