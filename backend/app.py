"""
AETHERYON BITÁCORA — FastAPI Backend Cloud v5.0
MongoDB + Cloudflare R2 + Auth via env vars
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os, uuid, base64, re, unicodedata, asyncio, io
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
import httpx
import jwt  # PyJWT

# ─── MOTOR / PYMONGO (async) ──────────────────────────────────────────────────
from motor.motor_asyncio import AsyncIOMotorClient
import boto3
from botocore.client import Config

# ─── APP ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AETHERYON Bitácora API",
    version="5.0.0",
    docs_url="/api/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── CONFIG ──────────────────────────────────────────────────────────────────
MONGO_URI      = os.environ.get("MONGO_URI", "")
DB_NAME        = os.environ.get("MONGO_DB", "aetheryon")
R2_ACCOUNT_ID  = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY  = os.environ.get("R2_ACCESS_KEY", "")
R2_SECRET_KEY  = os.environ.get("R2_SECRET_KEY", "")
R2_BUCKET      = os.environ.get("R2_BUCKET", "aetheryon-bitacora")
R2_PUBLIC_URL  = os.environ.get("R2_PUBLIC_URL", "")   # Optional CDN URL
ACCESS_PASSWORD = os.environ.get("ACCESS_PASSWORD", "aetheryon2025")
JWT_SECRET     = os.environ.get("JWT_SECRET", "change_me_in_production_secret_key")
JWT_EXPIRE_H   = int(os.environ.get("JWT_EXPIRE_H", "72"))

FRONTEND_DIR   = Path(__file__).parent.parent / "frontend"

EXT_VIDEO   = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}
EXT_IMAGE   = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
EXT_AUDIO   = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"}
EXT_DOC_RICH= {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx"}
EXT_TEXT    = {".txt", ".log", ".csv", ".xml", ".yaml", ".yml", ".sh", ".bat"}
EXT_CODE    = {".js", ".ts", ".py", ".html", ".css", ".go", ".rs", ".java", ".c", ".cpp"}
EXT_SPECIAL = {".md", ".markdown", ".json"}

MIME_MAP = {
    ".mp4":"video/mp4", ".webm":"video/webm", ".mov":"video/quicktime",
    ".avi":"video/avi", ".mkv":"video/x-matroska",
    ".mp3":"audio/mpeg", ".wav":"audio/wav", ".ogg":"audio/ogg",
    ".m4a":"audio/mp4", ".flac":"audio/flac",
    ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
    ".gif":"image/gif", ".webp":"image/webp", ".svg":"image/svg+xml",
    ".pdf":"application/pdf", ".json":"application/json",
    ".md":"text/plain", ".markdown":"text/plain",
    ".txt":"text/plain", ".log":"text/plain", ".csv":"text/csv",
    ".xml":"application/xml", ".html":"text/html; charset=utf-8",
    ".css":"text/css", ".js":"application/javascript", ".py":"text/plain",
}

# ─── DB & R2 CLIENTS ─────────────────────────────────────────────────────────
_mongo_client = None
_r2_client = None

def get_db():
    global _mongo_client
    if _mongo_client is None:
        if not MONGO_URI:
            raise HTTPException(503, "MongoDB not configured")
        _mongo_client = AsyncIOMotorClient(MONGO_URI)
    return _mongo_client[DB_NAME]

def get_r2():
    global _r2_client
    if _r2_client is None:
        if not R2_ACCOUNT_ID or not R2_ACCESS_KEY or not R2_SECRET_KEY:
            raise HTTPException(503, "R2 storage not configured")
        _r2_client = boto3.client(
            "s3",
            endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    return _r2_client

# ─── AUTH ─────────────────────────────────────────────────────────────────────
security = HTTPBearer(auto_error=False)

def create_token() -> str:
    payload = {
        "sub": "user",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_H),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def verify_token(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if credentials is None:
        raise HTTPException(401, "Authentication required")
    try:
        jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    return True

# ─── PYDANTIC MODELS ─────────────────────────────────────────────────────────
class LoginPayload(BaseModel):
    password: str

class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    category: str = "GENERAL"
    access_level: str = "RESTRINGIDO"
    tags: list = []
    color: str = "#00f5ff"

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    access_level: Optional[str] = None
    tags: Optional[list] = None
    color: Optional[str] = None

class ScreenshotPayload(BaseModel):
    dataUrl: str
    label: str = "screenshot"

class RecordingPayload(BaseModel):
    dataUrl: str
    label: str = "recording"

class FileSavePayload(BaseModel):
    path: str
    content: str

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def get_file_type(ext: str) -> str:
    ext = ext.lower()
    if ext in EXT_VIDEO:    return "video"
    if ext in EXT_IMAGE:    return "image"
    if ext in EXT_AUDIO:    return "audio"
    if ext in EXT_DOC_RICH: return "document"
    if ext in EXT_TEXT:     return "document"
    if ext in EXT_CODE:     return "document"
    if ext in EXT_SPECIAL:  return "document"
    return "other"

def human_size(n: float) -> str:
    for u in ["B", "KB", "MB", "GB"]:
        if n < 1024: return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"

def slugify(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = name.lower().strip()
    name = re.sub(r"[^a-z0-9]+", "_", name).strip("_")
    return name or "proyecto"

def safe_filename(name: str) -> str:
    name = os.path.basename(name)
    name = re.sub(r"[^\w\s\-\.]", "", name)
    name = re.sub(r"\s+", "_", name).strip("._")
    return name or "file"

def r2_key(project_id: str, subdir: str, filename: str) -> str:
    return f"projects/{project_id}/{subdir}/{filename}"

def file_url(project_id: str, key: str) -> str:
    if R2_PUBLIC_URL:
        return f"{R2_PUBLIC_URL.rstrip('/')}/{key}"
    return f"/api/projects/{project_id}/files/{key.split('/', 2)[-1]}"

# ─── LIFESPAN ─────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    # Ensure MongoDB indexes
    try:
        db = get_db()
        await db.projects.create_index("id", unique=True)
    except Exception:
        pass

# ─── FRONTEND ─────────────────────────────────────────────────────────────────
def serve_html(filename: str) -> HTMLResponse:
    fp = FRONTEND_DIR / filename
    if not fp.exists():
        return HTMLResponse(f"<h1>{filename} not found</h1>", status_code=404)
    return HTMLResponse(fp.read_text(encoding="utf-8"))

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    return serve_html("aetheryon_frontend.html")

@app.get("/ide", response_class=HTMLResponse)
async def serve_ide():
    return serve_html("ide12.html")

@app.get("/ide12.html", response_class=HTMLResponse)
async def serve_ide_legacy():
    return serve_html("ide12.html")

# ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────
@app.post("/api/auth/login")
async def login(body: LoginPayload):
    if body.password != ACCESS_PASSWORD:
        raise HTTPException(401, "Invalid password")
    token = create_token()
    return {"token": token, "expires_in": JWT_EXPIRE_H * 3600}

@app.get("/api/auth/verify")
async def verify_auth(auth=Depends(verify_token)):
    return {"valid": True}

# ─── PROJECTS ─────────────────────────────────────────────────────────────────
@app.get("/api/projects")
async def list_projects(auth=Depends(verify_token)):
    db = get_db()
    r2 = get_r2()
    cursor = db.projects.find({}, {"_id": 0})
    projects = await cursor.to_list(length=1000)
    out = []
    total_bytes = 0
    for p in projects:
        # Count files in R2 for this project
        prefix = f"projects/{p['id']}/"
        try:
            paginator = r2.get_paginator("list_objects_v2")
            file_count = 0
            sz = 0
            async for page in _paginate_r2(paginator, R2_BUCKET, prefix):
                for obj in page.get("Contents", []):
                    file_count += 1
                    sz += obj.get("Size", 0)
            total_bytes += sz
            out.append({**p, "file_count": file_count, "total_size": human_size(sz)})
        except Exception:
            out.append({**p, "file_count": p.get("file_count", 0), "total_size": "—"})
    return {"projects": out, "total_storage": human_size(total_bytes)}

async def _paginate_r2(paginator, bucket, prefix):
    """Sync paginator wrapper as async generator."""
    import concurrent.futures
    loop = asyncio.get_event_loop()
    pages = paginator.paginate(Bucket=bucket, Prefix=prefix)
    with concurrent.futures.ThreadPoolExecutor() as executor:
        for page in await loop.run_in_executor(executor, lambda: list(pages)):
            yield page

@app.post("/api/projects", status_code=201)
async def create_project(body: ProjectCreate, auth=Depends(verify_token)):
    db = get_db()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name required")
    slug = slugify(name)
    existing = {p["id"] async for p in db.projects.find({}, {"id": 1, "_id": 0})}
    pid = slug
    if pid in existing:
        n = 2
        while f"{slug}_{n}" in existing:
            n += 1
        pid = f"{slug}_{n}"
    now = datetime.utcnow().isoformat()
    proj = {
        "id": pid, "name": name, "description": body.description,
        "category": body.category, "access_level": body.access_level,
        "tags": body.tags, "color": body.color,
        "created": now, "updated": now,
    }
    await db.projects.insert_one({**proj, "_id": pid})
    return {"project": proj}

@app.get("/api/projects/{pid}")
async def get_project(pid: str, auth=Depends(verify_token)):
    db = get_db()
    p = await db.projects.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Not found")
    files = await _list_r2_files(pid)
    return {"project": p, "files": files}

@app.put("/api/projects/{pid}")
async def update_project(pid: str, body: ProjectUpdate, auth=Depends(verify_token)):
    db = get_db()
    data = {k: v for k, v in body.dict().items() if v is not None and k not in ("id", "created")}
    data["updated"] = datetime.utcnow().isoformat()
    result = await db.projects.find_one_and_update(
        {"id": pid}, {"$set": data}, return_document=True, projection={"_id": 0}
    )
    if not result:
        raise HTTPException(404, "Not found")
    return {"project": result}

@app.delete("/api/projects/{pid}")
async def delete_project(pid: str, auth=Depends(verify_token)):
    db = get_db()
    r2 = get_r2()
    # Delete all R2 objects for this project
    prefix = f"projects/{pid}/"
    try:
        loop = asyncio.get_event_loop()
        paginator = r2.get_paginator("list_objects_v2")
        pages = await loop.run_in_executor(None, lambda: list(paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix)))
        keys = [{"Key": obj["Key"]} for page in pages for obj in page.get("Contents", [])]
        if keys:
            await loop.run_in_executor(None, lambda: r2.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": keys}))
    except Exception:
        pass
    await db.projects.delete_one({"id": pid})
    return {"deleted": pid}

# ─── FILES ───────────────────────────────────────────────────────────────────
async def _list_r2_files(pid: str, type_filter: str = None) -> list:
    r2 = get_r2()
    prefix = f"projects/{pid}/"
    files = []
    try:
        loop = asyncio.get_event_loop()
        paginator = r2.get_paginator("list_objects_v2")
        pages = await loop.run_in_executor(None, lambda: list(paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix)))
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                name = key.split("/")[-1]
                if not name or name.startswith("."):
                    continue
                ext = Path(name).suffix.lower()
                ftype = get_file_type(ext)
                if type_filter and ftype != type_filter:
                    continue
                rel_path = key[len(f"projects/{pid}/"):]
                files.append({
                    "id":         str(uuid.uuid4()),
                    "name":       name,
                    "path":       rel_path,
                    "r2_key":     key,
                    "type":       ftype,
                    "ext":        ext,
                    "size":       obj.get("Size", 0),
                    "size_human": human_size(obj.get("Size", 0)),
                    "created":    obj["LastModified"].isoformat(),
                    "modified":   obj["LastModified"].isoformat(),
                    "url":        f"/api/projects/{pid}/files/{rel_path}",
                })
    except Exception as e:
        pass
    files.sort(key=lambda f: f["created"], reverse=True)
    return files

@app.get("/api/projects/{pid}/files")
async def list_files(pid: str, type: Optional[str] = None, auth=Depends(verify_token)):
    db = get_db()
    if not await db.projects.find_one({"id": pid}):
        raise HTTPException(404, "Not found")
    files = await _list_r2_files(pid, type)
    return {"files": files}

@app.post("/api/projects/{pid}/upload", status_code=201)
async def upload_file(pid: str, file: UploadFile = File(...), subdir: str = Form(default=""), auth=Depends(verify_token)):
    db = get_db()
    r2 = get_r2()
    if not await db.projects.find_one({"id": pid}):
        raise HTTPException(404, "Not found")
    if not file.filename:
        raise HTTPException(400, "Empty name")
    ext   = Path(file.filename).suffix.lower()
    ftype = get_file_type(ext)
    sub_map = {"video": "recordings", "image": "screenshots", "audio": "audio", "document": "documents", "other": "documents"}
    sub = subdir or sub_map.get(ftype, "documents")
    safe = safe_filename(file.filename)
    ts = datetime.utcnow().strftime("%H%M%S")
    key = r2_key(pid, sub, safe)
    content = await file.read()
    mime = MIME_MAP.get(ext, "application/octet-stream")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: r2.put_object(
        Bucket=R2_BUCKET, Key=key, Body=content,
        ContentType=mime, ContentLength=len(content),
    ))
    await db.projects.update_one({"id": pid}, {"$set": {"updated": datetime.utcnow().isoformat()}})
    rel = key[len(f"projects/{pid}/"):]
    return {"file": {
        "id": str(uuid.uuid4()), "name": safe, "path": rel, "r2_key": key,
        "type": ftype, "ext": ext,
        "size": len(content), "size_human": human_size(len(content)),
        "created": datetime.utcnow().isoformat(),
        "url": f"/api/projects/{pid}/files/{rel}",
    }}

@app.post("/api/projects/{pid}/screenshot", status_code=201)
async def save_screenshot(pid: str, body: ScreenshotPayload, auth=Depends(verify_token)):
    db = get_db()
    r2 = get_r2()
    if not await db.projects.find_one({"id": pid}):
        raise HTTPException(404, "Not found")
    if not body.dataUrl.startswith("data:image"):
        raise HTTPException(400, "Invalid data")
    _, encoded = body.dataUrl.split(",", 1)
    raw = base64.b64decode(encoded)
    ts  = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    lbl = safe_filename(body.label)
    filename = f"{lbl}_{ts}.png"
    key = r2_key(pid, "screenshots", filename)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: r2.put_object(
        Bucket=R2_BUCKET, Key=key, Body=raw,
        ContentType="image/png", ContentLength=len(raw),
    ))
    await db.projects.update_one({"id": pid}, {"$set": {"updated": datetime.utcnow().isoformat()}})
    rel = key[len(f"projects/{pid}/"):]
    return {"file": {
        "id": str(uuid.uuid4()), "name": filename, "path": rel, "r2_key": key,
        "type": "image", "ext": ".png",
        "size": len(raw), "size_human": human_size(len(raw)),
        "created": datetime.utcnow().isoformat(),
        "url": f"/api/projects/{pid}/files/{rel}",
    }}

@app.post("/api/projects/{pid}/recording", status_code=201)
async def save_recording(pid: str, body: RecordingPayload, auth=Depends(verify_token)):
    db = get_db()
    r2 = get_r2()
    if not await db.projects.find_one({"id": pid}):
        raise HTTPException(404, "Not found")
    if not (body.dataUrl.startswith("data:video") or body.dataUrl.startswith("data:audio")):
        raise HTTPException(400, "Invalid data")
    _, encoded = body.dataUrl.split(",", 1)
    raw = base64.b64decode(encoded)
    ts  = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    lbl = safe_filename(body.label)
    filename = f"{lbl}_{ts}.webm"
    key = r2_key(pid, "recordings", filename)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: r2.put_object(
        Bucket=R2_BUCKET, Key=key, Body=raw,
        ContentType="video/webm", ContentLength=len(raw),
    ))
    await db.projects.update_one({"id": pid}, {"$set": {"updated": datetime.utcnow().isoformat()}})
    rel = key[len(f"projects/{pid}/"):]
    return {"file": {
        "id": str(uuid.uuid4()), "name": filename, "path": rel, "r2_key": key,
        "type": "video", "ext": ".webm",
        "size": len(raw), "size_human": human_size(len(raw)),
        "created": datetime.utcnow().isoformat(),
        "url": f"/api/projects/{pid}/files/{rel}",
    }}

@app.post("/api/projects/{pid}/save-file")
async def save_file_content(pid: str, body: FileSavePayload, auth=Depends(verify_token)):
    r2 = get_r2()
    db = get_db()
    if not await db.projects.find_one({"id": pid}):
        raise HTTPException(404, "Not found")
    # path validation — no traversal
    parts = Path(body.path).parts
    if ".." in parts or body.path.startswith("/"):
        raise HTTPException(403, "Access denied")
    key = f"projects/{pid}/{body.path}"
    raw = body.content.encode("utf-8")
    ext = Path(body.path).suffix.lower()
    mime = MIME_MAP.get(ext, "text/plain")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: r2.put_object(
        Bucket=R2_BUCKET, Key=key, Body=raw,
        ContentType=mime, ContentLength=len(raw),
    ))
    await db.projects.update_one({"id": pid}, {"$set": {"updated": datetime.utcnow().isoformat()}})
    return {"saved": body.path, "size": human_size(len(raw))}

@app.delete("/api/projects/{pid}/files/{filepath:path}")
async def delete_file(pid: str, filepath: str, auth=Depends(verify_token)):
    r2 = get_r2()
    key = f"projects/{pid}/{filepath}"
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, lambda: r2.delete_object(Bucket=R2_BUCKET, Key=key))
    except Exception:
        raise HTTPException(404, "Not found")
    return {"deleted": filepath}

# ─── FILE SERVING (proxy from R2) ─────────────────────────────────────────────
@app.get("/api/projects/{pid}/files/{filepath:path}")
async def serve_project_file(pid: str, filepath: str, auth=Depends(verify_token)):
    r2 = get_r2()
    key = f"projects/{pid}/{filepath}"
    ext = Path(filepath).suffix.lower()
    mime = MIME_MAP.get(ext, "application/octet-stream")
    try:
        loop = asyncio.get_event_loop()
        obj = await loop.run_in_executor(None, lambda: r2.get_object(Bucket=R2_BUCKET, Key=key))
        body = obj["Body"].read()
    except Exception:
        raise HTTPException(404, "File not found")
    viewable = EXT_IMAGE | EXT_VIDEO | EXT_AUDIO | {".pdf", ".md", ".json", ".txt", ".log", ".csv", ".html"}
    name = Path(filepath).name
    disposition = "inline" if ext in viewable else f'attachment; filename="{name}"'
    return StreamingResponse(
        io.BytesIO(body),
        media_type=mime,
        headers={
            "Content-Disposition": disposition,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
        }
    )

# ─── HEALTH ──────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    try:
        db = get_db()
        count = await db.projects.count_documents({})
        db_ok = True
    except Exception:
        count = 0
        db_ok = False
    return {
        "status":         "online",
        "version":        "5.0.0",
        "db":             "mongodb" if db_ok else "error",
        "storage":        "cloudflare_r2",
        "projects_count": count,
        "timestamp":      datetime.utcnow().isoformat(),
    }

# ─── ENTRY POINT ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
