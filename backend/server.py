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

from emergentintegrations.llm.chat import LlmChat, UserMessage

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
    ai_model: Optional[str] = None
    claude_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    exclusion_domain: Optional[str] = None

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
    return {"_id": user_id, "email": email, "name": user.get("name", ""), "role": user.get("role", "user")}

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
# SETTINGS ROUTES
# =============================================================================
@api_router.get("/settings")
async def get_settings(request: Request):
    user = await get_current_user(request)
    settings = await db.settings.find_one({"user_id": user["_id"]}, {"_id": 0})
    if not settings:
        settings = {"user_id": user["_id"], "ai_model": "claude-sonnet", "claude_api_key": "", "openai_api_key": "", "exclusion_domain": "horizonc.com"}
    if settings.get("claude_api_key"):
        settings["claude_api_key_set"] = True
        settings["claude_api_key"] = ""
    else:
        settings["claude_api_key_set"] = False
    if settings.get("openai_api_key"):
        settings["openai_api_key_set"] = True
        settings["openai_api_key"] = ""
    else:
        settings["openai_api_key_set"] = False
    return settings

@api_router.put("/settings")
async def update_settings(input: SettingsInput, request: Request):
    user = await get_current_user(request)
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if input.ai_model is not None:
        update["ai_model"] = input.ai_model
    if input.claude_api_key is not None:
        update["claude_api_key"] = input.claude_api_key
    if input.openai_api_key is not None:
        update["openai_api_key"] = input.openai_api_key
    if input.exclusion_domain is not None:
        update["exclusion_domain"] = input.exclusion_domain
    await db.settings.update_one({"user_id": user["_id"]}, {"$set": update}, upsert=True)
    return {"message": "Settings updated"}

# =============================================================================
# MODEL CONFIG
# =============================================================================
MODEL_MAP = {
    "claude-sonnet": ("anthropic", "claude-4-sonnet-20250514"),
    "claude-haiku": ("anthropic", "claude-haiku-4-5-20251001"),
    "gpt-4o": ("openai", "gpt-4o"),
}

def get_api_key_for_model(ai_model: str, settings: dict) -> str:
    if ai_model.startswith("claude"):
        custom_key = settings.get("claude_api_key", "")
        if custom_key:
            return custom_key
    elif ai_model.startswith("gpt"):
        custom_key = settings.get("openai_api_key", "")
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

    for file in files:
        data = await file.read()
        if file.filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    for name in zf.namelist():
                        if name.lower().endswith(".pdf") and not name.startswith("__MACOSX"):
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
    return {
        "run_id": run_id,
        "files": [{"id": f["id"], "filename": f["original_filename"], "size": f["size"]} for f in file_records],
        "total_files": len(file_records)
    }

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
        system_message="You are a data extraction specialist for construction industry documents. Extract contact information accurately. Always return valid JSON."
    ).with_model(provider, model)
    max_chars = 50000
    truncated = text[:max_chars] if len(text) > max_chars else text
    prompt = f"""Extract ALL contact information from this construction document. Return a JSON array of contact objects.

Each contact object must have exactly these fields:
- "city": string
- "state": string
- "bid_by": string (the full name of the person placing the bid)
- "company": string
- "last_name": string
- "first_name": string
- "email": string
- "phone": string

Rules:
- If a field is not found, use empty string ""
- Include ALL contacts found even if some fields are missing
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
                "bid_by": str(c.get("bid_by", "")),
                "company": str(c.get("company", "")),
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

async def process_run(run_id: str, user_id: str):
    try:
        settings = await db.settings.find_one({"user_id": user_id}, {"_id": 0})
        if not settings:
            settings = {"ai_model": "claude-sonnet", "exclusion_domain": "horizonc.com"}
        ai_model = settings.get("ai_model", "claude-sonnet")
        api_key = get_api_key_for_model(ai_model, settings)
        exclusion_domain = settings.get("exclusion_domain", "horizonc.com").lower().strip()
        files = await db.files.find({"run_id": run_id, "is_deleted": False}, {"_id": 0}).to_list(1000)
        total_files = len(files)
        if total_files == 0:
            await db.runs.update_one({"id": run_id}, {"$set": {"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}})
            return
        await db.progress.update_one(
            {"run_id": run_id},
            {"$set": {"status": "processing", "current_file": "", "total_files": total_files, "processed_files": 0, "percentage": 0, "message": "Starting extraction..."}},
            upsert=True
        )
        all_contacts = []
        error_count = 0
        processed_count = 0

        for i in range(0, total_files, BATCH_SIZE):
            batch = files[i:i + BATCH_SIZE]
            for file_record in batch:
                filename = file_record["original_filename"]
                await db.progress.update_one(
                    {"run_id": run_id},
                    {"$set": {"current_file": filename, "processed_files": processed_count, "percentage": int(processed_count / total_files * 100), "message": f"Processing {filename}..."}}
                )
                try:
                    pdf_bytes = get_object(file_record["storage_path"])
                    # Compress large PDFs before processing
                    if len(pdf_bytes) > PDF_SIZE_THRESHOLD:
                        pdf_bytes = compress_pdf(pdf_bytes, filename)
                    text, text_error = await extract_text_from_pdf(pdf_bytes, filename)
                    if text_error and not text_error.get("partial", False):
                        await db.processing_errors.insert_one({
                            "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                            "filename": filename, "reason": text_error["reason"],
                            "missing_fields": text_error.get("missing_fields", ""),
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                        error_count += 1
                        processed_count += 1
                        continue
                    contacts, ai_error = await extract_contacts_with_ai(text, ai_model, api_key)
                    if ai_error and not contacts:
                        await db.processing_errors.insert_one({
                            "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                            "filename": filename, "reason": f"AI extraction failed: {ai_error}",
                            "missing_fields": "All fields",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                        error_count += 1
                        processed_count += 1
                        continue
                    if not contacts:
                        await db.processing_errors.insert_one({
                            "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                            "filename": filename, "reason": "No contact information found in document",
                            "missing_fields": "All fields",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                        error_count += 1
                    for contact in contacts:
                        missing = []
                        for f in ["email", "phone", "city", "state", "company"]:
                            if not contact.get(f):
                                missing.append(f.capitalize())
                        if missing and len(missing) >= 4:
                            await db.processing_errors.insert_one({
                                "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                                "filename": filename, "reason": "Incomplete extraction - most fields missing",
                                "missing_fields": ", ".join(missing),
                                "created_at": datetime.now(timezone.utc).isoformat()
                            })
                        contact["source_filename"] = filename
                        all_contacts.append(contact)
                    if text_error and text_error.get("partial"):
                        await db.processing_errors.insert_one({
                            "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                            "filename": filename, "reason": text_error["reason"],
                            "missing_fields": "Possible inaccuracies in all fields",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                        error_count += 1
                    processed_count += 1
                except Exception as e:
                    logger.error(f"Error processing {filename}: {e}")
                    await db.processing_errors.insert_one({
                        "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                        "filename": filename, "reason": f"Processing error: {str(e)}",
                        "missing_fields": "All fields",
                        "created_at": datetime.now(timezone.utc).isoformat()
                    })
                    error_count += 1
                    processed_count += 1

        # Post-processing
        total_extracted = len(all_contacts)
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
                    "first_name": c.get("first_name", ""),
                    "last_name": c.get("last_name", ""),
                    "company": c.get("company", ""),
                    "city": c.get("city", ""),
                    "state": c.get("state", ""),
                    "phone": c.get("phone", ""),
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            else:
                if email:
                    seen_emails[email] = c
                unique_contacts.append(c)
        all_contacts = unique_contacts
        if duplicate_records:
            await db.duplicates.insert_many(duplicate_records)
        if all_contacts:
            contact_docs = [{
                "id": str(uuid.uuid4()), "run_id": run_id, "user_id": user_id,
                **c, "created_at": datetime.now(timezone.utc).isoformat()
            } for c in all_contacts]
            await db.contacts.insert_many(contact_docs)
        stats = {
            "total_pdfs": total_files,
            "processed": total_files - error_count,
            "errors": error_count,
            "contacts_extracted": total_extracted,
            "duplicates_removed": duplicates_removed,
            "excluded_no_contact": excluded_no_contact,
            "excluded_internal": excluded_internal,
            "net_new": len(all_contacts)
        }
        await db.runs.update_one(
            {"id": run_id},
            {"$set": {"status": "completed", "stats": stats, "completed_at": datetime.now(timezone.utc).isoformat()}}
        )
        await db.progress.update_one(
            {"run_id": run_id},
            {"$set": {"status": "completed", "percentage": 100, "processed_files": total_files, "message": "Extraction complete!"}}
        )
        logger.info(f"Run {run_id} completed: {len(all_contacts)} contacts from {total_files} files")
    except Exception as e:
        logger.error(f"Run {run_id} failed: {e}")
        await db.runs.update_one({"id": run_id}, {"$set": {"status": "failed"}})
        await db.progress.update_one(
            {"run_id": run_id},
            {"$set": {"status": "failed", "message": f"Processing failed: {str(e)}"}}
        )

@api_router.post("/extract/{run_id}")
async def start_extraction(run_id: str, request: Request):
    user = await get_current_user(request)
    run = await db.runs.find_one({"id": run_id, "user_id": user["_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run["status"] == "processing":
        raise HTTPException(status_code=400, detail="Run is already being processed")
    await db.runs.update_one({"id": run_id}, {"$set": {"status": "processing"}})
    asyncio.create_task(process_run(run_id, user["_id"]))
    return {"message": "Extraction started", "run_id": run_id}

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
    contacts = await db.contacts.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(5000)
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

@api_router.get("/runs/{run_id}/download/contacts")
async def download_contacts_csv(run_id: str, request: Request):
    user = await get_current_user(request)
    contacts = await db.contacts.find({"run_id": run_id, "user_id": user["_id"]}, {"_id": 0}).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["City", "State", "Bid By", "Company", "Last Name", "First Name", "Email", "Phone", "Source File"])
    for c in contacts:
        writer.writerow([c.get("city",""), c.get("state",""), c.get("bid_by",""), c.get("company",""), c.get("last_name",""), c.get("first_name",""), c.get("email",""), c.get("phone",""), c.get("source_filename","")])
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
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@trueflow.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "TrueFlow2024!")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        hashed = hash_password(admin_password)
        result = await db.users.insert_one({
            "email": admin_email, "password_hash": hashed,
            "name": "Admin", "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        user_id = str(result.inserted_id)
        await db.settings.insert_one({
            "user_id": user_id, "ai_model": "claude-sonnet",
            "claude_api_key": "", "openai_api_key": "",
            "exclusion_domain": "horizonc.com",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        logger.info(f"Admin user created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
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
