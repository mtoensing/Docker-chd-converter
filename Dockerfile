FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y mame-tools 

WORKDIR /tmp/images

ENTRYPOINT for i in *.gdi *.iso *.cue; do \
     [ -e "$i" ] || continue; \
     [ -e "${i%.*}.chd" ] && continue; \
     chdman createcd -f -i "$i" -o "${i%.*}.chd"; \
    done