import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.models import FileEntry, DirectoryListing, Volume
from app.services.chdman import CONVERTIBLE_EXTENSIONS
from app.services.archive import archive_service, ARCHIVE_EXTENSIONS
from app.services.lock_manager import lock_manager
from app.utils.path_utils import is_within_configured_volumes, get_volume_name_for_path

router = APIRouter()


@router.get("/volumes", response_model=List[Volume])
async def list_volumes():
    """List all configured volume mount points."""
    volumes = []
    for vol_path in settings.volumes:
        if os.path.isdir(vol_path):
            volumes.append(Volume(
                name=settings.get_volume_name(vol_path),
                path=vol_path
            ))
    return volumes


@router.get("/files", response_model=DirectoryListing)
async def list_files(
    path: str = Query(..., description="Directory path to list"),
    show_archives: bool = Query(True, description="Show archive contents")
):
    """List files in a directory."""
    if not is_within_configured_volumes(path, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: path outside configured volumes")

    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Directory not found")

    # Determine which volume this path belongs to
    volume_name = get_volume_name_for_path(path) or ""

    entries = []

    try:
        for item in sorted(os.listdir(path)):
            item_path = os.path.join(path, item)
            ext = Path(item).suffix.lower()

            if os.path.isdir(item_path):
                entries.append(FileEntry(
                    name=item,
                    path=item_path,
                    type="directory"
                ))
            elif os.path.isfile(item_path):
                size = os.path.getsize(item_path)
                is_convertible = ext in CONVERTIBLE_EXTENSIONS
                is_archive = ext in ARCHIVE_EXTENSIONS

                # Check if CHD already exists or is being converted (atomic check)
                has_chd = False
                if is_convertible:
                    chd_path = str(Path(item_path).with_suffix(".chd"))
                    # Use atomic check to get both file existence and lock status
                    file_exists, is_converting = lock_manager.check_file_status(chd_path)
                    has_chd = file_exists or is_converting

                # For archives, check if they contain convertible files
                has_convertible_contents = False
                convertible_count = 0
                if is_archive:
                    try:
                        archive_contents = archive_service.list_archive_contents(item_path)
                        convertible_count = len(archive_contents)
                        has_convertible_contents = convertible_count > 0
                    except Exception:
                        pass  # If we can't read the archive, just show it without the indicator

                entry = FileEntry(
                    name=item,
                    path=item_path,
                    type="archive" if is_archive else "file",
                    size=size,
                    extension=ext,
                    convertible=is_convertible,
                    has_chd=has_chd,
                    has_convertible_contents=has_convertible_contents,
                    convertible_count=convertible_count
                )
                entries.append(entry)

    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return DirectoryListing(
        volume=volume_name,
        path=path,
        entries=entries
    )


@router.get("/files/search")
async def search_files(
    path: str = Query(..., description="Root path to search"),
    recursive: bool = Query(True, description="Search subdirectories"),
    include_archives: bool = Query(True, description="Search inside archives")
) -> dict:
    """Search for convertible files in a directory tree."""
    if not is_within_configured_volumes(path, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: path outside configured volumes")

    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Directory not found")

    files = []
    archives = []

    def scan_directory(dir_path: str):
        try:
            for item in os.listdir(dir_path):
                item_path = os.path.join(dir_path, item)
                ext = Path(item).suffix.lower()

                if os.path.isdir(item_path):
                    if recursive:
                        scan_directory(item_path)
                elif os.path.isfile(item_path):
                    if ext in CONVERTIBLE_EXTENSIONS:
                        chd_path = str(Path(item_path).with_suffix(".chd"))
                        # Use atomic check to get both file existence and lock status
                        file_exists, is_converting = lock_manager.check_file_status(chd_path)
                        files.append({
                            "name": item,
                            "path": item_path,
                            "size": os.path.getsize(item_path),
                            "extension": ext,
                            "has_chd": file_exists or is_converting,
                            "in_archive": False
                        })
                    elif include_archives and ext in ARCHIVE_EXTENSIONS:
                        # List archive contents
                        archive_contents = archive_service.list_archive_contents(item_path)
                        for entry in archive_contents:
                            archives.append({
                                "name": entry["name"],
                                "path": f"{item_path}::{entry['internal_path']}",
                                "archive_path": item_path,
                                "internal_path": entry["internal_path"],
                                "size": entry["size"],
                                "extension": entry["extension"],
                                "has_chd": False,
                                "in_archive": True
                            })
        except PermissionError:
            pass

    scan_directory(path)

    return {
        "root": path,
        "files": files,
        "archives": archives,
        "total_files": len(files),
        "total_in_archives": len(archives)
    }


@router.get("/files/archive")
async def list_archive(
    path: str = Query(..., description="Path to archive file")
) -> dict:
    """List convertible files inside an archive."""
    if not is_within_configured_volumes(path, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: path outside configured volumes")

    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Archive not found")

    if not archive_service.is_archive(path):
        raise HTTPException(status_code=400, detail="Not a supported archive format")

    contents = archive_service.list_archive_contents(path)

    # Check for existing CHD files in the archive's directory
    archive_dir = os.path.dirname(path)
    for file_entry in contents:
        # Get the base name without extension and add .chd
        base_name = Path(file_entry["name"]).stem
        chd_path = os.path.join(archive_dir, f"{base_name}.chd")
        # Use atomic check to get both file existence and lock status
        file_exists, is_converting = lock_manager.check_file_status(chd_path)
        file_entry["has_chd"] = file_exists or is_converting

    return {
        "archive": path,
        "files": contents,
        "total": len(contents)
    }


@router.post("/files/rename")
async def rename_file(
    path: str = Query(..., description="Path to file or directory to rename"),
    new_name: str = Query(..., description="New name for the file or directory")
) -> dict:
    """Rename a file or directory."""
    if not is_within_configured_volumes(path, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: path outside configured volumes")

    # Validate new name (no path separators, no empty, no special chars that could be problematic)
    if not new_name or '/' in new_name or '\\' in new_name or new_name in ('.', '..'):
        raise HTTPException(status_code=400, detail="Invalid new name")

    parent_dir = os.path.dirname(path)
    new_path = os.path.join(parent_dir, new_name)

    # Check if new path is also within allowed volumes
    if not is_within_configured_volumes(new_path, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: target path outside configured volumes")

    # Use atomic rename - let the OS handle race conditions
    try:
        # os.rename is atomic on POSIX systems when src and dst are on same filesystem
        # It will fail with FileExistsError if target exists (on some systems)
        # or succeed by replacing (on others), so we use os.link + os.unlink pattern
        # For simplicity, we'll check and handle errors appropriately
        if os.path.exists(new_path):
            raise HTTPException(status_code=409, detail="A file or directory with that name already exists")
        os.rename(path, new_path)
        return {
            "success": True,
            "old_path": path,
            "new_path": new_path,
            "message": f"Successfully renamed to {new_name}"
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File or directory not found")
    except FileExistsError:
        raise HTTPException(status_code=409, detail="A file or directory with that name already exists")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename: {str(e)}")


@router.delete("/files/delete")
async def delete_file(
    path: str = Query(..., description="Path to file or directory to delete")
) -> dict:
    """Delete a file or empty directory."""
    if not is_within_configured_volumes(path, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: path outside configured volumes")

    # Handle race conditions by catching specific errors from the operation itself
    try:
        if os.path.isdir(path):
            # os.rmdir only succeeds on empty directories - handles race condition atomically
            os.rmdir(path)
        else:
            os.remove(path)

        return {
            "success": True,
            "path": path,
            "message": "Successfully deleted"
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File or directory not found")
    except OSError as e:
        # OSError with errno ENOTEMPTY means directory not empty
        if e.errno == 39:  # ENOTEMPTY
            raise HTTPException(status_code=400, detail="Cannot delete non-empty directory")
        elif e.errno == 21:  # EISDIR - tried to remove() a directory
            raise HTTPException(status_code=400, detail="Path is a directory, use appropriate method")
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}")
