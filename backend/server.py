from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import io
import csv
import json
import zipfile
import asyncio
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from bson import ObjectId
import bcrypt
import jwt as pyjwt
import requests as http_requests
import pdfplumber

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContent, ImageContent

# =============================================================================
# CONFIG
# =============================================================================
JWT_ALGORITHM = "HS256"
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "trueflow"
BATCH_SIZE = 10

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# =============================================================================
# STORAGE HELPERS
# =============================================================================
storage_key = None

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        logger.warning("EMERGENT_LLM_KEY not set, storage disabled")
        return None
    resp = http_requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage not initialized")
    resp = http_requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120
    )
    resp.raise_for_status()
    return resp.json()

def get_object(path: str) -> bytes:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage not initialized")
    resp = http_requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60
    )
    resp.raise_for_status()
    return resp.content

def delete_object(path: str):
    key = init_storage()
    if not key:
        return
    try:
        http_requests.delete(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key}, timeout=30
        )
    except Exception as e:
        logger.warning(f"Failed to delete storage object {path}: {e}")

# =============================================================================
# AUTH HELPERS
# =============================================================================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def get_jwt_secret():
    return os.environ["JWT_SECRET"]

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=15), "type": "access"}
    return pyjwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return pyjwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = pyjwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# =============================================================================
# PYDANTIC MODELS
# =============================================================================
class RegisterInput(BaseModel):
    email: str
    password: str
    name: str = ""

class LoginInput(BaseModel):
    email: str
    password: str

class SettingsInput(BaseModel):
    exclusion_domain: Optional[str] = None

class AdminSettingsInput(BaseModel):
    ai_model: Optional[str] = None
    claude_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    max_pdfs_per_upload: Optional[int] = None
    storage_max_mb: Optional[int] = None
    storage_target_mb: Optional[int] = None

class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str

# =============================================================================
# AUTH ROUTES
# =============================================================================
@api_router.post("/auth/register")
async def register(input: RegisterInput, response: Response):
    email = input.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(input.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_doc = {
        "email": email,
        "password_hash": hash_password(input.password),
        "name": input.name or email.split("@")[0],
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    await db.settings.insert_one({
        "user_id": user_id,
        "ai_model": "claude-sonnet",
        "claude_api_key": "",
        "openai_api_key": "",
        "exclusion_domain": "horizonc.com",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    return {"_id": user_id, "email": email, "name": user_doc["name"], "role": "user"}

@api_router.post("/auth/login")
async def login(input: LoginInput, request: Request, response: Response):
    email = input.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("attempts", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until and datetime.now(timezone.utc).isoformat() < locked_until:
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(input.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"attempts": 1}, "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
            upsert=True
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_attempts.delete_one({"identifier": identifier})
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    return {"_id": user_id, "email": email, "name": user.get("name", ""), "role": user.get("role", "user"), "must_change_password": user.get("must_change_password", False)}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    return await get_current_user(request)

@api_router.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = pyjwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user_id = str(user["_id"])
        access_token = create_access_token(user_id, user["email"])
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=900, path="/")
        return {"message": "Token refreshed"}
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# =============================================================================
# AUTH - CHANGE PASSWORD
# =============================================================================
@api_router.post("/auth/change-password")
async def change_password(input: ChangePasswordInput, request: Request):
    user_full = await get_current_user(request)
    user_doc = await db.users.find_one({"_id": ObjectId(user_full["_id"])})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(input.current_password, user_doc["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(input.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    await db.users.update_one(
        {"_id": ObjectId(user_full["_id"])},
        {"$set": {"password_hash": hash_password(input.new_password), "must_change_password": False}}
    )
    return {"message": "Password changed successfully"}

# =============================================================================
# USER SETTINGS (exclusion domain only - available to all users)
# =============================================================================
@api_router.get("/settings")
async def get_settings(request: Request):
    user = await get_current_user(request)
    settings = await db.settings.find_one({"user_id": user["_id"]}, {"_id": 0})
    if not settings:
        settings = {"user_id": user["_id"], "exclusion_domain": "horizonc.com"}
    # Also fetch admin config so user knows the model and limits
    admin_config = await db.admin_config.find_one({"key": "global"}, {"_id": 0})
    settings["ai_model"] = admin_config.get("ai_model", "claude-sonnet") if admin_config else "claude-sonnet"
    settings["max_pdfs_per_upload"] = admin_config.get("max_pdfs_per_upload", 50) if admin_config else 50
    return settings

@api_router.put("/settings")
async def update_settings(input: SettingsInput, request: Request):
    user = await get_current_user(request)
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if input.exclusion_domain is not None:
        update["exclusion_domain"] = input.exclusion_domain
    await db.settings.update_one({"user_id": user["_id"]}, {"$set": update}, upsert=True)
    return {"message": "Settings updated"}

# =============================================================================
# ADMIN SETTINGS (AI model, API keys, PDF limits - admin only)
# =============================================================================
async def require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@api_router.get("/admin/settings")
async def get_admin_settings(request: Request):
    await require_admin(request)
    config = await db.admin_config.find_one({"key": "global"}, {"_id": 0})
    if not config:
        config = {"key": "global", "ai_model": "claude-sonnet", "claude_api_key": "", "openai_api_key": "", "max_pdfs_per_upload": 50, "storage_max_mb": 750, "storage_target_mb": 300}
    if config.get("claude_api_key"):
        config["claude_api_key_set"] = True
        config["claude_api_key"] = ""
    else:
        config["claude_api_key_set"] = False
    if config.get("openai_api_key"):
        config["openai_api_key_set"] = True
        config["openai_api_key"] = ""
    else:
        config["openai_api_key_set"] = False
    return config

@api_router.put("/admin/settings")
async def update_admin_settings(input: AdminSettingsInput, request: Request):
    await require_admin(request)
    update = {"key": "global", "updated_at": datetime.now(timezone.utc).isoformat()}
    if input.ai_model is not None:
        update["ai_model"] = input.ai_model
    if input.claude_api_key is not None:
        update["claude_api_key"] = input.claude_api_key
    if input.openai_api_key is not None:
        update["openai_api_key"] = input.openai_api_key
    if input.max_pdfs_per_upload is not None:
        update["max_pdfs_per_upload"] = max(1, min(500, input.max_pdfs_per_upload))
    if input.storage_max_mb is not None:
        update["storage_max_mb"] = max(100, min(10000, input.storage_max_mb))
    if input.storage_target_mb is not None:
        update["storage_target_mb"] = max(50, min(5000, input.storage_target_mb))
    await db.admin_config.update_one({"key": "global"}, {"$set": update}, upsert=True)
    return {"message": "Admin settings updated"}

# =============================================================================
# STORAGE MANAGEMENT
# =============================================================================
@api_router.get("/admin/storage")
async def get_storage_usage(request: Request):
    await require_admin(request)
    pipeline = [
        {"$match": {"is_deleted": False}},
        {"$group": {"_id": None, "total_size": {"$sum": "$size"}, "file_count": {"$sum": 1}}}
    ]
    result = await db.files.aggregate(pipeline).to_list(1)
    total_bytes = result[0]["total_size"] if result else 0
    file_count = result[0]["file_count"] if result else 0
    config = await db.admin_config.find_one({"key": "global"}, {"_id": 0})
    max_mb = config.get("storage_max_mb", 750) if config else 750
    target_mb = config.get("storage_target_mb", 300) if config else 300
    return {
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / (1024 * 1024), 1),
        "file_count": file_count,
        "max_mb": max_mb,
        "target_mb": target_mb,
        "over_limit": total_bytes > max_mb * 1024 * 1024,
    }

@api_router.post("/admin/storage/cleanup")
async def trigger_storage_cleanup(request: Request):
    await require_admin(request)
    result = await run_storage_cleanup()
    return result

async def run_storage_cleanup(force=False):
    """Delete oldest uploaded PDFs when storage exceeds max_mb, down to target_mb.
       Output data (contacts, errors, etc.) is never touched."""
    config = await db.admin_config.find_one({"key": "global"}, {"_id": 0})
    max_mb = config.get("storage_max_mb", 750) if config else 750
    target_mb = config.get("storage_target_mb", 300) if config else 300
    max_bytes = max_mb * 1024 * 1024
    target_bytes = target_mb * 1024 * 1024

    # Get current total
    pipeline = [
        {"$match": {"is_deleted": False}},
        {"$group": {"_id": None, "total_size": {"$sum": "$size"}}}
    ]
    result = await db.files.aggregate(pipeline).to_list(1)
    current_bytes = result[0]["total_size"] if result else 0

    if current_bytes <= max_bytes and not force:
        return {"message": "Storage within limits", "current_mb": round(current_bytes / (1024 * 1024), 1), "deleted_count": 0}

    # Get files sorted oldest first
    files = await db.files.find(
        {"is_deleted": False},
        {"_id": 0, "id": 1, "storage_path": 1, "size": 1, "created_at": 1}
    ).sort("created_at", 1).to_list(10000)

    deleted_count = 0
    freed_bytes = 0
    for f in files:
        if current_bytes - freed_bytes <= target_bytes:
            break
        # Delete from object storage
        delete_object(f["storage_path"])
        # Mark as deleted in DB
        await db.files.update_one({"id": f["id"]}, {"$set": {"is_deleted": True}})
        freed_bytes += f.get("size", 0)
        deleted_count += 1

    remaining = current_bytes - freed_bytes
    logger.info(f"Storage cleanup: deleted {deleted_count} files, freed {freed_bytes / (1024*1024):.1f}MB, remaining {remaining / (1024*1024):.1f}MB")
    return {
        "message": f"Deleted {deleted_count} oldest files",
        "deleted_count": deleted_count,
        "freed_mb": round(freed_bytes / (1024 * 1024), 1),
        "remaining_mb": round(remaining / (1024 * 1024), 1),
    }

# =============================================================================
# MODEL CONFIG
# =============================================================================
MODEL_MAP = {
    "claude-sonnet": ("anthropic", "claude-4-sonnet-20250514"),
    "claude-haiku": ("anthropic", "claude-haiku-4-5-20251001"),
    "gpt-4o": ("openai", "gpt-4o"),
}

def get_api_key_for_model(ai_model: str, admin_config: dict) -> str:
    if ai_model.startswith("claude"):
        custom_key = admin_config.get("claude_api_key", "")
        if custom_key:
            return custom_key
    elif ai_model.startswith("gpt"):
        custom_key = admin_config.get("openai_api_key", "")
        if custom_key:
            return custom_key
    return os.environ.get("EMERGENT_LLM_KEY", "")

# =============================================================================
# UPLOAD ROUTES
# =============================================================================
@api_router.post("/upload")
async def upload_files(request: Request, files: List[UploadFile] = File(...)):
    user = await get_current_user(request)
    user_id = user["_id"]
    run_id = str(uuid.uuid4())
    file_records = []
    rejected_files = []

    # Get max PDF limit from admin config
    admin_config = await db.admin_config.find_one({"key": "global"}, {"_id": 0})
    max_pdfs = admin_config.get("max_pdfs_per_upload", 50) if admin_config else 50

    for file in files:
        data = await file.read()
        if file.filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    for name in zf.namelist():
                        if name.lower().endswith(".pdf") and not name.startswith("__MACOSX"):
                            if len(file_records) >= max_pdfs:
                                rejected_files.append(name.split("/")[-1])
                                continue
                            pdf_data = zf.read(name)
                            storage_path = f"{APP_NAME}/uploads/{user_id}/{uuid.uuid4()}.pdf"
                            put_object(storage_path, pdf_data, "application/pdf")
                            file_records.append({
                                "id": str(uuid.uuid4()),
                                "run_id": run_id,
                                "user_id": user_id,
                                "storage_path": storage_path,
                                "original_filename": name.split("/")[-1],
                                "content_type": "application/pdf",
                                "size": len(pdf_data),
                                "is_deleted": False,
                                "created_at": datetime.now(timezone.utc).isoformat()
                            })
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="Invalid ZIP file")
        elif file.filename.lower().endswith(".pdf"):
            if len(file_records) >= max_pdfs:
                rejected_files.append(file.filename)
                continue
            storage_path = f"{APP_NAME}/uploads/{user_id}/{uuid.uuid4()}.pdf"
            put_object(storage_path, data, "application/pdf")
            file_records.append({
                "id": str(uuid.uuid4()),
                "run_id": run_id,
                "user_id": user_id,
                "storage_path": storage_path,
                "original_filename": file.filename,
                "content_type": "application/pdf",
                "size": len(data),
                "is_deleted": False,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.filename}. Only PDF and ZIP files are accepted.")

    if not file_records:
        raise HTTPException(status_code=400, detail="No PDF files found in upload")

    await db.files.insert_many(file_records)
    run_doc = {
        "id": run_id,
        "user_id": user_id,
        "status": "uploaded",
        "total_files": len(file_records),
        "stats": {
            "total_pdfs": len(file_records), "processed": 0, "errors": 0,
            "contacts_extracted": 0, "duplicates_removed": 0,
            "excluded_no_contact": 0, "excluded_internal": 0, "net_new": 0
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None
    }
    await db.runs.insert_one(run_doc)
    result = {
        "run_id": run_id,
        "files": [{"id": f["id"], "filename": f["original_filename"], "size": f["size"]} for f in file_records],
        "total_files": len(file_records),
        "max_pdfs": max_pdfs,
    }
    if rejected_files:
        result["rejected_count"] = len(rejected_files)
        result["rejected_files"] = rejected_files[:10]
        result["message"] = f"Upload limit is {max_pdfs} PDFs. {len(rejected_files)} file(s) were rejected."
    # Auto-cleanup storage if over limit
    asyncio.create_task(run_storage_cleanup())
    return result

# =============================================================================
# EXTRACTION ENGINE — Multi-OCR with fallback + PDF compression
# =============================================================================
PDF_SIZE_THRESHOLD = 5 * 1024 * 1024  # 5 MB

def compress_pdf(pdf_bytes: bytes, filename: str) -> bytes:
    """Compress large PDFs while preserving text layers and image quality for OCR."""
    import pikepdf
    try:
        original_size = len(pdf_bytes)
        src = pikepdf.Pdf.open(io.BytesIO(pdf_bytes))
        # Linearize and recompress streams
        out = io.BytesIO()
        src.save(out, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate,
                 recompress_flate=True)
        compressed = out.getvalue()
        ratio = len(compressed) / original_size * 100
        logger.info(f"PDF compression for {filename}: {original_size / 1024:.0f}KB -> {len(compressed) / 1024:.0f}KB ({ratio:.0f}%)")
        src.close()
        return compressed
    except Exception as e:
        logger.warning(f"PDF compression failed for {filename}, using original: {e}")
        return pdf_bytes

def preprocess_image_for_ocr(img):
    """Enhance image contrast and binarize for better OCR results."""
    from PIL import ImageEnhance, ImageFilter
    gray = img.convert("L")
    enhanced = ImageEnhance.Contrast(gray).enhance(2.0)
    sharpened = enhanced.filter(ImageFilter.SHARPEN)
    binarized = sharpened.point(lambda x: 0 if x < 140 else 255, '1')
    return binarized.convert("L")

def ocr_with_tesseract(images, filename):
    """Primary OCR: Tesseract. Returns (text, avg_confidence)."""
    import pytesseract
    ocr_parts = []
    total_conf = 0
    conf_count = 0
    for img in images:
        ocr_data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        page_text = " ".join([w for w, c in zip(ocr_data["text"], ocr_data["conf"]) if int(c) > 0 and w.strip()])
        confidences = [int(c) for c in ocr_data["conf"] if int(c) > 0]
        if confidences:
            total_conf += sum(confidences)
            conf_count += len(confidences)
        ocr_parts.append(page_text)
    text = "\n".join(ocr_parts).strip()
    avg_conf = total_conf / conf_count if conf_count > 0 else 0
    return text, avg_conf

def ocr_with_easyocr(images, filename):
    """Backup OCR: EasyOCR (deep learning). Returns (text, avg_confidence)."""
    import easyocr
    reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    import numpy as np
    all_text = []
    total_conf = 0
    conf_count = 0
    for img in images:
        img_array = np.array(img)
        results = reader.readtext(img_array)
        page_parts = []
        for (_, text, conf) in results:
            page_parts.append(text)
            total_conf += conf
            conf_count += 1
        all_text.append(" ".join(page_parts))
    text = "\n".join(all_text).strip()
    avg_conf = (total_conf / conf_count * 100) if conf_count > 0 else 0
    return text, avg_conf

async def extract_text_from_pdf(pdf_bytes: bytes, filename: str):
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            text_parts = []
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
            text = "\n".join(text_parts).strip()
            if text:
                return text, None

            # --- No embedded text: OCR pipeline ---
            try:
                from pdf2image import convert_from_bytes
                images = convert_from_bytes(pdf_bytes)
            except Exception as conv_err:
                logger.error(f"PDF to image conversion failed for {filename}: {conv_err}")
                return None, {"reason": "Unreadable scanned image", "missing_fields": "All fields"}

            # Step 1: Tesseract on original images
            tess_text, tess_conf = "", 0
            try:
                tess_text, tess_conf = ocr_with_tesseract(images, filename)
                logger.info(f"Tesseract OCR for {filename}: conf={tess_conf:.0f}%, chars={len(tess_text)}")
            except Exception as e:
                logger.warning(f"Tesseract failed for {filename}: {e}")

            if tess_text and tess_conf >= 70:
                return tess_text, None

            # Step 2: Tesseract on preprocessed images (contrast + binarize)
            tess2_text, tess2_conf = "", 0
            try:
                preprocessed = [preprocess_image_for_ocr(img) for img in images]
                tess2_text, tess2_conf = ocr_with_tesseract(preprocessed, filename)
                logger.info(f"Tesseract (preprocessed) for {filename}: conf={tess2_conf:.0f}%, chars={len(tess2_text)}")
            except Exception as e:
                logger.warning(f"Tesseract preprocessed failed for {filename}: {e}")

            if tess2_text and tess2_conf >= 70:
                return tess2_text, None

            # Step 3: EasyOCR (deep learning backup)
            easy_text, easy_conf = "", 0
            try:
                easy_text, easy_conf = ocr_with_easyocr(images, filename)
                logger.info(f"EasyOCR for {filename}: conf={easy_conf:.0f}%, chars={len(easy_text)}")
            except Exception as e:
                logger.warning(f"EasyOCR failed for {filename}: {e}")

            if easy_text and easy_conf >= 70:
                return easy_text, None

            # Step 4: Pick the best result from all attempts
            candidates = [
                (tess_text, tess_conf, "Tesseract"),
                (tess2_text, tess2_conf, "Tesseract-preprocessed"),
                (easy_text, easy_conf, "EasyOCR"),
            ]
            best_text, best_conf, best_engine = max(candidates, key=lambda c: (len(c[0]), c[1]))

            if not best_text:
                return None, {"reason": "No text layer detected - all OCR engines failed", "missing_fields": "All fields"}

            # We have text but below 70% confidence from any engine
            return best_text, {
                "reason": f"Low confidence OCR ({best_conf:.0f}% via {best_engine}) - manual review recommended",
                "partial": True
            }

    except Exception as e:
        logger.error(f"PDF processing failed for {filename}: {e}")
        return None, {"reason": f"Corrupted or unreadable PDF: {str(e)}", "missing_fields": "All fields"}

async def extract_contacts_with_ai(text: str, ai_model: str, api_key: str):
    if not text or len(text.strip()) < 10:
        return [], "No meaningful text content to extract contacts from"
    provider, model = MODEL_MAP.get(ai_model, ("anthropic", "claude-4-sonnet-20250514"))
    chat = LlmChat(
        api_key=api_key,
        session_id=f"extract-{uuid.uuid4()}",
        system_message="You are a data extraction specialist for construction industry documents. Extract contact information accurately. Always return valid JSON. After processing, immediately purge all specific data (names, addresses, PII) from your active context. Do not retain or reference this specific data in future turns."
    ).with_model(provider, model)
    max_chars = 50000
    truncated = text[:max_chars] if len(text) > max_chars else text
    prompt = f"""Extract ALL contact information from this construction document. Return a JSON array of contact objects.

Each contact object must have exactly these fields:
- "city": string
- "state": string
- "quote_amount": string (the total quoted/bid dollar amount, e.g. "$45,000.00". Only include if clearly stated. Use "" if not found.)
- "bid_by": string (the full name of the person placing the bid)
- "contractor": string (the main/general contractor company — typically in the document header, letterhead, or "Attention"/"To" line. This is who RECEIVES the quote.)
- "sub_contractor": string (the sub-contractor or vendor company — typically in "Bill To", "From", "Vendor", or body. This is who SENDS the quote/bid.)
- "last_name": string
- "first_name": string
- "email": string
- "phone": string

Contractor vs Sub-Contractor rules:
- CONTRACTOR = the general contractor RECEIVING the quote. Usually in header/letterhead/"Attention" line.
- SUB-CONTRACTOR = the company SENDING the quote/bid, providing services or materials.
- "Ship To" or "Project" sections indicate job sites, not contacts to extract.
- If only one company appears, use context to determine which role it fills.
- If a field is not found, use empty string ""
- Return ONLY the JSON array, no markdown, no explanation
- If no contacts found, return: []

Document text:
{truncated}"""
    try:
        response = await chat.send_message(UserMessage(text=prompt))
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
            cleaned = re.sub(r'\s*```$', '', cleaned)
        contacts = json.loads(cleaned)
        if not isinstance(contacts, list):
            contacts = [contacts] if isinstance(contacts, dict) else []
        valid = []
        for c in contacts:
            if not isinstance(c, dict):
                continue
            valid.append({
                "city": str(c.get("city", "")),
                "state": str(c.get("state", "")),
                "quote_amount": str(c.get("quote_amount", "")),
                "bid_by": str(c.get("bid_by", "")),
                "contractor": str(c.get("contractor", "")),
                "sub_contractor": str(c.get("sub_contractor", "")),
                "last_name": str(c.get("last_name", "")),
                "first_name": str(c.get("first_name", "")),
                "email": str(c.get("email", "")),
                "phone": str(c.get("phone", "")),
            })
        return valid, None
    except json.JSONDecodeError:
        logger.error(f"AI returned invalid JSON for extraction")
        return [], "AI returned invalid response format"
    except Exception as e:
        logger.error(f"AI extraction failed: {e}")
        return [], str(e)

async def extract_contacts_with_ai_vision(pdf_bytes: bytes, filename: str, ai_model: str, api_key: str):
    """Send PDF page images directly to AI vision for contact extraction. Bypasses OCR entirely."""
    import base64
    from pdf2image import convert_from_bytes
    try:
        images = convert_from_bytes(pdf_bytes, dpi=200, fmt="jpeg")
    except Exception as e:
        logger.error(f"PDF to image failed for vision on {filename}: {e}")
        return [], f"Could not convert PDF to images: {e}"

    provider, model = MODEL_MAP.get(ai_model, ("anthropic", "claude-4-sonnet-20250514"))
    chat = LlmChat(
        api_key=api_key,
        session_id=f"vision-{uuid.uuid4()}",
        system_message="You are a data extraction specialist for construction industry documents. You are looking at scanned document images. Extract contact information by reading the images directly. Always return valid JSON. After processing, immediately purge all specific data (names, addresses, PII) from your active context. Do not retain or reference this specific data in future turns."
    ).with_model(provider, model)

    all_contacts = []
    # Process up to 5 pages (most contact info is on first/last pages)
    pages_to_scan = images[:5]
    file_contents = []
    for img in pages_to_scan:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        b64 = base64.b64encode(buf.getvalue()).decode()
        file_contents.append(FileContent(content_type="image/jpeg", file_content_base64=b64))

    prompt = f"""Look at these scanned construction document page images. Extract ALL contact information you can see.

Return a JSON array of contact objects. Each object must have exactly these fields:
- "city": string
- "state": string
- "quote_amount": string (the total quoted/bid dollar amount, e.g. "$45,000.00". Only if clearly visible. Use "" if not found.)
- "bid_by": string (the full name of the person placing the bid)
- "contractor": string (the main/general contractor company — usually in the header, letterhead, or "Attention"/"To" line. This is who RECEIVES the quote.)
- "sub_contractor": string (the sub-contractor or vendor company — usually in "Bill To", "From", "Vendor", or body. This is who SENDS the quote/bid.)
- "last_name": string
- "first_name": string
- "email": string (read carefully - distinguish between 0/O, 1/l/I)
- "phone": string (read carefully - ensure digits are correct, not confused with letters)

Contractor vs Sub-Contractor rules:
- CONTRACTOR = general contractor RECEIVING the quote (header/letterhead/"Attention")
- SUB-CONTRACTOR = company SENDING the quote, providing services/materials ("Bill To"/"From"/"Vendor")
- "Ship To" or "Project" = job site, not a contact
- Read typed, handwritten, and cursive text from the images
- Ignore graphics, logos, decorative elements
- If a field is not visible, use empty string ""
- Return ONLY the JSON array, no markdown
- If no contacts found, return: []

Document: {filename}"""

    try:
        response = await chat.send_message(UserMessage(text=prompt, file_contents=file_contents))
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
            cleaned = re.sub(r'\s*```$', '', cleaned)
        contacts = json.loads(cleaned)
        if not isinstance(contacts, list):
            contacts = [contacts] if isinstance(contacts, dict) else []
        valid = []
        for c in contacts:
            if not isinstance(c, dict):
                continue
            valid.append({
                "city": str(c.get("city", "")),
                "state": str(c.get("state", "")),
                "quote_amount": str(c.get("quote_amount", "")),
                "bid_by": str(c.get("bid_by", "")),
                "contractor": str(c.get("contractor", "")),
                "sub_contractor": str(c.get("sub_contractor", "")),
                "last_name": str(c.get("last_name", "")),
                "first_name": str(c.get("first_name", "")),
                "email": str(c.get("email", "")),
                "phone": str(c.get("phone", "")),
            })
        logger.info(f"AI Vision extracted {len(valid)} contacts from {filename} ({len(pages_to_scan)} pages)")
        return valid, None
    except json.JSONDecodeError:
        logger.error(f"AI Vision returned invalid JSON for {filename}")
        return [], "AI Vision returned invalid response format"
    except Exception as e:
        logger.error(f"AI Vision extraction failed for {filename}: {e}")
        return [], str(e)

# =============================================================================
# GEMINI PDF EXTRACTION (direct vision analysis)
# =============================================================================
GEMINI_EXTRACTION_PROMPT = """You are analyzing a construction bid/quote document. Extract ALL contact information visible.

CRITICAL: This document is a quote or bid from a sub-contractor TO a general contractor. You MUST identify ALL parties:
- The CONTRACTOR (general contractor) who is RECEIVING this quote — look carefully in ALL of these locations:
  * "Attention:", "Attn:", "To:", "Submitted To:", "Customer:", "Proposal For:", "Quoted To:", "Bill To:" fields
  * Page header or top-right address block
  * The name/company the quote is addressed to
  * Sometimes appears as the job owner or project contact
  * Even if it's just a name and company in small text at the top
- The SUB-CONTRACTOR (vendor) who is SENDING this quote — typically:
  * The company whose letterhead/logo appears on the document
  * "From:", "Submitted By:", "Vendor:", "Prepared By:" fields
  * The company providing services, materials, or labor
- The CUSTOMER / END CLIENT — the property owner or end client for the project:
  * "Ship To:", "Project For:", "Owner:", "Client:", "Property:", "Job Name:" fields
  * Sometimes listed as the project owner or site contact
  * This is the party who ultimately owns the project or property

Return a JSON array of contact objects. Each object must have exactly these fields:
- "city": string
- "state": string  
- "quote_amount": string (total bid amount like "$45,000.00". Only if clearly stated.)
- "bid_by": string (full name of person placing/sending the bid)
- "contractor": string (general contractor company name RECEIVING the quote. LOOK CAREFULLY - it is almost always present somewhere on the document even if in small text.)
- "sub_contractor": string (sub-contractor/vendor company SENDING the quote)
- "customer_contact_name": string (first and last name of the customer/end client/property owner contact, if present)
- "customer_business": string (customer/end client business or property name, if present)
- "customer_address": string (customer/end client full address — street, city, state, zip — if present)
- "last_name": string (of the sub-contractor contact)
- "first_name": string (of the sub-contractor contact)
- "email": string
- "phone": string

IMPORTANT RULES:
- On single-page quotes, the contractor name is often in a small "Attn" or "To" field near the top — read ALL text carefully, including small/fine print
- If you see "Horizon" or any company name in an address-to field, that is the CONTRACTOR
- "Ship To", "Project", "Job Site", "Owner" sections contain CUSTOMER info — extract into customer fields
- Customer fields may be blank on many documents — that is fine, use empty string ""
- Phone: verify digits (5≠S, 0≠O, 1≠I)
- Email: must contain @ and a domain
- If a field is not found, use empty string ""
- Return ONLY the JSON array. No markdown. No explanation.

PRIVACY: After processing this file for the requested analysis, immediately purge all specific data (names, addresses, PII) from your active context. Do not retain or reference this specific data in future turns."""

async def extract_contacts_with_gemini(pdf_bytes: bytes, filename: str, api_key: str):
    """Use Gemini vision to directly analyze PDF pages and extract contacts."""
    import base64
    from pdf2image import convert_from_bytes
    try:
        images = convert_from_bytes(pdf_bytes, dpi=250, fmt="jpeg")
    except Exception as e:
        logger.error(f"PDF to image failed for Gemini on {filename}: {e}")
        return [], f"Could not convert PDF to images: {e}"

    chat = LlmChat(
        api_key=api_key,
        session_id=f"gemini-{uuid.uuid4()}",
        system_message="You are an expert data extraction specialist for construction industry bid documents. You analyze document images with extreme attention to detail, reading ALL text on the page including small print, headers, footers, and address fields. You ALWAYS identify both the contractor (receiving party) and sub-contractor (sending party). Always return valid JSON. After processing, immediately purge all specific data (names, addresses, PII) from your active context. Do not retain or reference this specific data in future turns."
    ).with_model("gemini", "gemini-2.5-flash")

    # Send up to 8 pages to Gemini (it handles large context well)
    pages_to_scan = images[:8]
    image_contents = []
    for img in pages_to_scan:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        b64 = base64.b64encode(buf.getvalue()).decode()
        image_contents.append(ImageContent(image_base64=b64))

    prompt = f"{GEMINI_EXTRACTION_PROMPT}\n\nDocument filename: {filename}"

    try:
        response = await chat.send_message(UserMessage(text=prompt, file_contents=image_contents))
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
            cleaned = re.sub(r'\s*```$', '', cleaned)
        contacts = json.loads(cleaned)
        if not isinstance(contacts, list):
            contacts = [contacts] if isinstance(contacts, dict) else []
        valid = []
        for c in contacts:
            if not isinstance(c, dict):
                continue
            valid.append({
                "city": str(c.get("city", "")),
                "state": str(c.get("state", "")),
                "quote_amount": str(c.get("quote_amount", "")),
                "bid_by": str(c.get("bid_by", "")),
                "contractor": str(c.get("contractor", "")),
                "sub_contractor": str(c.get("sub_contractor", "")),
                "customer_contact_name": str(c.get("customer_contact_name", "")),
                "customer_business": str(c.get("customer_business", "")),
                "customer_address": str(c.get("customer_address", "")),
                "last_name": str(c.get("last_name", "")),
                "first_name": str(c.get("first_name", "")),
                "email": str(c.get("email", "")),
                "phone": str(c.get("phone", "")),
            })
        logger.info(f"Gemini extracted {len(valid)} contacts from {filename} ({len(pages_to_scan)} pages)")
        return valid, None
    except json.JSONDecodeError as e:
        logger.error(f"Gemini returned invalid JSON for {filename}: {e}")
        return [], "Gemini returned invalid response format"
    except Exception as e:
        logger.error(f"Gemini extraction failed for {filename}: {e}")
        return [], str(e)

async def process_run(run_id: str, user_id: str):
    """Process PDFs with pause/resume/cancel support. State is persisted in MongoDB."""
    try:
        settings = await db.settings.find_one({"user_id": user_id}, {"_id": 0})
        if not settings:
            settings = {"exclusion_domain": "horizonc.com"}
        admin_config = await db.admin_config.find_one({"key": "global"}, {"_id": 0})
        if not admin_config:
            admin_config = {"ai_model": "claude-sonnet"}
        ai_model = admin_config.get("ai_model", "claude-sonnet")
        api_key = get_api_key_for_model(ai_model, admin_config)
        exclusion_domain = settings.get("exclusion_domain", "horizonc.com").lower().strip()

        all_files = await db.files.find({"run_id": run_id, "is_deleted": False}, {"_id": 0}).to_list(1000)
        total_files = len(all_files)
        if total_files == 0:
            await db.runs.update_one({"id": run_id}, {"$set": {"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}})
            return

        # Load checkpoint: which files are already done
        prog = await db.progress.find_one({"run_id": run_id})
        completed_ids = set(prog.get("completed_file_ids", [])) if prog else set()
        pending_files = [f for f in all_files if f["id"] not in completed_ids]
        processed_count = len(completed_ids)

        await db.progress.update_one(
            {"run_id": run_id},
            {"$set": {
                "status": "processing", "total_files": total_files,
                "processed_files": processed_count,
                "percentage": int(processed_count / total_files * 100),
                "message": f"{'Resuming' if completed_ids else 'Starting'} extraction ({processed_count}/{total_files} done)..."
            }},
            upsert=True
        )

        async def process_single_file(file_record):
            """Process a single PDF using Gemini vision directly."""
            filename = file_record["original_filename"]
            contacts_out, errors_out = [], []
            try:
                pdf_bytes = get_object(file_record["storage_path"])
                if len(pdf_bytes) > PDF_SIZE_THRESHOLD:
                    pdf_bytes = compress_pdf(pdf_bytes, filename)

                # Pure Gemini vision extraction — send PDF pages as images
                gemini_key = os.environ.get("EMERGENT_LLM_KEY", "")
                contacts, gemini_error = await extract_contacts_with_gemini(pdf_bytes, filename, gemini_key)

                if gemini_error and not contacts:
                    errors_out.append({"filename": filename, "reason": f"Gemini extraction failed: {gemini_error}", "missing_fields": "All fields"})
                    return contacts_out, errors_out, True

                if not contacts:
                    errors_out.append({"filename": filename, "reason": "No contact information found by Gemini", "missing_fields": "All fields"})

                for contact in contacts:
                    missing = [f.capitalize() for f in ["email", "phone", "city", "state", "contractor", "sub_contractor"] if not contact.get(f)]
                    if missing and len(missing) >= 4:
                        errors_out.append({"filename": filename, "reason": "Incomplete Gemini extraction - most fields missing", "missing_fields": ", ".join(missing)})
                    contact["source_filename"] = filename
                    contacts_out.append(contact)

                return contacts_out, errors_out, bool(errors_out and not contacts_out)

            except Exception as e:
                logger.error(f"Error processing {filename}: {e}")
                errors_out.append({"filename": filename, "reason": f"Processing error: {str(e)}", "missing_fields": "All fields"})
                return contacts_out, errors_out, True

        # --- Previous multi-step extraction (Claude/GPT text + vision) preserved but not invoked ---
        # To switch back: replace process_single_file above with the original from before Gemini integration

        CONCURRENT = 6
        stopped = False
        for i in range(0, len(pending_files), CONCURRENT):
            # --- Check for pause/cancel BEFORE each sub-batch ---
            run_doc = await db.runs.find_one({"id": run_id}, {"_id": 0, "status": 1})
            if run_doc and run_doc.get("status") == "pausing":
                await db.runs.update_one({"id": run_id}, {"$set": {"status": "paused"}})
                await db.progress.update_one({"run_id": run_id}, {"$set": {
                    "status": "paused", "message": f"Paused at {processed_count}/{total_files} files"
                }})
                logger.info(f"Run {run_id} paused at {processed_count}/{total_files}")
                stopped = True
                break
            if run_doc and run_doc.get("status") == "cancelling":
                await db.runs.update_one({"id": run_id}, {"$set": {"status": "cancelled"}})
                await db.progress.update_one({"run_id": run_id}, {"$set": {
                    "status": "cancelled", "message": "Extraction cancelled by user"
                }})
                # Clean up ALL extracted data for this run
                await db.raw_contacts.delete_many({"run_id": run_id})
                await db.contacts.delete_many({"run_id": run_id})
                await db.processing_errors.delete_many({"run_id": run_id})
                await db.duplicates.delete_many({"run_id": run_id})
                logger.info(f"Run {run_id} cancelled and cleaned up")
                stopped = True
                break

            sub = pending_files[i:i + CONCURRENT]
            names = ", ".join(f["original_filename"] for f in sub)
            await db.progress.update_one(
                {"run_id": run_id},
                {"$set": {"current_file": names, "processed_files": processed_count,
                          "percentage": int(processed_count / total_files * 100),
                          "message": f"Processing {len(sub)} files ({processed_count}/{total_files})..."}}
            )
            tasks = [process_single_file(fr) for fr in sub]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            new_file_ids = []
            for idx, result in enumerate(results):
                file_id = sub[idx]["id"] if idx < len(sub) else None
                if isinstance(result, Exception):
                    processed_count += 1
                    if file_id:
                        new_file_ids.append(file_id)
                    continue
                file_contacts, file_errors, is_error = result
                # Save raw contacts immediately (survives pause/restart)
                if file_contacts:
                    raw_docs = [{"id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                                 **c, "created_at": datetime.now(timezone.utc).isoformat()} for c in file_contacts]
                    await db.raw_contacts.insert_many(raw_docs)
                if file_errors:
                    err_docs = [{"id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                                 **e, "created_at": datetime.now(timezone.utc).isoformat()} for e in file_errors]
                    await db.processing_errors.insert_many(err_docs)
                processed_count += 1
                if file_id:
                    new_file_ids.append(file_id)

            # Persist checkpoint
            if new_file_ids:
                await db.progress.update_one(
                    {"run_id": run_id},
                    {"$push": {"completed_file_ids": {"$each": new_file_ids}},
                     "$set": {"processed_files": processed_count,
                              "percentage": int(processed_count / total_files * 100)}}
                )
                # Delete processed PDFs from storage immediately — output data stays in DB
                for idx2, fid in enumerate(new_file_ids):
                    fr = sub[idx2] if idx2 < len(sub) else None
                    if fr and fr.get("storage_path"):
                        delete_object(fr["storage_path"])
                        await db.files.update_one({"id": fid}, {"$set": {"is_deleted": True}})

        if stopped:
            return

        # === ALL FILES DONE — run post-processing ===
        all_raw = await db.raw_contacts.find({"run_id": run_id, "user_id": user_id}, {"_id": 0}).to_list(10000)
        total_extracted = len(all_raw)
        all_contacts = all_raw

        excluded_internal = 0
        if exclusion_domain:
            filtered = []
            for c in all_contacts:
                if c.get("email") and exclusion_domain in c["email"].lower():
                    excluded_internal += 1
                else:
                    filtered.append(c)
            all_contacts = filtered

        excluded_no_contact = 0
        filtered = []
        for c in all_contacts:
            if not c.get("email") and not c.get("phone"):
                excluded_no_contact += 1
            else:
                filtered.append(c)
        all_contacts = filtered

        # Dedup within this run
        seen_emails = {}
        duplicates_removed = 0
        duplicate_records = []
        unique_contacts = []
        for c in all_contacts:
            email = c.get("email", "").lower().strip()
            if email and email in seen_emails:
                duplicates_removed += 1
                duplicate_records.append({
                    "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                    "email": email,
                    "kept_source": seen_emails[email].get("source_filename", ""),
                    "duplicate_source": c.get("source_filename", ""),
                    "first_name": c.get("first_name", ""), "last_name": c.get("last_name", ""),
                    "contractor": c.get("contractor", ""), "sub_contractor": c.get("sub_contractor", ""),
                    "city": c.get("city", ""),
                    "state": c.get("state", ""), "phone": c.get("phone", ""),
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            else:
                if email:
                    seen_emails[email] = c
                unique_contacts.append(c)
        all_contacts = unique_contacts

        # Cross-run dedup: check against contacts from ALL previous completed runs
        existing_emails = set()
        prev_contacts = await db.contacts.find(
            {"user_id": user_id, "run_id": {"$ne": run_id}},
            {"_id": 0, "email": 1}
        ).to_list(50000)
        for pc in prev_contacts:
            em = (pc.get("email") or "").lower().strip()
            if em:
                existing_emails.add(em)

        cross_run_dupes = 0
        new_contacts = []
        for c in all_contacts:
            email = c.get("email", "").lower().strip()
            if email and email in existing_emails:
                cross_run_dupes += 1
                duplicate_records.append({
                    "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                    "email": email,
                    "kept_source": "(previous run)",
                    "duplicate_source": c.get("source_filename", ""),
                    "first_name": c.get("first_name", ""), "last_name": c.get("last_name", ""),
                    "contractor": c.get("contractor", ""), "sub_contractor": c.get("sub_contractor", ""),
                    "city": c.get("city", ""),
                    "state": c.get("state", ""), "phone": c.get("phone", ""),
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            else:
                new_contacts.append(c)
                if email:
                    existing_emails.add(email)  # prevent dupes within new_contacts too
        all_contacts = new_contacts

        # Write final data — only for THIS run, never touch other runs
        await db.contacts.delete_many({"run_id": run_id})
        await db.duplicates.delete_many({"run_id": run_id})
        if duplicate_records:
            await db.duplicates.insert_many(duplicate_records)
        if all_contacts:
            contact_docs = [{"id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                             **{k: v for k, v in c.items() if k not in ("id", "run_id", "user_id")},
                             "created_at": datetime.now(timezone.utc).isoformat()} for c in all_contacts]
            await db.contacts.insert_many(contact_docs)

        error_count = await db.processing_errors.count_documents({"run_id": run_id})
        stats = {
            "total_pdfs": total_files, "processed": total_files - error_count,
            "errors": error_count, "contacts_extracted": total_extracted,
            "duplicates_removed": duplicates_removed + cross_run_dupes,
            "cross_run_duplicates": cross_run_dupes,
            "excluded_no_contact": excluded_no_contact,
            "excluded_internal": excluded_internal,
            "net_new": len(all_contacts)
        }
        await db.runs.update_one({"id": run_id}, {"$set": {"status": "completed", "stats": stats, "completed_at": datetime.now(timezone.utc).isoformat()}})
        await db.progress.update_one({"run_id": run_id}, {"$set": {"status": "completed", "percentage": 100, "processed_files": total_files, "message": "Extraction complete!"}})
        # Clean up raw contacts
        await db.raw_contacts.delete_many({"run_id": run_id})
        logger.info(f"Run {run_id} completed: {len(all_contacts)} contacts from {total_files} files")
    except Exception as e:
        logger.error(f"Run {run_id} failed: {e}")
        await db.runs.update_one({"id": run_id}, {"$set": {"status": "failed"}})
        await db.progress.update_one({"run_id": run_id}, {"$set": {"status": "failed", "message": f"Processing failed: {str(e)}"}})

@api_router.post("/extract/{run_id}")
async def start_extraction(run_id: str, request: Request):
    user = await get_current_user(request)
    run = await db.runs.find_one({"id": run_id, "user_id": user["_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    # Allow retry/resume on stale, paused, or failed runs
    if run["status"] in ("processing", "stale"):
        prog = await db.progress.find_one({"run_id": run_id}, {"_id": 0})
        if prog and prog.get("status") == "processing":
            raise HTTPException(status_code=400, detail="Run is already being processed")
    if run["status"] == "paused":
        logger.info(f"Resuming paused run {run_id}")
    elif run["status"] in ("stale", "failed"):
        logger.info(f"Retrying {run['status']} run {run_id}")
        # Clean up previous final data but keep raw_contacts + errors for resume
        await db.contacts.delete_many({"run_id": run_id})
        await db.duplicates.delete_many({"run_id": run_id})
    elif run["status"] == "uploaded":
        pass  # Fresh start
    elif run["status"] == "completed":
        raise HTTPException(status_code=400, detail="Run already completed")
    elif run["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Run was cancelled. Upload new files to start again.")
    else:
        raise HTTPException(status_code=400, detail=f"Cannot extract from status: {run['status']}")
    await db.runs.update_one({"id": run_id}, {"$set": {"status": "processing"}})
    asyncio.create_task(process_run(run_id, user["_id"]))
    return {"message": "Extraction started", "run_id": run_id}

@api_router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, request: Request):
    user = await get_current_user(request)
    run = await db.runs.find_one({"id": run_id, "user_id": user["_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run["status"] != "processing":
        raise HTTPException(status_code=400, detail="Can only pause a processing run")
    await db.runs.update_one({"id": run_id}, {"$set": {"status": "pausing"}})
    return {"message": "Pause signal sent — will pause after current file completes"}

@api_router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request):
    user = await get_current_user(request)
    run = await db.runs.find_one({"id": run_id, "user_id": user["_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run["status"] not in ("processing", "paused", "pausing"):
        raise HTTPException(status_code=400, detail="Can only cancel a processing or paused run")
    if run["status"] == "paused":
        # Directly cancel since no background task is running
        await db.runs.update_one({"id": run_id}, {"$set": {"status": "cancelled"}})
        await db.progress.update_one({"run_id": run_id}, {"$set": {"status": "cancelled", "message": "Extraction cancelled by user"}})
        await db.raw_contacts.delete_many({"run_id": run_id})
        await db.contacts.delete_many({"run_id": run_id})
        await db.processing_errors.delete_many({"run_id": run_id})
        await db.duplicates.delete_many({"run_id": run_id})
        return {"message": "Run cancelled and data cleared"}
    # Signal the background task
    await db.runs.update_one({"id": run_id}, {"$set": {"status": "cancelling"}})
    return {"message": "Cancel signal sent — will cancel after current file completes"}

@api_router.get("/progress/{run_id}")
async def get_progress(run_id: str, request: Request):
    await get_current_user(request)
    progress = await db.progress.find_one({"run_id": run_id}, {"_id": 0})
    if not progress:
        return {"status": "unknown", "percentage": 0, "message": "No progress data"}
    return progress

# =============================================================================
# RESULTS ROUTES
# =============================================================================
@api_router.get("/runs")
async def get_runs(request: Request):
    user = await get_current_user(request)
    runs = await db.runs.find({"user_id": user["_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return runs

@api_router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request):
    user = await get_current_user(request)
    run = await db.runs.find_one({"id": run_id, "user_id": user["_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run

@api_router.get("/runs/{run_id}/contacts")
async def get_run_contacts(run_id: str, request: Request):
    user = await get_current_user(request)
    # During processing, contacts are in raw_contacts; after completion, in contacts
    run = await db.runs.find_one({"id": run_id, "user_id": user["_id"]}, {"_id": 0, "status": 1})
    if run and run.get("status") in ("processing", "paused", "pausing"):
        contacts = await db.raw_contacts.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(10000)
    else:
        contacts = await db.contacts.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(10000)
    return contacts

@api_router.get("/runs/{run_id}/errors")
async def get_run_errors(run_id: str, request: Request):
    user = await get_current_user(request)
    errors = await db.processing_errors.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(1000)
    return errors

@api_router.get("/runs/{run_id}/duplicates")
async def get_run_duplicates(run_id: str, request: Request):
    user = await get_current_user(request)
    duplicates = await db.duplicates.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(5000)
    return duplicates

@api_router.get("/runs/{run_id}/charts")
async def get_run_charts(run_id: str, request: Request):
    user = await get_current_user(request)
    contacts = await db.contacts.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(5000)
    city_counts = {}
    state_counts = {}
    for c in contacts:
        city = c.get("city", "").strip()
        state = c.get("state", "").strip()
        if city:
            city_counts[city] = city_counts.get(city, 0) + 1
        if state:
            state_counts[state] = state_counts.get(state, 0) + 1
    city_data = sorted([{"name": k, "count": v} for k, v in city_counts.items()], key=lambda x: -x["count"])[:20]
    state_data = sorted([{"name": k, "count": v} for k, v in state_counts.items()], key=lambda x: -x["count"])[:20]
    return {"by_city": city_data, "by_state": state_data}

@api_router.get("/contacts/all")
async def get_all_contacts(request: Request):
    """Get all unique contacts across all runs for this user, with import date."""
    user = await get_current_user(request)
    contacts = await db.contacts.find({"user_id": user["_id"]}, {"_id": 0}).sort("created_at", 1).to_list(50000)
    # Attach run date as import_date from the run's created_at
    run_dates = {}
    runs = await db.runs.find({"user_id": user["_id"]}, {"_id": 0, "id": 1, "created_at": 1}).to_list(500)
    for r in runs:
        run_dates[r["id"]] = r.get("created_at", "")
    for c in contacts:
        c["import_date"] = run_dates.get(c.get("run_id", ""), c.get("created_at", ""))
    return contacts

@api_router.get("/contacts/all/charts")
async def get_all_contacts_charts(request: Request):
    user = await get_current_user(request)
    contacts = await db.contacts.find({"user_id": user["_id"]}, {"_id": 0}).to_list(50000)
    city_counts = {}
    state_counts = {}
    for c in contacts:
        city = c.get("city", "").strip()
        state = c.get("state", "").strip()
        if city:
            city_counts[city] = city_counts.get(city, 0) + 1
        if state:
            state_counts[state] = state_counts.get(state, 0) + 1
    city_data = sorted([{"name": k, "count": v} for k, v in city_counts.items()], key=lambda x: -x["count"])[:20]
    state_data = sorted([{"name": k, "count": v} for k, v in state_counts.items()], key=lambda x: -x["count"])[:20]
    return {"by_city": city_data, "by_state": state_data}

class CsvExportInput(BaseModel):
    fields: List[str]
    run_id: Optional[str] = None  # None = all contacts

@api_router.post("/contacts/download")
async def download_custom_csv(input: CsvExportInput, request: Request):
    """Download CSV with user-selected fields. run_id=null means all contacts."""
    user = await get_current_user(request)
    query = {"user_id": user["_id"]}
    if input.run_id:
        query["run_id"] = input.run_id
    contacts = await db.contacts.find(query, {"_id": 0}).sort("created_at", 1).to_list(50000)
    # Map import_date
    run_dates = {}
    runs = await db.runs.find({"user_id": user["_id"]}, {"_id": 0, "id": 1, "created_at": 1}).to_list(500)
    for r in runs:
        run_dates[r["id"]] = r.get("created_at", "")
    field_map = {
        "city": "City", "state": "State", "quote_amount": "Quote Amount",
        "bid_by": "Bid By", "contractor": "Contractor", "sub_contractor": "Sub-Contractor",
        "customer_contact_name": "Customer Contact", "customer_business": "Customer Business",
        "customer_address": "Customer Address",
        "last_name": "Last Name", "first_name": "First Name", "email": "Email",
        "phone": "Phone", "source_filename": "Source File", "import_date": "Import Date",
        "run_id": "Run ID",
    }
    headers = [field_map.get(f, f) for f in input.fields]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for c in contacts:
        c["import_date"] = run_dates.get(c.get("run_id", ""), c.get("created_at", ""))
        row = [c.get(f, "") for f in input.fields]
        writer.writerow(row)
    output.seek(0)
    fname = f"contacts_{input.run_id[:8] if input.run_id else 'all'}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"}
    )

@api_router.get("/runs/{run_id}/download/contacts")
async def download_contacts_csv(run_id: str, request: Request):
    user = await get_current_user(request)
    contacts = await db.contacts.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["City", "State", "Quote Amount", "Bid By", "Contractor", "Sub-Contractor", "Customer Contact", "Customer Business", "Customer Address", "Last Name", "First Name", "Email", "Phone", "Source File"])
    for c in contacts:
        writer.writerow([c.get("city",""), c.get("state",""), c.get("quote_amount",""), c.get("bid_by",""), c.get("contractor",""), c.get("sub_contractor",""), c.get("customer_contact_name",""), c.get("customer_business",""), c.get("customer_address",""), c.get("last_name",""), c.get("first_name",""), c.get("email",""), c.get("phone",""), c.get("source_filename","")])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=contacts_{run_id[:8]}.csv"}
    )

@api_router.get("/runs/{run_id}/download/errors")
async def download_errors_csv(run_id: str, request: Request):
    user = await get_current_user(request)
    errors = await db.processing_errors.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(1000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Filename", "Reason", "Missing Fields"])
    for e in errors:
        writer.writerow([e.get("filename",""), e.get("reason",""), e.get("missing_fields","")])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=error_report_{run_id[:8]}.csv"}
    )

# =============================================================================
# DELETE ROUTES
# =============================================================================
@api_router.delete("/runs/{run_id}")
async def delete_run(run_id: str, request: Request):
    user = await get_current_user(request)
    run = await db.runs.find_one({"id": run_id, "user_id": user["_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    await db.runs.delete_one({"id": run_id, "user_id": user["_id"]})
    await db.contacts.delete_many({"run_id": run_id, "user_id": user["_id"]})
    await db.processing_errors.delete_many({"run_id": run_id, "user_id": user["_id"]})
    await db.duplicates.delete_many({"run_id": run_id, "user_id": user["_id"]})
    await db.progress.delete_many({"run_id": run_id})
    await db.files.update_many({"run_id": run_id, "user_id": user["_id"]}, {"$set": {"is_deleted": True}})
    return {"message": "Run deleted"}

@api_router.delete("/data/all")
async def delete_all_data(request: Request):
    user = await get_current_user(request)
    uid = user["_id"]
    results = {}
    results["runs"] = (await db.runs.delete_many({"user_id": uid})).deleted_count
    results["contacts"] = (await db.contacts.delete_many({"user_id": uid})).deleted_count
    results["errors"] = (await db.processing_errors.delete_many({"user_id": uid})).deleted_count
    results["duplicates"] = (await db.duplicates.delete_many({"user_id": uid})).deleted_count
    results["files"] = (await db.files.update_many({"user_id": uid}, {"$set": {"is_deleted": True}})).modified_count
    run_ids = [r["run_id"] async for r in db.progress.find({})]
    await db.progress.delete_many({})
    return {"message": "All data deleted", "deleted": results}

# =============================================================================
# STARTUP / MIDDLEWARE
# =============================================================================
@app.on_event("startup")
async def startup():
    # Ensure poppler is installed (needed for pdf2image)
    import subprocess
    try:
        subprocess.run(["which", "pdftoppm"], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        logger.warning("poppler-utils not found, installing...")
        subprocess.run(["apt-get", "install", "-y", "poppler-utils"], capture_output=True)
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.runs.create_index([("user_id", 1), ("created_at", -1)])
    await db.contacts.create_index("run_id")
    await db.processing_errors.create_index("run_id")
    await db.files.create_index("run_id")
    await db.progress.create_index("run_id")
    await db.duplicates.create_index("run_id")
    await db.raw_contacts.create_index("run_id")
    # Recover stale "processing" runs from server restarts
    stale = await db.runs.count_documents({"status": "processing"})
    if stale > 0:
        await db.runs.update_many({"status": "processing"}, {"$set": {"status": "stale"}})
        await db.progress.update_many({"status": "processing"}, {"$set": {"status": "stale", "message": "Processing interrupted — click Retry to resume"}})
        logger.warning(f"Marked {stale} stale processing runs for retry")
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@trueflow.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "TrueFlow2024!")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        hashed = hash_password(admin_password)
        result = await db.users.insert_one({
            "email": admin_email, "password_hash": hashed,
            "name": "Admin", "role": "admin",
            "must_change_password": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        user_id = str(result.inserted_id)
        await db.settings.insert_one({
            "user_id": user_id,
            "exclusion_domain": "horizonc.com",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        logger.info(f"Admin user created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password), "must_change_password": True}})
    # Seed admin config if not exists
    admin_config = await db.admin_config.find_one({"key": "global"})
    if not admin_config:
        await db.admin_config.insert_one({
            "key": "global",
            "ai_model": "claude-sonnet",
            "claude_api_key": "",
            "openai_api_key": "",
            "max_pdfs_per_upload": 50,
            "storage_max_mb": 750,
            "storage_target_mb": 300,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        logger.info("Admin config seeded")
    # Write test credentials
    os.makedirs("/app/memory", exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write(f"# Test Credentials\n\n## Admin Account\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n")
        f.write("## Auth Endpoints\n- POST /api/auth/register\n- POST /api/auth/login\n- POST /api/auth/logout\n- GET /api/auth/me\n- POST /api/auth/refresh\n")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown():
    client.close()
