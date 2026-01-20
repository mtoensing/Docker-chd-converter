from pydantic import BaseModel
from enum import Enum
from typing import Optional, List
from datetime import datetime


class ConversionMode(str, Enum):
    CREATECD = "createcd"
    CREATEDVD = "createdvd"


class DuplicateAction(str, Enum):
    SKIP = "skip"
    OVERWRITE = "overwrite"
    RENAME = "rename"


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FileEntry(BaseModel):
    name: str
    path: str
    type: str  # "file", "directory", or "archive"
    size: Optional[int] = None
    extension: Optional[str] = None
    convertible: bool = False
    has_chd: bool = False
    has_convertible_contents: bool = False  # For archives: contains convertible files
    convertible_count: int = 0  # For archives: number of convertible files inside


class DirectoryListing(BaseModel):
    volume: str
    path: str
    entries: List[FileEntry]


class Volume(BaseModel):
    name: str
    path: str


class ConversionJob(BaseModel):
    id: str
    file_path: str
    filename: str
    mode: ConversionMode
    status: JobStatus
    progress: int = 0
    message: str = ""
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    output_path: Optional[str] = None
    output_size: Optional[int] = None
    temp_dir: Optional[str] = None


class JobCreateRequest(BaseModel):
    file_path: str
    mode: ConversionMode = ConversionMode.CREATECD
    output_dir: Optional[str] = None  # If None, output alongside source
    duplicate_action: DuplicateAction = DuplicateAction.SKIP  # What to do if output exists


class BatchJobCreateRequest(BaseModel):
    file_paths: List[str]
    mode: ConversionMode = ConversionMode.CREATECD
    output_dir: Optional[str] = None  # If None, output alongside source
    duplicate_action: DuplicateAction = DuplicateAction.SKIP  # What to do if output exists


class CheckDuplicatesRequest(BaseModel):
    file_paths: List[str]
    output_dir: Optional[str] = None


class DuplicateInfo(BaseModel):
    file_path: str
    output_path: str
    exists: bool


class ArchiveEntry(BaseModel):
    archive_path: str
    internal_path: str
    name: str
    size: int
    extension: str
    convertible: bool = False


class CHDInfo(BaseModel):
    file: str
    input_file: Optional[str] = None
    file_version: Optional[str] = None
    logical_size: Optional[str] = None
    hunk_size: Optional[str] = None
    total_hunks: Optional[str] = None
    unit_size: Optional[str] = None
    total_units: Optional[str] = None
    compression: Optional[str] = None
    chd_size: Optional[str] = None
    ratio: Optional[str] = None
    sha1: Optional[str] = None
    data_sha1: Optional[str] = None
    raw_data: str = ""
