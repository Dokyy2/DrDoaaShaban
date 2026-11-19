const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function hasIsoBmffBrand(bytes, brands) {
  return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && brands.includes(ascii(bytes, 8, 4));
}

function base64Padding(value) {
  if (value.endsWith("==")) return 2;
  if (value.endsWith("=")) return 1;
  return 0;
}

function isValidBase64(value, padding) {
  if (!value || value.length % 4 !== 0 || padding > 2) return false;
  const dataLength = value.length - padding;
  if ((padding === 2 && dataLength % 4 !== 2) || (padding === 1 && dataLength % 4 !== 3)) return false;
  for (let index = 0; index < dataLength; index += 1) {
    const code = value.charCodeAt(index);
    const valid = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (!valid) return false;
  }
  if (padding === 2 && ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(value[dataLength - 1]) & 15) !== 0) return false;
  if (padding === 1 && ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(value[dataLength - 1]) & 3) !== 0) return false;
  return true;
}

function contentMatchesMime(bytes, mime) {
  switch (mime) {
    case "application/pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    case "image/jpeg":
    case "image/jpg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
    case "image/webp":
      return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6));
    case "image/bmp":
    case "image/x-ms-bmp":
      return ascii(bytes, 0, 2) === "BM";
    case "image/tiff":
      return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
        (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a);
    case "image/avif":
      return hasIsoBmffBrand(bytes, ["avif", "avis"]);
    case "image/heic":
      return hasIsoBmffBrand(bytes, ["heic", "heix", "hevc", "hevx"]);
    case "image/heif":
      return hasIsoBmffBrand(bytes, ["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
    default:
      return false;
  }
}

export function validateBookingAttachment(payload) {
  const rawName = payload.attachmentName ?? "";
  const rawType = payload.attachmentType ?? "";
  const rawBase64 = payload.attachmentBase64 ?? "";
  if (typeof rawName !== "string" || typeof rawType !== "string" || typeof rawBase64 !== "string") {
    return { ok: false, message: "بيانات المرفق غير صحيحة." };
  }

  if (!rawName && !rawType && !rawBase64) return { ok: true, payload };
  if (!rawName || !rawType || !rawBase64) {
    return { ok: false, message: "المرفق غير مكتمل. أعيدي اختيار الملف وحاولي مرة أخرى." };
  }

  const attachmentName = rawName.trim().replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "");
  const attachmentType = rawType.trim().toLowerCase();
  if (!attachmentName || attachmentName.length > 180) {
    return { ok: false, message: "اسم المرفق غير صالح أو أطول من الحد المسموح." };
  }
  if (!/^(application\/pdf|image\/(jpeg|jpg|png|webp|gif|bmp|x-ms-bmp|tiff|avif|heic|heif))$/.test(attachmentType)) {
    return { ok: false, message: "صيغة المرفق غير مدعومة. استخدمي صورة أو ملف PDF." };
  }
  const padding = base64Padding(rawBase64);
  const decodedLength = rawBase64.length / 4 * 3 - padding;
  if (decodedLength <= 0 || decodedLength > MAX_ATTACHMENT_BYTES) {
    return { ok: false, message: "حجم المرفق يجب ألا يتجاوز 5 ميجابايت." };
  }
  if (!isValidBase64(rawBase64, padding)) {
    return { ok: false, message: "بيانات الملف غير مكتملة. أعيدي اختياره وحاولي مرة أخرى." };
  }

  let decoded;
  try {
    decoded = atob(rawBase64);
  } catch {
    return { ok: false, message: "تعذر التحقق من محتوى الملف." };
  }
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  if (bytes.length !== decodedLength || !contentMatchesMime(bytes, attachmentType)) {
    return { ok: false, message: "محتوى الملف لا يطابق صيغته المعلنة." };
  }

  return {
    ok: true,
    payload: { ...payload, attachmentName, attachmentType, attachmentBase64: rawBase64 },
  };
}
