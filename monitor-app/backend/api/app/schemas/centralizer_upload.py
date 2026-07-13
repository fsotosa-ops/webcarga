"""Schemas del router `routers/centralizer_uploads.py` (Task 3). El resto de
los endpoints no necesitan body: `POST .../approve` y `POST .../apply` no
reciben payload; `POST /centralizer-uploads` recibe un `UploadFile` directo
vía `File(...)`, mismo patrón que los uploads de documentos ya existentes en
`routers/transporters.py`/`routers/insurance.py`.
"""
from typing import Optional

from pydantic import BaseModel


class UploadRejectBody(BaseModel):
    reason: Optional[str] = None
