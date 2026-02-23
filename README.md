# Docker CHD "Compressed Hunks of Data" Converter  
Compresses GDI, ISO, BIN and CUE files to CHD using **CHDMAN** from MAME Tools.

* Skips existing `.chd` files  
* Does not delete or modify source files  
* Optional modes:
  * `createcd` (default)
  * `createdvd`
  * `extractcd` (CHD → ISO)
  * `extractdvd` (CHD → ISO)

---

## Quick Start — CD Conversion (Default)

```bash
  docker run \
  --rm \
  -v "$(pwd)/input/:/tmp/images/:rw" \
  -it marctv/chd-converter
```

`$(pwd)/input/` is the local folder containing your GDI/ISO/CUE files. It can be any folder.

```bash
  docker run \
  --rm \
  -v "/user/input:/tmp/images/:rw" \
  -it marctv/chd-converter
```

## createdvd (Optional) 

This is important for PlayStation Portable (PSP) CHD files.

 ```bash 
    docker run \
  --rm \
  -e CHDMAN_MODE=createdvd \
  -v "$(pwd)/input/:/tmp/images/:rw" \
  -it marctv/chd-converter
```

---

## Extract CHD back to ISO

To extract existing `.chd` files back to `.iso`, use one of the extraction modes. The mounted folder must contain `.chd` files to extract.

### extractcd

```bash
  docker run \
  --rm \
  -e CHDMAN_MODE=extractcd \
  -v "$(pwd)/chdfiles/:/tmp/images/:rw" \
  -it marctv/chd-converter
```

### extractdvd

```bash
  docker run \
  --rm \
  -e CHDMAN_MODE=extractdvd \
  -v "$(pwd)/chdfiles/:/tmp/images/:rw" \
  -it marctv/chd-converter
```

These modes scan the mounted folder (e.g. `chdfiles/`) for existing `.chd` files and create corresponding `.iso` files in the same directory. Existing `.iso` files will be skipped.

## check existing CHD files

 ```bash 
docker run --rm \
  -v "/volume1/base/chdmaker:/tmp/images/:rw" \
  --entrypoint chdman \
  -it marctv/chd-converter \
  info -i "WipEout Pure (USA) (En,Fr,Es) (v2.00)-60fps patch.chd"
 ```