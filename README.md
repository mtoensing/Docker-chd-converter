# Docker CHD Convert

Converts all GID, ISO and CUE files in a folder using chdman in Mame Tools to CHD. Skips existing chd files.

## Quick Start
```docker run \
  --rm \
  -v $(pwd)/images/:/tmp/images/:rw \
  -it marctv/chd-converter
```
