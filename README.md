# Docker CHD "Compressed Hunks of Data" Converter
Compresses GDI, ISO, BIN and CUE files to CHD using CHDMAN from Mame Tools.  

* Skips existing chd files.
* Does not delete anything.

## Quick Start
```
  docker run \
  --rm \
  -v $(pwd)/images/:/tmp/images/:rw \
  -it marctv/chd-converter
```
## GitHub
https://github.com/mtoensing/Docker-chd-converter
