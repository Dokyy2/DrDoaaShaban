const CLINIC_EMAILS = "dokyy2@gmail.com, dshaban901@gmail.com";
const TIMEZONE = "Africa/Cairo";
const MAX_DAILY_SLOTS = 20;

function doGet(e) {
  try {
    const mode = e.parameter.mode || "";

    if (mode === "stats") {
      return jsonOutput(getBookingStats(e.parameter.date));
    }

    return jsonOutput({
      status: "ready",
      message: "Dr. Doaa Shaban booking system is running"
    });

  } catch (err) {
    return jsonOutput({
      status: "error",
      message: err.toString()
    });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(15000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sheet = getOrCreateSheet(ss, "Sheet1", [
      "ID", "Name", "Phone", "Type", "Booking Date", "Last Visit", "Registration Time", "Status", "Source", "Notes", "Message", "Attachment"
    ]);

    const contactsSheet = getOrCreateSheet(ss, "Sheet2", [
      "ID", "Name", "Phone", "Message", "Source", "Registration Time"
    ]);

    const birthSheet = getOrCreateSheet(ss, "Sheet3", [
      "ID", "Name", "Phone", "Expected Delivery Date", "Registration Time", "Message", "Source", "Status"
    ]);

    const data = JSON.parse(e.postData.contents || "{}");

        /* =======================================
       تعديل: إجازة عيد الأضحى المبارك
       من 26 مايو 2026 حتى 31 مايو 2026
       والعودة للعمل يوم الاثنين 1 يونيو 2026
       ======================================= */
    if (data.bookingDate) {
      const reqDate = safeDate(data.bookingDate);
      const reqKey = Utilities.formatDate(reqDate, TIMEZONE, "yyyy-MM-dd");

      if (reqKey >= "2026-05-26" && reqKey <= "2026-05-31") {
        return jsonOutput({
          status: "holiday",
          message: "العيادة إجازة من الثلاثاء 26 مايو 2026 حتى الأحد 31 مايو 2026، والعودة للعمل يوم الاثنين 1 يونيو 2026. كل عام وأنتم بخير 🎉"
        });
      }
    }
    
    /* ======================================= */

    const requestType = normalizeText(data.type || data.source || "");

    if (isContactRequest(requestType)) {
      return handleContactLead(contactsSheet, data);
    }

    if (isBirthRequest(requestType)) {
      return handleBirthBooking(birthSheet, data);
    }

    const duplicate = checkDuplicateBooking(sheet, data.phone);

    if (duplicate.isDuplicated) {
      sendDuplicateEmail(data, duplicate);
      return jsonOutput({
        status: "duplicated",
        id: duplicate.id || "",
        message: "عذراً، هذا الرقم لديه حجز قائم بالفعل بتاريخ " + duplicate.formattedDate + ". يرجى الانتظار حتى انتهاء الموعد أو التواصل مع العيادة للإلغاء.",
        name: data.name,
        phone: data.phone,
        type: data.type,
        date: duplicate.formattedDate
      });
    }

    const bookingDate = safeDate(data.bookingDate);
    const formattedDate = formatArabicDate(bookingDate);
    const registrationTime = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");

    const lastRow = sheet.getLastRow();
    const seqNumber = Math.max(1, lastRow).toString();
    const displayID = buildBookingId(data.type, seqNumber);

    const attachmentInfo = buildAttachment(data);

    sheet.appendRow([
      displayID,
      data.name || "",
      "'" + cleanPhone(data.phone),
      data.type || "",
      data.bookingDate || "",
      data.lastVisit || "-",
      registrationTime,
      "جديد",
      data.source || "-",
      "",
      data.message || "-",
      attachmentInfo.name || "-"
    ]);

    sendNewBookingEmail({
      id: displayID,
      name: data.name || "",
      phone: cleanPhone(data.phone),
      type: data.type || "",
      bookingDate: data.bookingDate || "",
      formattedDate,
      lastVisit: data.lastVisit || "-",
      registrationTime,
      source: data.source || "-",
      message: data.message || "-",
      attachment: attachmentInfo
    });

    return jsonOutput({
      status: "success",
      id: displayID,
      name: data.name,
      phone: data.phone,
      type: data.type,
      date: formattedDate,
      registrationTime: registrationTime,
      attachment: attachmentInfo.name ? "يوجد مرفقات" : "لا يوجد"
    });

  } catch (err) {
    return jsonOutput({
      status: "error",
      message: err.toString()
    });

  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function handleBirthBooking(sheet, data) {
  const registrationTime = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  const expectedDate = data.bookingDate || data.expectedDeliveryDate || "";
  const formattedDate = expectedDate ? formatArabicDate(safeDate(expectedDate)) : "-";
  const nextId = getNextBirthId(sheet);

  sheet.appendRow([
    nextId,
    data.name || "",
    "'" + cleanPhone(data.phone),
    expectedDate,
    registrationTime,
    data.message || "-",
    data.source || "حجز ولادة",
    "جديد"
  ]);

  sendBirthBookingEmail({
    id: nextId,
    name: data.name || "",
    phone: cleanPhone(data.phone),
    type: data.type || "حجز ولادة",
    expectedDate: expectedDate,
    formattedDate: formattedDate,
    registrationTime: registrationTime,
    source: data.source || "حجز ولادة",
    message: data.message || "-"
  });

  return jsonOutput({
    status: "success",
    id: nextId,
    name: data.name,
    phone: data.phone,
    type: data.type || "حجز ولادة",
    date: formattedDate,
    registrationTime: registrationTime,
    attachment: "لا يوجد"
  });
}

function getNextBirthId(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return "W1";
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let maxNum = 0;

  values.forEach(function(row) {
    const id = (row[0] || "").toString().trim();
    const match = id.match(/^W(\d+)$/i);

    if (match) {
      const num = Number(match[1]);
      if (num > maxNum) maxNum = num;
    }
  });

  return "W" + (maxNum + 1);
}

function handleContactLead(sheet, data) {
  const existing = findContactByPhone(sheet, data.phone);
  const registrationTime = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");

  if (existing.found) {
    sendContactLeadEmail({
      id: existing.id,
      name: data.name || "",
      phone: cleanPhone(data.phone),
      message: data.message || "-",
      source: data.source || "عائلة العيادة",
      registrationTime,
      existing: true
    });

    return jsonOutput({
      status: "success",
      id: existing.id,
      message: "تم تحديث الاهتمام، العميل مسجل بالفعل في عائلة العيادة."
    });
  }

  const nextId = "C" + Math.max(1, sheet.getLastRow()).toString();

  sheet.appendRow([
    nextId,
    data.name || "",
    "'" + cleanPhone(data.phone),
    data.message || "-",
    data.source || "عائلة العيادة",
    registrationTime
  ]);

  sendContactLeadEmail({
    id: nextId,
    name: data.name || "",
    phone: cleanPhone(data.phone),
    message: data.message || "-",
    source: data.source || "عائلة العيادة",
    registrationTime,
    existing: false
  });

  return jsonOutput({
    status: "success",
    id: nextId,
    message: "تم تسجيل العميل ضمن عائلة العيادة."
  });
}

function sendNewBookingEmail(info) {
  const htmlBody = buildPremiumEmailTemplate({
    badge: "طلب موعد جديد",
    title: "تم استقبال طلب حجز من المريضة",
    id: info.id,
    idLabel: "رقم الحجز",
    icon: "📅",
    phone: info.phone,
    intro: "طلب جديد يحتاج مراجعة وتأكيد ساعة الحضور مع المريضة.",
    rows: [
      ["👤 اسم المريضة", info.name, "highlight-pink"],
      ["📱 رقم الهاتف", info.phone, "highlight-blue"],
      ["🩺 نوع الطلب", info.type, ""],
      ["📅 تاريخ الحجز", info.formattedDate, "highlight-green"],
      ["🕒 وقت التسجيل", info.registrationTime, ""],
      ["🔁 آخر زيارة", info.lastVisit, ""],
      ["🔍 المصدر", info.source, ""],
      ["💬 الرسالة", info.message, ""],
      ["📎 المرفقات", info.attachment.name ? "يوجد مرفق: " + info.attachment.name : "لا يوجد", info.attachment.name ? "highlight-orange" : ""]
    ],
    footerNote: "برجاء التواصل مع المريضة لتأكيد ساعة الحضور. الحجز لا يعتبر مؤكداً إلا بعد التواصل."
  });

  const mailOptions = {
    to: CLINIC_EMAILS,
    subject: "🌸 طلب موعد من " + info.name + " - رقم " + info.id,
    htmlBody: htmlBody
  };

  if (info.attachment.blob) {
    mailOptions.attachments = [info.attachment.blob];
  }

  MailApp.sendEmail(mailOptions);
}

function sendBirthBookingEmail(info) {
  const daysLeft = calculateDaysLeft(info.expectedDate);

  const htmlBody = buildPremiumEmailTemplate({
    badge: "طلب حجز ولادة",
    title: "تم استقبال طلب حجز ولادة",
    id: info.id,
    idLabel: "رقم حجز الولادة",
    icon: "👶",
    phone: info.phone,
    intro: "طلب حجز ولادة جديد يحتاج تواصل من العيادة لترتيب التفاصيل وتحديد الخطوات المناسبة.",
    rows: [
      ["👤 اسم المريضة", info.name, "highlight-pink"],
      ["📱 رقم الهاتف", info.phone, "highlight-blue"],
      ["🩺 نوع الطلب", info.type, ""],
      ["📅 تاريخ الولادة المتوقع", info.formattedDate, "highlight-green"],
      ["⏳ المتبقي تقريباً", daysLeft >= 0 ? daysLeft + " يوم" : "-", "highlight-orange"],
      ["🕒 وقت التسجيل", info.registrationTime, ""],
      ["🔍 المصدر", info.source, ""],
      ["💬 الرسالة", info.message, ""]
    ],
    footerNote: "برجاء التواصل مع المريضة لترتيب تفاصيل الولادة وتأكيد طريقة المتابعة."
  });

  MailApp.sendEmail({
    to: CLINIC_EMAILS,
    subject: "👶 طلب حجز ولادة - " + info.name + " (" + info.id + ")",
    htmlBody: htmlBody
  });
}

function sendDuplicateEmail(data, duplicate) {
  const htmlBody = buildPremiumEmailTemplate({
    badge: "تنبيه حجز مكرر",
    title: "تم رصد محاولة حجز برقم لديه موعد قائم",
    id: duplicate.id || "بدون رقم",
    idLabel: "رقم الحجز القائم",
    icon: "⚠️",
    phone: cleanPhone(data.phone),
    intro: "المريضة حاولت تسجيل حجز جديد، لكن النظام وجد موعداً قائماً بنفس رقم الهاتف.",
    rows: [
      ["👤 اسم المريضة", data.name || "-", "highlight-pink"],
      ["📱 رقم الهاتف", cleanPhone(data.phone), "highlight-blue"],
      ["🩺 الطلب الجديد", data.type || "-", ""],
      ["📅 تاريخ الحجز القائم", duplicate.formattedDate, "highlight-green"],
      ["🕒 وقت التنبيه", Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss"), ""]
    ],
    footerNote: "لو المريضة ترغب في تعديل أو إلغاء الموعد، يرجى التواصل معها مباشرة."
  });

  MailApp.sendEmail({
    to: CLINIC_EMAILS,
    subject: "⚠️ حجز مكرر محتمل - " + (data.name || cleanPhone(data.phone)),
    htmlBody: htmlBody
  });
}

function sendContactLeadEmail(info) {
  const htmlBody = buildPremiumEmailTemplate({
    badge: info.existing ? "عميل مسجل بالفعل" : "عضو جديد في عائلة العيادة",
    title: info.existing ? "بيانات عميل موجود ضمن عائلة العيادة" : "تم تسجيل عميل جديد ضمن عائلة العيادة",
    id: info.id,
    idLabel: "رقم العميل في العيادة",
    icon: "💗",
    phone: info.phone,
    intro: "هذه البيانات خاصة بالتواصل، العروض، المتابعة، وقنوات السوشيال الخاصة بالعيادة.",
    rows: [
      ["🆔 رقم العميل", info.id, "highlight-orange"],
      ["👤 الاسم", info.name, "highlight-pink"],
      ["📱 رقم الهاتف", info.phone, "highlight-blue"],
      ["🔍 المصدر", info.source, ""],
      ["💬 ملاحظة العميل", info.message, ""],
      ["🕒 وقت التسجيل", info.registrationTime, ""]
    ],
    footerNote: "هذا التسجيل ليس حجز موعد، لكنه إضافة لقائمة التواصل والعروض والمتابعة."
  });

  MailApp.sendEmail({
    to: CLINIC_EMAILS,
    subject: "💗 عائلة العيادة - " + info.name + " (" + info.id + ")",
    htmlBody: htmlBody
  });
}

function buildPremiumEmailTemplate(config) {
  const rowsHtml = config.rows.map(function(row) {
    return `
      <tr>
        <td style="padding:13px 0;color:#64748b;font-weight:700;border-bottom:1px solid #eef2f7;">${row[0]}</td>
        <td style="padding:13px 0;text-align:left;border-bottom:1px solid #eef2f7;">
          <span class="${row[2]}" style="font-weight:900;">${escapeHtml(row[1])}</span>
        </td>
      </tr>
    `;
  }).join("");

  const phone = cleanPhone(config.phone || "");
  const whatsappUrl = phone ? "https://wa.me/2" + phone.replace(/^0/, "") : "";
  const telUrl = phone ? "tel:" + phone : "";

  const actionButtons = phone ? `
    <div style="margin:24px 0 8px;text-align:center;">
      <a href="${whatsappUrl}" style="display:inline-block;margin:6px;padding:13px 18px;border-radius:999px;background:#25d366;color:#ffffff;text-decoration:none;font-weight:900;font-size:14px;">
        واتساب العميل
      </a>
      <a href="${telUrl}" style="display:inline-block;margin:6px;padding:13px 18px;border-radius:999px;background:#0ea5e9;color:#ffffff;text-decoration:none;font-weight:900;font-size:14px;">
        اتصال مباشر
      </a>
    </div>
  ` : "";

  return `
  <div style="direction:rtl;background:#f4fbff;padding:26px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
    <style>
      .highlight-pink{color:#be185d;background:#fdf2f8;padding:5px 10px;border-radius:999px;display:inline-block;}
      .highlight-blue{color:#0369a1;background:#e0f2fe;padding:5px 10px;border-radius:999px;display:inline-block;}
      .highlight-green{color:#047857;background:#ecfdf5;padding:5px 10px;border-radius:999px;display:inline-block;}
      .highlight-orange{color:#c2410c;background:#fff7ed;padding:5px 10px;border-radius:999px;display:inline-block;}
    </style>

    <div style="max-width:620px;margin:auto;background:#ffffff;border-radius:28px;overflow:hidden;box-shadow:0 24px 60px rgba(15,111,134,0.16);border:1px solid #dff7ff;">
      
      <div style="background:linear-gradient(135deg,#0ea5e9,#ec4899);padding:28px 24px;text-align:center;color:white;">
        <div style="font-size:42px;line-height:1;margin-bottom:8px;">${config.icon}</div>
        <div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);padding:7px 14px;border-radius:999px;font-size:13px;font-weight:800;margin-bottom:14px;">
          ${config.badge}
        </div>
        <h1 style="margin:0;font-size:25px;font-weight:900;line-height:1.45;">${config.title}</h1>
        <p style="margin:9px 0 0;font-size:14px;opacity:.92;font-weight:700;">عيادة د. دعاء شعبان - نساء وتوليد وتجميل نسائي</p>
      </div>

      <div style="padding:26px;">
        <div style="text-align:center;margin-top:-4px;margin-bottom:22px;">
          <div style="font-size:13px;color:#64748b;font-weight:800;margin-bottom:8px;">${config.idLabel}</div>
          <div style="display:inline-block;min-width:150px;padding:14px 22px;border-radius:22px;background:linear-gradient(135deg,#fff7ed,#fdf2f8);border:2px solid #fb7185;color:#be123c;font-size:30px;font-weight:900;letter-spacing:1px;">
            ${config.id}
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:20px;padding:16px;margin-bottom:20px;color:#334155;font-size:15px;font-weight:800;line-height:1.9;text-align:center;">
          ${config.intro}
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:15px;color:#334155;">
          ${rowsHtml}
        </table>

        <div style="margin-top:22px;padding:16px;border-radius:18px;background:#fff1f2;border:1px solid #fecdd3;color:#991b1b;font-size:14px;font-weight:900;line-height:1.8;text-align:center;">
          ${config.footerNote}
        </div>

        ${actionButtons}
      </div>

      <div style="padding:16px;text-align:center;background:#f8fafc;color:#64748b;font-size:12px;font-weight:800;border-top:1px solid #e2e8f0;">
        Future Reservation System © 2026
      </div>
    </div>
  </div>`;
}

function checkDuplicateBooking(sheet, phone) {
  const lastRow = sheet.getLastRow();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (lastRow <= 2) {
    return { isDuplicated: false };
  }

  const range = sheet.getRange(3, 1, lastRow - 2, Math.max(sheet.getLastColumn(), 6)).getValues();
  const newPhone = cleanPhone(phone);

  for (let i = 0; i < range.length; i++) {
    const id = range[i][0];
    const existingPhone = cleanPhone(range[i][2]);
    const bookingDateRaw = range[i][4];

    if (existingPhone === newPhone) {
      const bDate = safeDate(bookingDateRaw);
      bDate.setHours(0, 0, 0, 0);

      if (bDate >= now) {
        return {
          isDuplicated: true,
          id: id,
          date: bDate,
          formattedDate: Utilities.formatDate(bDate, TIMEZONE, "yyyy-MM-dd")
        };
      }
    }
  }

  return { isDuplicated: false };
}

function getBookingStats(dateParam) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, "Sheet1", [
    "ID", "Name", "Phone", "Type", "Booking Date", "Last Visit", "Registration Time", "Status", "Source", "Notes", "Message", "Attachment"
  ]);

  const lastRow = sheet.getLastRow();

  if (lastRow <= 2) {
    return {
      status: "success",
      totalBookings: 0,
      todayBookings: 0,
      availableSlots: MAX_DAILY_SLOTS
    };
  }

  const targetDate = dateParam ? safeDate(dateParam) : new Date();
  const targetKey = Utilities.formatDate(targetDate, TIMEZONE, "yyyy-MM-dd");

  const values = sheet.getRange(3, 1, lastRow - 2, Math.max(sheet.getLastColumn(), 7)).getValues();

  let totalBookings = values.length;
  let todayBookings = 0;

  values.forEach(function(row) {
    const bookingDate = row[4];
    if (!bookingDate) return;

    const bookingKey = Utilities.formatDate(safeDate(bookingDate), TIMEZONE, "yyyy-MM-dd");
    if (bookingKey === targetKey) {
      todayBookings++;
    }
  });

  return {
    status: "success",
    totalBookings: totalBookings,
    todayBookings: todayBookings,
    availableSlots: Math.max(0, MAX_DAILY_SLOTS - todayBookings)
  };
}

function findContactByPhone(sheet, phone) {
  const lastRow = sheet.getLastRow();
  const newPhone = cleanPhone(phone);

  if (lastRow <= 1) {
    return { found: false };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 3)).getValues();

  for (let i = 0; i < values.length; i++) {
    const id = values[i][0];
    const existingPhone = cleanPhone(values[i][2]);

    if (existingPhone === newPhone) {
      return {
        found: true,
        id: id
      };
    }
  }

  return { found: false };
}

function buildAttachment(data) {
  const fileName = data.fileName || data.attachmentName || "";
  const fileType = data.fileType || "application/octet-stream";
  const fileData = data.fileData || data.attachmentBase64 || "";

  if (!fileName || !fileData) {
    return {
      name: "",
      blob: null
    };
  }

  try {
    return {
      name: fileName,
      blob: Utilities.newBlob(Utilities.base64Decode(fileData), fileType, fileName)
    };
  } catch (e) {
    return {
      name: fileName,
      blob: null
    };
  }
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

function buildBookingId(type, seq) {
  const normalizedType = normalizeText(type);

  if (normalizedType.indexOf("تجميل") !== -1 || normalizedType.indexOf("aesthetic") !== -1) {
    return "A" + seq;
  }

  if (normalizedType.indexOf("ولادة") !== -1 || normalizedType.indexOf("delivery") !== -1) {
    return "D" + seq;
  }

  if (normalizedType.indexOf("تحاليل") !== -1 || normalizedType.indexOf("labs") !== -1 || normalizedType.indexOf("scan") !== -1) {
    return "L" + seq;
  }

  return "B" + seq;
}

function isContactRequest(type) {
  const normalized = normalizeText(type);
  return normalized.indexOf("عائلة") !== -1 ||
         normalized.indexOf("contacts") !== -1 ||
         normalized.indexOf("contact") !== -1 ||
         normalized.indexOf("family") !== -1;
}

function isBirthRequest(type) {
  const normalized = normalizeText(type);
  return normalized.indexOf("ولادة") !== -1 ||
         normalized.indexOf("delivery") !== -1 ||
         normalized.indexOf("birth") !== -1;
}

function calculateDaysLeft(dateValue) {
  if (!dateValue) return -1;

  const target = safeDate(dateValue);
  const today = new Date();

  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function formatArabicDate(date) {
  const days = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  return days[date.getDay()] + " " + date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear();
}

function safeDate(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}

function cleanPhone(phone) {
  return (phone || "").toString().replace(/'/g, "").replace(/\s/g, "").trim();
}

function normalizeText(value) {
  return (value || "").toString().toLowerCase().trim();
}

function escapeHtml(value) {
  return (value || "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}