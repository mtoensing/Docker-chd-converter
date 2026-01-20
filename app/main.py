import asyncio
import logging
import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routes import files, convert, info
from app.services.job_manager import job_manager
from app.services.lock_manager import lock_manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="CHD Converter",
    description="Web UI for converting game disc images to CHD format",
    version="1.0.0"
)

# Store background task reference to prevent garbage collection
_background_tasks = []

# Include routers
app.include_router(files.router, prefix="/api", tags=["files"])
app.include_router(convert.router, prefix="/api", tags=["convert"])
app.include_router(info.router, prefix="/api", tags=["info"])


@app.on_event("startup")
async def startup_event():
    """Start background job processor and clean up orphan locks."""
    # Clean up any orphan lock files from previous crashes
    lock_manager.cleanup_orphan_locks()
    logger.info("Cleaned up orphan lock files")

    # Start job queue processor and store reference
    task = asyncio.create_task(job_manager.process_queue())
    _background_tasks.append(task)
    logger.info("Job queue processor started")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# Serve static files
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root():
    """Serve the main HTML page."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "CHD Converter API", "docs": "/docs"}
