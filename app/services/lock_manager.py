import fcntl
import glob
import logging
import os
import threading
from typing import Set

from app.config import settings

logger = logging.getLogger(__name__)


class LockManager:
    """Manages file locks to prevent concurrent conversions of the same file."""
    
    def __init__(self):
        self._locks: Set[str] = set()
        self._lock_mutex = threading.Lock()
        self._lock_handles = {}
    
    def is_locked(self, output_path: str) -> bool:
        """Check if an output file is currently locked (being converted)."""
        normalized_path = os.path.normpath(output_path)
        with self._lock_mutex:
            return normalized_path in self._locks
    
    def check_file_status(self, output_path: str) -> tuple[bool, bool]:
        """
        Check the status of an output file atomically.
        
        Returns:
            Tuple of (file_exists, is_locked)
        """
        normalized_path = os.path.normpath(output_path)
        with self._lock_mutex:
            is_locked = normalized_path in self._locks
            file_exists = os.path.isfile(normalized_path)
            return (file_exists, is_locked)
    
    def acquire_lock(self, output_path: str) -> bool:
        """
        Acquire a lock for the output file path.
        
        Returns:
            True if lock was acquired, False if already locked or CHD exists
        """
        normalized_path = os.path.normpath(output_path)
        
        with self._lock_mutex:
            # Check if already locked by another job
            if normalized_path in self._locks:
                return False
            
            # Try to create a lock file
            lock_file_path = f"{normalized_path}.lock"
            lock_handle = None
            try:
                # Open lock file in append mode to avoid truncating existing content
                lock_handle = open(lock_file_path, 'a')
                
                # Try to acquire an exclusive lock (non-blocking)
                try:
                    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    # Lock is held by another process
                    lock_handle.close()
                    return False
                except (IOError, OSError) as e:
                    # Other error (permission denied, etc.)
                    lock_handle.close()
                    logger.warning(f"Failed to acquire lock for {normalized_path}: {e}")
                    return False
                
                # Now that we have the lock, check if CHD already exists (atomic with lock)
                if os.path.isfile(normalized_path):
                    # File exists, release lock and clean up lock file
                    try:
                        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
                    except Exception:
                        pass
                    lock_handle.close()
                    lock_handle = None
                    # Clean up lock file since we're not using it
                    try:
                        if os.path.exists(lock_file_path):
                            os.remove(lock_file_path)
                    except Exception:
                        pass
                    return False
                
                # Successfully acquired the lock and file doesn't exist
                self._locks.add(normalized_path)
                self._lock_handles[normalized_path] = lock_handle
                return True
                
            except Exception as e:
                # Ensure file handle is closed on any error
                if lock_handle is not None:
                    try:
                        lock_handle.close()
                    except Exception:
                        pass
                logger.warning(f"Failed to acquire lock for {normalized_path}: {e}")
                return False

    def release_lock(self, output_path: str):
        """Release the lock for an output file path."""
        normalized_path = os.path.normpath(output_path)
        
        with self._lock_mutex:
            if normalized_path in self._locks:
                self._locks.remove(normalized_path)
                
                # Release and close the lock file handle
                if normalized_path in self._lock_handles:
                    lock_handle = self._lock_handles[normalized_path]
                    try:
                        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
                        lock_handle.close()
                    except Exception as e:
                        logger.error(f"Error releasing lock for {normalized_path}: {e}")
                    finally:
                        del self._lock_handles[normalized_path]
                    
                    # Clean up the lock file
                    lock_file_path = f"{normalized_path}.lock"
                    try:
                        if os.path.exists(lock_file_path):
                            os.remove(lock_file_path)
                    except Exception as e:
                        logger.warning(f"Failed to remove lock file {lock_file_path}: {e}")

    def cleanup_orphan_locks(self):
        """
        Clean up orphan .lock files from previous crashes.
        Called on startup to ensure stale locks don't block conversions.
        """
        cleaned = 0
        for volume in settings.volumes:
            if not os.path.isdir(volume):
                continue
            # Find all .lock files recursively
            pattern = os.path.join(volume, "**", "*.chd.lock")
            for lock_file in glob.glob(pattern, recursive=True):
                try:
                    # Try to acquire the lock - if successful, it's orphaned
                    with open(lock_file, 'a') as f:
                        try:
                            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                            # Lock acquired - this is an orphan, remove it
                            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                            os.remove(lock_file)
                            cleaned += 1
                            logger.info(f"Removed orphan lock file: {lock_file}")
                        except BlockingIOError:
                            # Lock is held by another process - leave it alone
                            pass
                except Exception as e:
                    logger.warning(f"Error checking lock file {lock_file}: {e}")
        return cleaned


lock_manager = LockManager()
