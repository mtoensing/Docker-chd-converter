import asyncio
import logging
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.config import settings

logger = logging.getLogger(__name__)
from app.models import (
    ConversionJob, JobCreateRequest, BatchJobCreateRequest,
    JobStatus, DuplicateAction, CheckDuplicatesRequest, DuplicateInfo
)
from app.services.job_manager import job_manager
from app.services.archive import archive_service
from app.services.chdman import chdman_service
from app.utils.path_utils import is_within_configured_volumes

router = APIRouter()


def get_unique_output_path(base_path: str) -> str:
    """Generate a unique output path by appending a number if the file exists."""
    if not os.path.exists(base_path):
        return base_path

    path = Path(base_path)
    stem = path.stem
    suffix = path.suffix
    parent = path.parent

    counter = 1
    while True:
        new_path = parent / f"{stem}_{counter}{suffix}"
        if not os.path.exists(new_path):
            return str(new_path)
        counter += 1


@router.post("/jobs/check-duplicates", response_model=List[DuplicateInfo])
async def check_duplicates(request: CheckDuplicatesRequest):
    """Check which output files already exist for the given input files."""
    results = []

    if request.output_dir and not is_within_configured_volumes(request.output_dir, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: output directory outside configured volumes")

    for file_path in request.file_paths:
        if not is_within_configured_volumes(file_path):
            continue

        # Handle archive paths - get the actual filename and determine output location
        actual_filename = file_path
        effective_output_dir = request.output_dir

        if "::" in file_path:
            # For archive files, use the internal filename for the CHD name
            # and save next to the archive (unless output_dir is specified)
            archive_path, internal_path = file_path.split("::", 1)
            actual_filename = internal_path
            if not effective_output_dir:
                effective_output_dir = os.path.dirname(archive_path)

        output_path = chdman_service.get_chd_path(actual_filename, effective_output_dir)
        exists = os.path.exists(output_path)

        results.append(DuplicateInfo(
            file_path=file_path,
            output_path=output_path,
            exists=exists
        ))

    return results


@router.post("/jobs", response_model=ConversionJob)
async def create_job(request: JobCreateRequest):
    """Create a single conversion job."""
    if not is_within_configured_volumes(request.file_path):
        raise HTTPException(status_code=403, detail="Access denied: file path outside configured volumes")

    if request.output_dir and not is_within_configured_volumes(request.output_dir, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: output directory outside configured volumes")

    # Handle archive files
    file_path = request.file_path
    temp_dir = None
    archive_source_dir = None  # Directory where the archive is located (for output)

    if "::" in request.file_path:
        # Extract from archive
        archive_path, internal_path = request.file_path.split("::", 1)
        archive_source_dir = os.path.dirname(archive_path)  # Save CHD next to archive
        try:
            file_path, temp_dir = archive_service.extract_file(archive_path, internal_path)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(status_code=400, detail=f"Failed to extract from archive: {exc}")
        # Note: temp_dir cleanup should be handled after conversion

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # Calculate output path and handle duplicates
    # For archive files: use output_dir if specified, otherwise save next to archive
    effective_output_dir = request.output_dir or archive_source_dir
    output_path = chdman_service.get_chd_path(file_path, effective_output_dir)

    if os.path.exists(output_path):
        if request.duplicate_action == DuplicateAction.SKIP:
            raise HTTPException(status_code=409, detail="Output file already exists")
        elif request.duplicate_action == DuplicateAction.OVERWRITE:
            os.remove(output_path)
        elif request.duplicate_action == DuplicateAction.RENAME:
            output_path = get_unique_output_path(output_path)

    job = job_manager.create_job(file_path, request.mode, output_path=output_path)

    # Store temp_dir reference for cleanup (simplified - in production use proper cleanup)
    if temp_dir:
        job.temp_dir = temp_dir

    return job


@router.post("/jobs/batch", response_model=List[ConversionJob])
async def create_batch_jobs(request: BatchJobCreateRequest):
    """Create multiple conversion jobs."""
    for file_path in request.file_paths:
        if not is_within_configured_volumes(file_path):
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: {file_path} outside configured volumes"
            )

    if request.output_dir and not is_within_configured_volumes(request.output_dir, treat_archives=False):
        raise HTTPException(status_code=403, detail="Access denied: output directory outside configured volumes")

    jobs = []
    skipped = []

    for file_path in request.file_paths:
        actual_path = file_path
        temp_dir = None
        archive_source_dir = None  # Directory where the archive is located (for output)

        # Handle archive files
        if "::" in file_path:
            archive_path, internal_path = file_path.split("::", 1)
            archive_source_dir = os.path.dirname(archive_path)  # Save CHD next to archive
            try:
                actual_path, temp_dir = archive_service.extract_file(archive_path, internal_path)
            except (ValueError, FileNotFoundError) as exc:
                skipped.append(file_path)
                continue

        if os.path.isfile(actual_path):
            # Calculate output path and handle duplicates
            # For archive files: use output_dir if specified, otherwise save next to archive
            effective_output_dir = request.output_dir or archive_source_dir
            output_path = chdman_service.get_chd_path(actual_path, effective_output_dir)

            if os.path.exists(output_path):
                if request.duplicate_action == DuplicateAction.SKIP:
                    skipped.append(file_path)
                    continue
                elif request.duplicate_action == DuplicateAction.OVERWRITE:
                    os.remove(output_path)
                elif request.duplicate_action == DuplicateAction.RENAME:
                    output_path = get_unique_output_path(output_path)

            job = job_manager.create_job(actual_path, request.mode, output_path=output_path)
            if temp_dir:
                job.temp_dir = temp_dir
            jobs.append(job)

    return jobs


@router.get("/jobs", response_model=List[ConversionJob])
async def list_jobs():
    """List all conversion jobs."""
    return job_manager.get_all_jobs()


# NOTE: SSE endpoints must be defined BEFORE parameterized routes to avoid conflicts
@router.get("/jobs/events")
async def job_events():
    """SSE endpoint for all job progress updates."""
    import json

    async def event_generator():
        # Create a queue to receive all job updates
        queues = {}

        try:
            while True:
                try:
                    # Subscribe to any new jobs
                    for job in job_manager.get_all_jobs():
                        if job.id not in queues and job.status in (JobStatus.QUEUED, JobStatus.PROCESSING):
                            queues[job.id] = job_manager.subscribe(job.id)

                    # Check all queues for updates
                    for job_id, queue in list(queues.items()):
                        try:
                            update = queue.get_nowait()
                            yield {
                                "event": update.get("type", "progress"),
                                "data": json.dumps(update)
                            }

                            # Unsubscribe if job is done
                            if update.get("type") in ("complete", "error"):
                                job_manager.unsubscribe(job_id, queue)
                                del queues[job_id]

                        except asyncio.QueueEmpty:
                            pass

                    await asyncio.sleep(0.1)

                except Exception as e:
                    # Log error but keep the connection alive
                    logger.error(f"SSE event generator error: {e}")
                    await asyncio.sleep(1)
        finally:
            # Clean up all subscriptions on client disconnect
            for job_id, queue in queues.items():
                job_manager.unsubscribe(job_id, queue)

    return EventSourceResponse(event_generator())


@router.get("/jobs/{job_id}", response_model=ConversionJob)
async def get_job(job_id: str):
    """Get a specific job by ID."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.delete("/jobs/completed")
async def delete_completed_jobs():
    """Delete all completed, failed, and cancelled jobs."""
    deleted_ids = []
    for job in list(job_manager.get_all_jobs()):
        if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            if job_manager.delete_job(job.id):
                deleted_ids.append(job.id)
    return {"deleted": deleted_ids, "count": len(deleted_ids)}


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a job."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
        # Just remove from list
        job_manager.delete_job(job_id)
        return {"status": "deleted"}

    if job_manager.cancel_job(job_id):
        return {"status": "cancelled"}

    raise HTTPException(status_code=400, detail="Cannot cancel job")


@router.get("/jobs/{job_id}/events")
async def job_progress(job_id: str):
    """SSE endpoint for a specific job's progress."""
    import json

    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    queue = job_manager.subscribe(job_id)

    async def event_generator():
        try:
            # Send initial state
            yield {
                "event": "status",
                "data": json.dumps({
                    "job_id": job_id,
                    "status": job.status.value,
                    "progress": job.progress
                })
            }

            while True:
                try:
                    update = await asyncio.wait_for(queue.get(), timeout=30)
                    yield {
                        "event": update.get("type", "progress"),
                        "data": json.dumps(update)
                    }

                    if update.get("type") in ("complete", "error"):
                        break

                except asyncio.TimeoutError:
                    # Send keepalive
                    yield {"event": "ping", "data": json.dumps({})}

        except Exception as e:
            logger.error(f"SSE job progress error: {e}")
        finally:
            job_manager.unsubscribe(job_id, queue)

    return EventSourceResponse(event_generator())
