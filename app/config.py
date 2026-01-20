from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List
import os


class Settings(BaseSettings):
    # Volume configuration (comma-separated paths)
    chd_volumes: str = Field(default="/data/games", alias="CHD_VOLUMES")

    # Job limits - WARNING: Values > 1 may cause system instability
    max_concurrent_jobs: int = Field(default=1, alias="MAX_CONCURRENT_JOBS")

    # chdman binary path
    chdman_path: str = Field(default="/usr/bin/chdman", alias="CHDMAN_PATH")

    class Config:
        populate_by_name = True
        extra = "ignore"

    @property
    def volumes(self) -> List[str]:
        """Parse CHD_VOLUMES into a list of paths."""
        return [v.strip() for v in self.chd_volumes.split(",") if v.strip()]

    def get_volume_name(self, path: str) -> str:
        """Extract a friendly name from a volume path."""
        return os.path.basename(path.rstrip("/")) or path


settings = Settings()
