FROM debian:sid-slim

RUN apt-get update && apt -y --no-install-recommends install mame-tools

WORKDIR /tmp/images

ENTRYPOINT for i in *.gdi *.iso *.cue; do \
     [ -e "$i" ] || continue; \
     [ -e "${i%.*}.chd" ] && continue; \
     chdman createcd -f -i "$i" -o "${i%.*}.chd"; \
    done