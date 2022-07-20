docker run \
  --rm \
  -v $(pwd)/images/:/tmp/images/:rw \
  -it --platform linux/amd64 marctv/chd-converter \

