import asyncio
import logging
import os
import shutil
import uuid
from collections import OrderedDict
from datetime import datetime
from typing import Dict, List, Optional, Set

from app.models import ConversionJob, JobStatus, ConversionMode
from app.services.chdman import chdman_service
from app.services.lock_manager import lock_manager
from app.config import settings

logger = logging.getLogger(__name__)


class JobManager:
    """Manages conversion job queue and execution."""

    def __init__(self, max_concurrent: int = 1):
        self.jobs: OrderedDict[str, ConversionJob] = OrderedDict()
        self.max_concurrent = max_concurrent
        self._semaphore: asyncio.Semaphore = asyncio.Semaphore(max_concurrent)
        self._queue: asyncio.Queue = asyncio.Queue()
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._cancelled: Set[str] = set()
        self._running = False

    def create_job(
        self,
        file_path: str,
        mode: ConversionMode,
        output_dir: Optional[str] = None,
        output_path: Optional[str] = None
    ) -> ConversionJob:
        """Create a new conversion job."""
        job_id = str(uuid.uuid4())[:8]
        filename = os.path.basename(file_path)

        # Determine output path - use explicit path if provided, otherwise calculate
        if output_path is None:
            output_path = chdman_service.get_chd_path(file_path, output_dir)

        job = ConversionJob(
            id=job_id,
            file_path=file_path,
            filename=filename,
            mode=mode,
            status=JobStatus.QUEUED,
            progress=0,
            created_at=datetime.utcnow(),
            output_path=output_path
        )

        self.jobs[job_id] = job
        self._queue.put_nowait(job_id)
        return job

    def create_batch_jobs(
        self,
        file_paths: List[str],
        mode: ConversionMode,
        output_dir: Optional[str] = None
    ) -> List[ConversionJob]:
        """Create multiple conversion jobs."""
        return [self.create_job(fp, mode, output_dir) for fp in file_paths]

    def get_job(self, job_id: str) -> Optional[ConversionJob]:
        """Get a job by ID."""
        return self.jobs.get(job_id)

    def get_all_jobs(self) -> List[ConversionJob]:
        """Get all jobs."""
        return list(self.jobs.values())

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a job."""
        job = self.jobs.get(job_id)
        if not job:
            return False

        if job.status in (JobStatus.QUEUED, JobStatus.PROCESSING):
            self._cancelled.add(job_id)
            job.status = JobStatus.CANCELLED
            return True
        return False

    def delete_job(self, job_id: str) -> bool:
        """Delete a job from the list."""
        if job_id in self.jobs:
            job = self.jobs[job_id]
            if job.status == JobStatus.PROCESSING:
                self.cancel_job(job_id)
            del self.jobs[job_id]
            return True
        return False

    def subscribe(self, job_id: str) -> asyncio.Queue:
        """Subscribe to progress updates for a job."""
        queue: asyncio.Queue = asyncio.Queue()
        if job_id not in self._subscribers:
            self._subscribers[job_id] = []
        self._subscribers[job_id].append(queue)
        return queue

    def unsubscribe(self, job_id: str, queue: asyncio.Queue):
        """Unsubscribe from progress updates."""
        if job_id in self._subscribers:
            try:
                self._subscribers[job_id].remove(queue)
            except ValueError:
                pass

    async def _notify_subscribers(self, job_id: str, data: dict):
        """Notify all subscribers of a job update."""
        if job_id in self._subscribers:
            for queue in self._subscribers[job_id]:
                try:
                    queue.put_nowait(data)
                except asyncio.QueueFull:
                    pass

    async def process_queue(self):
        """Background task to process conversion queue."""
        self._running = True
        while self._running:
            try:
                # Wait for a job from the queue
                job_id = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                # Semaphore blocks here until a slot is available - bulletproof concurrency control
                await self._semaphore.acquire()
                asyncio.create_task(self._process_job(job_id))
            except asyncio.TimeoutError:
                pass
            except Exception as e:
                logger.error(f"Queue processor error: {e}")
                await asyncio.sleep(1)

    async def _process_job(self, job_id: str):
        """Process a single conversion job."""
        lock_acquired = False
        job = None
        try:
            job = self.jobs.get(job_id)
            if not job:
                return

            if job_id in self._cancelled:
                self._cancelled.discard(job_id)
                return

            # Try to acquire lock for the output file (prevents race conditions)
            lock_acquired = lock_manager.acquire_lock(job.output_path)
            if not lock_acquired:
                # Could not acquire lock - either file exists or is being converted
                # Check current status to provide better error message
                file_exists, is_locked = lock_manager.check_file_status(job.output_path)
                job.status = JobStatus.FAILED
                if is_locked:
                    job.error_message = "Another job is already converting to this output file"
                elif file_exists:
                    job.error_message = "Output CHD file already exists"
                else:
                    job.error_message = "Could not acquire lock for output file"
                job.completed_at = datetime.utcnow()

                await self._notify_subscribers(job_id, {
                    "type": "error",
                    "job_id": job_id,
                    "error": job.error_message
                })
                return

            job.status = JobStatus.PROCESSING
            job.started_at = datetime.utcnow()

            await self._notify_subscribers(job_id, {
                "type": "status",
                "job_id": job_id,
                "status": job.status.value,
                "progress": 0
            })

            async for update in chdman_service.convert(
                job.file_path,
                job.output_path,
                job.mode.value
            ):
                if job_id in self._cancelled:
                    self._cancelled.discard(job_id)
                    job.status = JobStatus.CANCELLED
                    break

                job.progress = update["progress"]
                job.message = update["message"]

                await self._notify_subscribers(job_id, {
                    "type": "progress",
                    "job_id": job_id,
                    "progress": job.progress,
                    "message": job.message
                })

            if job.status != JobStatus.CANCELLED:
                job.status = JobStatus.COMPLETED
                job.progress = 100
                job.completed_at = datetime.utcnow()

                # Get output file size
                if os.path.exists(job.output_path):
                    job.output_size = os.path.getsize(job.output_path)

                await self._notify_subscribers(job_id, {
                    "type": "complete",
                    "job_id": job_id,
                    "output_path": job.output_path,
                    "output_size": job.output_size
                })

        except Exception as e:
            if job:
                job.status = JobStatus.FAILED
                job.error_message = str(e)
                job.completed_at = datetime.utcnow()

            await self._notify_subscribers(job_id, {
                "type": "error",
                "job_id": job_id,
                "error": str(e)
            })

        finally:
            # Always release semaphore - this is critical for queue processing
            self._semaphore.release()

            # Only release lock if we acquired it
            if lock_acquired:
                lock_manager.release_lock(job.output_path)

            # Clean up temp directory if this was an archive extraction
            if job and job.temp_dir:
                temp_dir = job.temp_dir
                try:
                    if temp_dir and os.path.isdir(temp_dir):
                        shutil.rmtree(temp_dir, ignore_errors=True)
                    job.temp_dir = None
                except Exception as cleanup_error:
                    logger.warning(f"Failed to cleanup temp dir {temp_dir}: {cleanup_error}")


job_manager = JobManager(max_concurrent=settings.max_concurrent_jobs)
