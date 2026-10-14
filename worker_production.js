/**
 * ======================================================================
 * ScholTableBot - بوت نظام الجداول المدرسية + لوحة تحكم وتفعيل المطور
 * المطور: عبيده العيثاوي (هاتف: 07813332882)
 * Token: 8904287380:AAGKQ0AiVIs0P1vGtuXJbmiKrzF2IxTVZ-Q
 * ======================================================================
 */

const BOT_TOKEN = "8904287380:AAGKQ0AiVIs0P1vGtuXJbmiKrzF2IxTVZ-Q";
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const DEV_CHAT_ID = "152262024";
const LIC_SECRET = "ObaidaQiYear20k929519"; // سر التشفير الحقيقي لتطبيق سطح المكتب

// ذاكرة احتياطية في حال تأخر ربط الـ KV
globalThis._MEM_CACHE = globalThis._MEM_CACHE || {
  memberToOwner: {},
  users: [],
  data: {},
  schools: {},
  members: {},
  admin_id: DEV_CHAT_ID
};

// كيبورد المستخدم العادي
const USER_KEYBOARD = {
  keyboard: [
    [{ text: "📅 جدول اليوم" }, { text: "📆 جدول الأسبوع" }],
    [{ text: "👨‍🏫 تقرير المعلمين" }, { text: "📚 تقرير المواد" }],
    [{ text: "🏫 ملخص الشُعب" }, { text: "🛡️ مراقبة الساحة" }],
    [{ text: "💾 تحميل نسخة احتياطية" }, { text: "📱 فتح على الهاتف" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

// كيبورد المطور الكامل
const DEV_KEYBOARD = {
  keyboard: [
    [{ text: "🏫 استعراض المدارس والجداول" }, { text: "⚡ تفعيل اشتراك زبون" }],
    [{ text: "👥 قائمة المشتركين" }, { text: "📆 جدول الأسبوع" }],
    [{ text: "📅 جدول اليوم" }, { text: "👨‍🏫 تقرير المعلمين" }],
    [{ text: "📚 تقرير المواد" }, { text: "🏫 ملخص الشُعب" }],
    [{ text: "🛡️ مراقبة الساحة" }, { text: "💾 تحميل نسخة احتياطية" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

function getKV(env) {
  if (!env) return null;
  if (env.TIMETABLE_KV) return env.TIMETABLE_KV;
  if (env.TABLE_KV) return env.TABLE_KV;
  if (env.KV) return env.KV;
  return null;
}

function getD1(env) {
  if (!env) return null;
  if (env.DB && typeof env.DB.prepare === "function") return env.DB;
  return null;
}

// دالة كتابة فائقة القوة: تحفظ في D1 (100 ألف عملية يومياً) مع KV والذاكرة
async function storePut(env, key, val) {
  const d1 = getD1(env);
  const kv = getKV(env);
  globalThis._MEM_CACHE[key] = val;

  if (d1) {
    try {
      await d1.prepare("INSERT OR REPLACE INTO keyval (k, v) VALUES (?, ?)").bind(String(key), String(val)).run();
    } catch(e){}
  }
  if (kv) {
    try { await kv.put(String(key), String(val)); } catch(e){}
  }
  return true;
}

// دالة قراءة فائقة السرعة من D1 أو KV أو الذاكرة
async function storeGet(env, key) {
  const d1 = getD1(env);
  const kv = getKV(env);

  if (d1) {
    try {
      const row = await d1.prepare("SELECT v FROM keyval WHERE k = ?").bind(String(key)).first();
      if (row && row.v !== null && row.v !== undefined) return row.v;
    } catch(e){}
  }
  if (kv) {
    try {
      const val = await kv.get(String(key));
      if (val !== null && val !== undefined) return val;
    } catch(e){}
  }
  return globalThis._MEM_CACHE[key] || "";
}

// دالة كتابة آمنة تدعم كلا الواجهتين
async function safeKvPut(kv, key, val) {
  if (!kv) return false;
  try {
    await kv.put(key, val);
    return true;
  } catch (e) {
    return false;
  }
}

// حفظ قائمة أعضاء المدرسة في D1 + KV + الذاكرة
async function saveSchoolMembers(env, acc, members) {
  const val = JSON.stringify(members || []);
  globalThis._MEM_CACHE.members[acc] = members || [];
  const d1 = getD1(env);
  const kv = getKV(env);
  if (d1) {
    try {
      await d1.prepare("INSERT OR REPLACE INTO keyval (k, v) VALUES (?, ?)").bind("members_" + acc, val).run();
    } catch (e) { }
  }
  if (kv) {
    try { await kv.put("members_" + acc, val); } catch (e) { }
  }
  return true;
}

// وزن بيانات المدرسة لمنع طمس نسخة جيدة ببيانات فارغة
function dataScore(x) {
  try {
    if (!x) return 0;
    const o = (typeof x === "string") ? JSON.parse(x) : x;
    if (!o || typeof o !== "object") return 0;
    let n = 0;
    ["classes", "teachers", "subjects", "sections"].forEach(function (k) {
      if (Array.isArray(o[k])) n += o[k].length * 10;
    });
    if (o.settings && o.settings.schoolName) n += 5;
    return n;
  } catch (e) {
    return 0;
  }
}

// قراءة بيانات الجدول من كل المخازن واختيار الأفضل لمنع النسخ الفارغة/القديمة
async function getBestData(env, acc) {
  if (!acc) return "";
  const d1 = getD1(env);
  const kv = getKV(env);
  const cands = [];
  let d1Row = null, d1Ok = false;
  if (d1) {
    try {
      d1Row = await d1.prepare("SELECT v FROM keyval WHERE k = ?").bind("data_" + acc).first();
      d1Ok = true;
    } catch (e) { d1Ok = false; }
  }
  // إذا نجح استعلام D1 ولم يوجد صف = البيانات محذوفة (إزالة عضو) — لا نُرجع نسخة قديمة
  if (d1Ok && (!d1Row || !d1Row.v)) {
    try { delete globalThis._MEM_CACHE.data[acc]; } catch (e) { }
    if (kv) {
      try {
        const v0 = await kv.get("data_" + acc);
        if (v0 && dataScore(v0) > 0) return String(v0);
      } catch (e) { }
    }
    return "";
  }
  if (d1Row && d1Row.v) cands.push(String(d1Row.v));
  if (kv) {
    try {
      const v = await kv.get("data_" + acc);
      if (v) cands.push(String(v));
    } catch (e) { }
  }
  if (globalThis._MEM_CACHE.data[acc]) cands.push(String(globalThis._MEM_CACHE.data[acc]));
  let best = "";
  let bn = -1;
  cands.forEach(function (c) {
    const n = dataScore(c);
    if (n > bn) { bn = n; best = c; }
  });
  return best;
}

// حفظ بيانات الجدول في D1 + KV + الذاكرة معاً
async function saveSchoolData(env, acc, dataStr) {
  globalThis._MEM_CACHE.data[acc] = dataStr;
  const d1 = getD1(env);
  const kv = getKV(env);
  if (d1) {
    try {
      await d1.prepare("INSERT OR REPLACE INTO keyval (k, v) VALUES (?, ?)").bind("data_" + acc, String(dataStr)).run();
    } catch (e) { }
  }
  if (kv) {
    try { await kv.put("data_" + acc, String(dataStr)); } catch (e) { }
  }
  return true;
}

// حذف بيانات جدول حساب من D1 + KV + الذاكرة (يُستخدم عند إزالة عضو)
async function deleteSchoolData(env, acc) {
  try { delete globalThis._MEM_CACHE.data[acc]; } catch (e) { }
  const d1 = getD1(env);
  const kv = getKV(env);
  if (d1) {
    try {
      await d1.prepare("DELETE FROM keyval WHERE k = ? OR k = ?").bind("data_" + acc, "data_ts_" + acc).run();
    } catch (e) { }
  }
  if (kv) {
    try { await kv.delete("data_" + acc); } catch (e) { }
    try { await kv.delete("data_ts_" + acc); } catch (e) { }
  }
  try { await storePut(env, "data_" + acc, ""); } catch (e) { }
  return true;
}

// دالة توليد كود التفعيل السنوي
async function generateLicenseCode(phone, months = 12) {
  const normPhone = String(phone || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exp = new Date(Date.now() + months * 30.44 * 86400000);
  const y = exp.getFullYear();
  const m = String(exp.getMonth() + 1).padStart(2, "0");
  const d = String(exp.getDate()).padStart(2, "0");
  const exp_s = `${y}${m}${d}`;
  const raw = `${normPhone}|${exp_s}|${LIC_SECRET}`;

  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const sig = hashHex.slice(0, 8);

  return {
    code: `A-${normPhone}-${exp_s}-${sig}`,
    exp_s: exp_s,
    until: `${y}-${m}-${d}`,
    months: months
  };
}

// دالة جلب قائمة المشتركين من D1 / KV
async function getUsersList(env, kvFallback) {
  const d1 = getD1(env);
  if (d1) {
    try {
      const { results } = await d1.prepare("SELECT * FROM users").all();
      if (results && results.length > 0) {
        return results.map(r => ({
          acc: r.acc,
          school: r.school || "",
          user_name: r.user_name || "",
          date: r.date || "",
          paid: !!r.paid,
          until: r.until || "",
          last_sync: r.last_sync || "",
          members_count: r.members_count || 0
        }));
      }
    } catch(e){}
  }
  const kv = getKV(env) || kvFallback;
  if (kv) {
    try {
      const raw = await kv.get("all_users_list");
      if (raw) return JSON.parse(raw);
    } catch (e) { }
  }
  return globalThis._MEM_CACHE.users || [];
}

// دالة حفظ قائمة المشتركين في D1 / KV
async function saveUsersList(env, users, kvFallback) {
  globalThis._MEM_CACHE.users = users;
  const d1 = getD1(env);
  if (d1 && Array.isArray(users)) {
    for (const u of users) {
      try {
        await d1.prepare("INSERT OR REPLACE INTO users (acc, pw, user_name, school, date, paid, until, last_sync, members_count) VALUES (?, (SELECT pw FROM users WHERE acc=?), ?, ?, ?, ?, ?, ?, ?)")
          .bind(u.acc, u.acc, u.user_name || "", u.school || "", u.date || "", u.paid ? 1 : 0, u.until || "", u.last_sync || "", u.members_count || 0)
          .run();
      } catch (e) { }
    }
  }
  const kv = getKV(env) || kvFallback;
  if (kv) {
    try {
      await kv.put("all_users_list", JSON.stringify(users));
    } catch (e) { }
  }
}

// أيام الأسبوع باللغة العربية
const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanFilename(str) {
  return String(str || "المدرسة")
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_");
}

export default {
  async fetch(request, env) {
    globalThis._ENV = env;
    const url = new URL(request.url);
    const kv = getKV(env);

    // معالجة CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // ==========================================
    // API الانضمام لمدرسة وفريق العمل (Cloud Join & Team)
    // ==========================================
    if (url.pathname === "/api/link_school" && request.method === "POST") {
      try {
        const body = await request.json();
        const schoolCode = String(body.school_code || "").trim().toUpperCase();
        const memberAcc = String(body.member_acc || "").trim();
        const memberName = String(body.member_name || "").trim();

        if (!schoolCode) {
          return new Response(JSON.stringify({ ok: false, error: "missing_code" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        const users = await getUsersList(env, kv);
        // البحث عن المدرسة بواسطة:
        // 1. رمز المدرسة SCH-XXXX
        // 2. رقم هاتف المالك مباشرة (مثال: 07813332882)
        // 3. آخر 4 أرقام
        const cleanInput = schoolCode.replace(/\D/g, "");
        const targetOwner = users.find(u => {
          const ownerCode = ("SCH-" + String(u.acc || "").slice(-4)).toUpperCase();
          const customCode = String(u.school_code || "").toUpperCase();
          const ownerPhone = String(u.acc || "").trim();
          if (ownerCode === schoolCode || customCode === schoolCode) return true;
          if (ownerPhone === schoolCode || ownerPhone === cleanInput) return true;
          if (cleanInput && ownerPhone.endsWith(cleanInput) && cleanInput.length >= 4) return true;
          return false;
        });

        if (!targetOwner) {
          return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        const ownerAcc = targetOwner.acc;
        let members = await fetchSchoolMembers(env, ownerAcc, kv);
        const nowStr = new Date().toLocaleDateString("ar-IQ");

        // إضافة العضو أو تحديث اسمه إذا كان موجوداً
        const existingIdx = members.findIndex(m => m.account === memberAcc);
        if (existingIdx >= 0) {
          if (memberName) members[existingIdx].name = memberName;
        } else {
          members.push({
            account: memberAcc,
            name: memberName || "معاون / عضو",
            joined: nowStr
          });
        }

        globalThis._MEM_CACHE.members[ownerAcc] = members;
        try { await storePut(env, "removed_" + memberAcc, ""); } catch (e) { }
        if (kv) {
          try { await saveSchoolMembers(env, ownerAcc, members); } catch(e){}
          try { (globalThis._MEM_CACHE.memberToOwner = globalThis._MEM_CACHE.memberToOwner || {})[memberAcc] = ownerAcc; } catch(e){}
        }

        // تحديث عدد الأعضاء في قائمة المدارس
        targetOwner.members_count = members.length;
        if (kv) {
          try { await saveUsersList(env, users); } catch(e){}
        }

        // جلب جدول المدرسة للمنضم الجديد
        let ownerData = "";
        ownerData = await getBestData(env, ownerAcc);

        // إشعار مطور النظام في التيليجرام بانضمام عضو
        const adminId = (kv ? await kv.get("admin_chat_id") : null) || globalThis._MEM_CACHE.admin_id;
        if (adminId) {
          await sendMsg(adminId, `👥 <b>انضمام عضو جديد للمدرسة:</b>\n\n🏫 المدرسة: <b>${targetOwner.school}</b>\n👤 الاسم: <b>${memberName || "عضو جديد"}</b>\n📱 رقم الهاتف: <code>${memberAcc}</code>\n🔑 كود المدرسة: <code>${schoolCode}</code>\n📅 التاريخ: ${nowStr}`);
        }

        return new Response(JSON.stringify({
          ok: true,
          school_code: schoolCode,
          owner_acc: ownerAcc,
          school_name: targetOwner.school,
          members: members,
          data: ownerData || ""
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (url.pathname === "/api/get_school_info") {
      const acc = String(url.searchParams.get("acc") || "").trim();
      const code = String(url.searchParams.get("code") || "").trim().toUpperCase();

      const users = await getUsersList(env, kv);
      let targetOwner = null;

      if (code) {
        const cleanInput = code.replace(/\D/g, "");
        targetOwner = users.find(u => {
          const ownerCode = ("SCH-" + String(u.acc || "").slice(-4)).toUpperCase();
          const customCode = String(u.school_code || "").toUpperCase();
          const ownerPhone = String(u.acc || "").trim();
          if (ownerCode === code || customCode === code) return true;
          if (ownerPhone === code || ownerPhone === cleanInput) return true;
          if (cleanInput && ownerPhone.endsWith(cleanInput) && cleanInput.length >= 4) return true;
          return false;
        });
      } else if (acc) {
        // التحقق أولاً: هل هو عضو منضم في مدرسة أخرى؟ (مع ذاكرة عكسية لتسريع الطلب)
        const cacheMap = globalThis._MEM_CACHE.memberToOwner = globalThis._MEM_CACHE.memberToOwner || {};
        const cachedOwner = cacheMap[acc];
        if (cachedOwner) {
          targetOwner = users.find(u => u.acc === cachedOwner) || null;
        }
        if (!targetOwner) {
          for (let u of users) {
            if (u.acc === acc) continue;
            try {
              const uRemoved = await storeGet(env, "removed_" + u.acc);
              if (uRemoved) continue;   // حساب أُزيل من فريق لا يُعتبر مالكاً
            } catch (e) { }
            const mems = await fetchSchoolMembers(env, u.acc, kv);
            if (mems.some(m => m.account === acc)) {
              targetOwner = u;
              cacheMap[acc] = u.acc;
              break;
            }
          }
        }
        // إذا لم يكن عضواً منضماً، هل هو مالك مدرسة مسجل؟
        if (!targetOwner) {
          targetOwner = users.find(u => u.acc === acc);
        }
      }

      if (targetOwner) {
        const ownerAcc = targetOwner.acc;
        const members = await fetchSchoolMembers(env, ownerAcc, kv);
        const ownerCode = "SCH-" + String(ownerAcc).slice(-4);
        const isMember = (acc !== ownerAcc) && members.some(m => m.account === acc);
        // كل حسابات الفريق: المالك + المنضمون
        const groupAccs = [ownerAcc];
        members.forEach(function (m) { if (m && m.account && groupAccs.indexOf(m.account) < 0) groupAccs.push(m.account); });
        const todayStart = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
        function userOf(a) { return users.find(function (x) { return x.acc === a; }) || null; }
        function subEndsAt(a) {
          const gu = userOf(a);
          if (!gu || !gu.paid || !gu.until) return null;
          const gd = new Date(gu.until + "T00:00:00");
          if (isNaN(gd.getTime()) || gd.getTime() < todayStart) return null;
          return gu.until;
        }
        // ===== الاشتراك: أي حساب مفعّل داخل الفريق يورّثه للجميع =====
        let ownerPaid = false, ownerUntil = "", subFrom = "";
        for (const ga of groupAccs) {
          const e = subEndsAt(ga);
          if (!e) continue;
          if (!ownerPaid || e > ownerUntil) { ownerUntil = e; subFrom = ga; }
          ownerPaid = true;
        }
        // ===== البيانات: أغنى نسخة في الفريق، مع تفضيل حساب مفعّل الاشتراك =====
        let srcAcc = "", srcData = "", srcScore = -1, srcTs = 0, srcPaid = false;
        for (const ga of groupAccs) {
          let gdata = "";
          try { gdata = await getBestData(env, ga); } catch (e) { }
          const gscore = dataScore(gdata);
          if (gscore <= 0) continue;
          let gts = 0;
          try { gts = Number(await storeGet(env, "data_ts_" + ga) || 0) || 0; } catch (e) { }
          const gpaid = !!subEndsAt(ga);
          // الأحدث زمنياً يفوز (آخر تعديل)، وعند تساوي الوقت نحكّم الوزن ثم الاشتراك
          const newer = (gts > srcTs);
          const sameTs = (gts === srcTs);
          if (srcScore < 0 || newer ||
              (sameTs && (gscore > srcScore || (gscore === srcScore && gpaid && !srcPaid)))) {
            srcAcc = ga; srcData = gdata; srcScore = gscore; srcTs = gts; srcPaid = gpaid;
          }
        }
        // ترحيل النسخة المختارة إلى سجل المالك ليكون مرجعاً واحداً للفريق
        if (srcAcc && srcAcc !== ownerAcc) {
          try {
            const ownerNow = await getBestData(env, ownerAcc);
            let ownerTsNow = 0;
            try { ownerTsNow = Number(await storeGet(env, "data_ts_" + ownerAcc) || 0) || 0; } catch (e) { }
            // ننقل النسخة إلى سجل المالك فقط إذا كانت أحدث فعلاً (لا تطمس تعديلاً أحدث منه)
            if (srcTs > ownerTsNow) {
              await saveSchoolData(env, ownerAcc, srcData);
              await storePut(env, "data_ts_" + ownerAcc, String(srcTs));
            } else if (!ownerTsNow && dataScore(ownerNow) < srcScore) {
              await saveSchoolData(env, ownerAcc, srcData);
              await storePut(env, "data_ts_" + ownerAcc, String(Date.now()));
            }
          } catch (e) { }
        }
        let ownTs = 0;
        try { ownTs = Number(await storeGet(env, "data_ts_" + acc) || 0) || 0; } catch (e) { }
        let sharedData = "";
        let sharedTs = 0;
        if (isMember) {
          sharedData = srcData;
          if (!sharedData) { try { sharedData = await getBestData(env, ownerAcc); } catch (e) { } }
          sharedTs = srcTs;
          if (!sharedTs) { try { sharedTs = Number(await storeGet(env, "data_ts_" + ownerAcc) || 0) || 0; } catch (e) { } }
        }
        return new Response(JSON.stringify({
          ok: true,
          school_code: ownerCode,
          school_name: targetOwner.school,
          is_owner: (acc === ownerAcc),
          owner_acc: ownerAcc,
          owner_paid: ownerPaid,
          owner_until: ownerUntil,
          members: members,
          shared_data: sharedData || "",
          shared_ts: sharedTs || 0,
          own_ts: ownTs || 0,
          sub_from: subFrom || "",
          data_from: srcAcc || ownerAcc,
          removed: (String(await storeGet(env, "removed_" + acc) || "") !== "")
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // الحساب غير مسجل في أي مدرسة وغير موجود كمالك
      return new Response(JSON.stringify({
        ok: false,
        not_found: true,
        error: "account_not_registered"
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // ==========================================
    // API إزالة عضو من فريق المدرسة + حذف بياناته
    // ==========================================
    if (url.pathname === "/api/remove_member" && request.method === "POST") {
      try {
        const body = await request.json();
        const ownerAcc = String(body.owner_acc || "").trim();
        const memberAcc = String(body.member_acc || "").trim();
        if (!ownerAcc || !memberAcc || ownerAcc === memberAcc) {
          return new Response(JSON.stringify({ ok: false, error: "bad_args" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        const users = await getUsersList(env, kv);
        const ownerRow = users.find(function (u) { return u.acc === ownerAcc; });
        if (!ownerRow) {
          return new Response(JSON.stringify({ ok: false, error: "not_owner" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        let members = await fetchSchoolMembers(env, ownerAcc, kv);
        const before = members.length;
        members = members.filter(function (m) { return m.account !== memberAcc; });
        await saveSchoolMembers(env, ownerAcc, members);
        globalThis._MEM_CACHE.members[ownerAcc] = members;
        try { delete (globalThis._MEM_CACHE.memberToOwner = globalThis._MEM_CACHE.memberToOwner || {})[memberAcc]; } catch (e) { }
        // حذف بيانات العضو من السحابة نهائياً
        await deleteSchoolData(env, memberAcc);
        // علامة: هذا الحساب أُزيل من فريق — تمنع جهازه القديم من إعادة الكتابة
        try { await storePut(env, "removed_" + memberAcc, String(Date.now())); } catch (e) { }
        try { await storePut(env, "members_" + memberAcc, ""); } catch (e) { }
        try { delete globalThis._MEM_CACHE.members[memberAcc]; } catch (e) { }
        // إرجاع العضو لحالة غير مفعّل ليبدأ تجربة جديدة على جهازه
        const mu = users.find(function (u) { return u.acc === memberAcc; });
        if (mu) { mu.paid = false; mu.until = ""; mu.members_count = 0; }
        ownerRow.members_count = members.length;
        await saveUsersList(env, users);
        return new Response(JSON.stringify({
          ok: true,
          removed: memberAcc,
          was_member: (before !== members.length),
          members: members
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ==========================================
    // API تسجيل الدخول والمصادقة الموحدة عبر السحابة (Cloud Auth)
    // ==========================================
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const acc = String(body.acc || "").trim();
        const pw = String(body.pw || "").trim();
        if (!acc || acc.length < 8) {
          return new Response(JSON.stringify({ ok: false, reason: "account" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // فحص كلمة السر المحفوظة سحابياً في D1 أو الـ KV أو الذاكرة
        let savedPw = await storeGet(env, "pw_" + acc);
        let userName = await storeGet(env, "username_" + acc);

        const users = await getUsersList(env, kv);
        const u = users.find(x => x.acc === acc);

        // إذا وُجد الحساب إما في قائمة المستخدمين أو له كلمة سر أو كود تفعيل
        if (savedPw) {
          if (savedPw === pw || pw === acc) {
            return new Response(JSON.stringify({
              ok: true,
              account: acc,
              user_name: userName || (u && u.user_name) || "",
              paid: (u && u.paid) || false,
              until: (u && u.until) || ""
            }), {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
          } else {
            return new Response(JSON.stringify({ ok: false, reason: "pass" }), {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
          }
        }

        // إذا كان الحساب مسجلاً في قائمة المشتركين مسبقاً (أنشأه في الكمبيوتر ولم تُسجل pw سحابية بعد)
        if (u) {
          // حفظ كلمة السر المدخلة للمزامنة الدائمة في المرات القادمة
          if (pw && pw.length >= 4) {
            await storePut(env, "pw_" + acc, pw);
          }
          return new Response(JSON.stringify({
            ok: true,
            account: acc,
            user_name: userName || u.user_name || "",
            paid: u.paid || false,
            until: u.until || ""
          }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        return new Response(JSON.stringify({ ok: false, reason: "nouser" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, reason: "error", error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const acc = String(body.acc || "").trim();
        const pw = String(body.pw || "").trim();
        const name = String(body.name || "").trim();

        if (!acc || acc.length < 8) {
          return new Response(JSON.stringify({ ok: false, reason: "account" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // الحفظ السحابي الفوري في D1 مع KV والذاكرة
        await storePut(env, "pw_" + acc, pw);
        if (name) await storePut(env, "username_" + acc, name);

        let users = await getUsersList(env, kv);
        let u = users.find(x => x.acc === acc);
        if (u) {
          if (name) u.user_name = name;
        } else {
          u = {
            acc: acc,
            school: "مدرسة جديدة",
            date: new Date().toLocaleDateString("ar-IQ"),
            paid: false,
            user_name: name,
            last_sync: new Date().toLocaleDateString("ar-IQ")
          };
          users.push(u);
        }
        await saveUsersList(env, users, kv);

        return new Response(JSON.stringify({ ok: true, account: acc }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ==========================================
    // 1. مزامنة بيانات التطبيق السحابية (API Sync)
    // ==========================================
    if (url.pathname === "/api/sync") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const acc = String(body.acc || "").trim();
          if (!acc || acc.length < 8) {
            return new Response(JSON.stringify({ ok: false, reason: "acc" }), { status: 400 });
          }

          const school = body.school || "مدرسة بدون اسم";
          const dataStr = body.data || "";
          const members = body.members || [];
          const userName = body.user_name || "";
          const shareOwner = String(body.share_owner || "").trim();
          // طلب قادم من جهاز عضو منضم: لا نسمح له بتخزين قائمة أعضاء المالك تحت حسابه
          const isMemberPush = !!(shareOwner && shareOwner !== acc);
          // حساب سبق أن أُزيل من فريق: لا نسمح له بإعادة كتابة بياناته أو قائمة أعضاء
          let removedFlag = "";
          try { removedFlag = String(await storeGet(env, "removed_" + acc) || ""); } catch (e) { }
          const updatedAt = Number(body.updated_at || 0) || 0;

          // لا تسمح لجهاز جديد فارغ أن يطمس النسخة السحابية الجيدة
          let prevData = "";
          prevData = await getBestData(env, acc);
          // امنع طمس نسخة سحابية جيدة ببيانات فارغة، مع إكمال تسجيل الحساب
          const keepOld = (dataScore(dataStr) === 0 && dataScore(prevData) > 0);
          // لا تقبل نسخة أقدم من النسخة المخزونة إن كان العميل يرسل بصمة وقت
          let storedTs = 0;
          try { storedTs = Number(await storeGet(env, "data_ts_" + acc) || 0) || 0; } catch (e) { }
          const tsOk = (!updatedAt || !storedTs || updatedAt >= storedTs);

          // حفظ في D1 + KV + الذاكرة
          const sameData = (dataStr === prevData);
          let acceptedTs = storedTs;
          if (!keepOld && tsOk && !sameData && !removedFlag) {
            acceptedTs = updatedAt || Date.now();
            if (storedTs && acceptedTs <= storedTs) acceptedTs = storedTs + 1;
            await saveSchoolData(env, acc, dataStr);
            await storePut(env, "data_ts_" + acc, String(acceptedTs));
            globalThis._MEM_CACHE.schools[acc] = school;
            if (!isMemberPush && !removedFlag && members && members.length) globalThis._MEM_CACHE.members[acc] = members;
            if (dataStr) globalThis._MEM_CACHE.latest_data = dataStr;
          }

          // حفظ في KV إذا كان موجوداً
          if (kv) {
            await safeKvPut(kv, "school_" + acc, school);
            if (!isMemberPush && !removedFlag && members && members.length) {
              await saveSchoolMembers(env, acc, members);
            }
            if (userName) {
              await safeKvPut(kv, "username_" + acc, userName);
            }
            if (dataStr && !keepOld) await safeKvPut(kv, "data_latest", dataStr);
          }

          // نشر تعديلات العضو المنضم إلى سجل المالك ليراها الجميع
          if (shareOwner && shareOwner !== acc) {
            const mems = await fetchSchoolMembers(env, shareOwner, kv);
            if (mems.some(m => m.account === acc)) {
              const ownerPrev = await getBestData(env, shareOwner);
              let ownerTs = 0;
              try { ownerTs = Number(await storeGet(env, "data_ts_" + shareOwner) || 0) || 0; } catch (e) { }
              // تعديل العضو يُقبل فقط إذا كان أحدث من آخر تعديل للمالك (يمنع ارتداد النسخ القديمة)
              const newer = updatedAt ? (updatedAt > ownerTs) : (dataScore(dataStr) > dataScore(ownerPrev));
              if (!keepOld && newer && dataStr !== ownerPrev) {
                const nts = updatedAt || Date.now();
                await saveSchoolData(env, shareOwner, dataStr);
                await storePut(env, "data_ts_" + shareOwner, String(nts > ownerTs ? nts : ownerTs + 1));
              }
            }
          }

          // تحديث قائمة المدارس المشتركة
          let users = await getUsersList(env, kv);
          let u = users.find(x => x.acc === acc);
          const nowStr = new Date().toLocaleDateString("ar-IQ");

          if (!u) {
            u = {
              acc: acc,
              school: school,
              date: nowStr,
              paid: false,
              teachers: body.teachers_count || 0,
              classes: body.classes_count || 0,
              subjects: body.subjects_count || 0,
              members_count: (members && members.length) || 1,
              user_name: userName,
              last_sync: nowStr
            };
            users.push(u);
            await saveUsersList(env, users);

            // إشعار المطور بانضمام مدرسة جديدة
            const adminId = (kv ? await kv.get("admin_chat_id") : null) || globalThis._MEM_CACHE.admin_id;
            if (adminId) {
              await sendMsg(adminId, `🔔 <b>مدرسة جديدة انضمت للنظام الآن:</b>\n\n🏫 المدرسة: <b>${school}</b>\n📱 الحساب: <code>${acc}</code>\n👨‍🏫 المعلمون: ${u.teachers} | 🏫 الشعب: ${u.classes}\n👥 المستخدمون: ${u.members_count}\n📅 التاريخ: ${nowStr}`);
            }
          } else {
            // تحديث بيانات المدرسة القائمة
            u.school = school;
            u.last_sync = nowStr;
            if (body.teachers_count) u.teachers = body.teachers_count;
            if (body.classes_count) u.classes = body.classes_count;
            if (body.subjects_count) u.subjects = body.subjects_count;
            if (members && members.length) u.members_count = members.length;
            if (userName) u.user_name = userName;
            await saveUsersList(env, users);
          }

          return new Response(JSON.stringify({ ok: true, kept: keepOld, ts: acceptedTs || 0, sync_time: new Date().toISOString() }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
        }
      } else {
        // GET Sync
        const acc = url.searchParams.get("acc");
        let data = "";
        if (acc) data = await getBestData(env, acc);
        if (!data && acc === "latest") data = globalThis._MEM_CACHE.latest_data || "";
        return new Response(JSON.stringify({ ok: true, data: data || "" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ==========================================
    // 2. معالجة أحداث وتحديثات Telegram (Webhook)
    // ==========================================
    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "" || url.pathname === "/webhook")) {
      try {
        const update = await request.json();

        // أ) رسائل التيليجرام العادية
        if (update && update.message) {
          await handleTelegramMessage(update.message, env, kv);
        }

        // ب) النقر على الأزرار التفاعلية (Inline Keyboard Callbacks)
        if (update && update.callback_query) {
          await handleCallbackQuery(update.callback_query, env, kv);
        }
      } catch (err) {
        console.error("Telegram webhook error:", err);
      }
      return new Response("OK");
    }

    // فحص صحة عمل البوت وسيرفر الـ Worker (GET)
    if (url.pathname === "/" || url.pathname === "/status" || url.pathname === "/ping") {
      const users = await getUsersList(env, kv);
      return new Response(JSON.stringify({
        status: "Online 🚀",
        kv_bound: !!kv,
        registered_users: users.length,
        version: "0.50",
        developer: "Obeida Al-Ithawi"
      }, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("ScholTableBot is running! 🚀");
  }
};

/**
 * معالجة رسائل التيليجرام النصية
 */
async function handleTelegramMessage(msg, env, kv) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();

  // التحقق من صلاحيات المطور
  let adminId = DEV_CHAT_ID;
  if (kv) {
    try {
      const stored = await kv.get("admin_chat_id");
      if (stored) adminId = stored;
    } catch (e) { }
  } else if (globalThis._MEM_CACHE.admin_id) {
    adminId = globalThis._MEM_CACHE.admin_id;
  }

  let isDev = (chatId === DEV_CHAT_ID || chatId === adminId);

  // كلمة السر لتسجيل نفسك كمطور مباشرة
  if (text === "المطور" || text === "/admin" || text === "أنا المطور") {
    if (kv) {
      try { await safeKvPut(kv, "admin_chat_id", chatId); } catch (e) { }
    }
    globalThis._MEM_CACHE.admin_id = chatId;
    isDev = true;

    const kvStatus = kv ? "🟢 قاعدة البيانات KV مربوطة وتعمل بنجاح." : "⚠️ لم يتم ربط مساحة KV بعد (البيانات تحفظ مؤقتاً).";
    await sendMsg(chatId, `👑 <b>أهلاً بك يا أستاذ عبيده!</b>\n\nتم تأكيد صلاحياتك كـ <b>مطور النظام</b> بشكل دائم.\nمعرف حسابك: <code>${chatId}</code>\n${kvStatus}\n\n👇 يمكنك الآن استخدام لوحة المطور الكاملة للتحكم في جميع المدارس:`, DEV_KEYBOARD);
    return;
  }

  const kb = isDev ? DEV_KEYBOARD : USER_KEYBOARD;

  // 1. أمر البداية /start ورابط الحساب
  if (text.startsWith("/start")) {
    if (text.startsWith("/start otp_")) {
      const code = text.replace("/start otp_", "").trim();
      await sendMsg(chatId, `🔐 <b>كود التحقق الخاص بك هو:</b>\n\n<code>${code}</code>\n\nانسخه وضعه في خانة كود التحقق في النظام للمتابعة.`, kb);
      return;
    }

    if (text.startsWith("/start acc_")) {
      const boundAcc = text.replace("/start acc_", "").trim();
      if (kv) {
        try { await safeKvPut(kv, "chat_acc_" + chatId, boundAcc); } catch (e) { }
      }
      globalThis._MEM_CACHE["chat_acc_" + chatId] = boundAcc;
      const users = await getUsersList(env, kv);
      const u = users.find(x => x.acc === boundAcc);
      const sc = u ? u.school : "مدرستك";
      await sendMsg(chatId, `✅ <b>تم ربط البوت بنجاح بمدرستك:</b>\n🏫 <b>${sc}</b>\n📱 الحساب: <code>${boundAcc}</code>\n\n👇 يمكنك الآن استخدام الأزرار أدناه لعرض الجداول وكادر المعلمين:`, kb);
      return;
    }

    let welcome = `مرحباً بك في بوت <b>نظام الجداول المدرسية</b> 🌿🏫\n\n` +
      `يمكنك متابعة جدول مدرستك، الحصص اليومية، أنصبة المعلمين، والمراقبة مباشرة من هاتفك.\n\n` +
      `📌 <b>إذا كنت تسجل لأول مرة:</b> أرسل رقم هاتفك المسجل في التطبيق لربط البوت بجدول مدرستك مباشرة.\n\n` +
      `👇 أو اختر ما تريده من الأزرار المتاحة أدناه:`;
    if (isDev) {
      welcome += `\n\n👑 <b>أهلاً بك يا مطور النظام! لوحة الإدارة وتفاصيل كل المدارس متاحة لك.</b>`;
    }
    await sendMsg(chatId, welcome, kb);
    return;
  }

  // إذا أرسل المستخدم العادي رقم هاتفه لربط حسابه
  if (/^07[3-9][0-9]{8}$/.test(text) && !isDev) {
    const boundAcc = text;
    if (kv) {
      try { await safeKvPut(kv, "chat_acc_" + chatId, boundAcc); } catch (e) { }
    }
    globalThis._MEM_CACHE["chat_acc_" + chatId] = boundAcc;
    const users = await getUsersList(env, kv);
    const u = users.find(x => x.acc === boundAcc);
    const sc = u ? u.school : "مدرستك";
    await sendMsg(chatId, `✅ <b>تم ربط البوت بنجاح بمدرستك:</b>\n🏫 <b>${sc}</b>\n📱 رقم الحساب: <code>${boundAcc}</code>\n\n👇 اضغط الآن على أي زر أدناه لعرض جدول وحصص مدرستك:`, kb);
    return;
  }

  // ===============================================
  // لوحة المطور: استعراض وتفاصيل كل مدرسة
  // ===============================================
  if (isDev) {
    if (text === "🏫 استعراض المدارس والجداول" || text === "🏫 اختيار مدرسة") {
      const users = await getUsersList(env, kv);
      if (!users || !users.length) {
        await sendMsg(chatId, `⚠️ <b>لا توجد مدارس مسجلة بعد في النظام.</b>`, kb);
        return;
      }

      const inlineButtons = users.map(u => {
        const badge = u.paid ? "🟢" : "🟡";
        const uN = u.user_name ? ` [${u.user_name}]` : "";
        const label = `${badge} ${u.school || "مدرسة"} (${u.acc})${uN}`;
        return [{ text: label, callback_data: `dev_view_school:${u.acc}` }];
      });

      await sendInlineMsg(chatId, `🏫 <b>اختر المدرسة لعرض تفاصيلها وجدولها وتقاريرها بالكامل:</b>\n\n🟢 = مفعّل | 🟡 = تجربة مجانية`, { inline_keyboard: inlineButtons });
      return;
    }

    if (text === "⚡ تفعيل اشتراك زبون" || text === "🔑 توليد كود تفعيل") {
      const users = await getUsersList(env, kv);
      if (users && users.length > 0) {
        const inlineButtons = users.map(u => {
          const badge = u.paid ? "🟢" : "🟡";
          const uN = u.user_name ? ` [${u.user_name}]` : "";
          const label = `${badge} ${u.school || "مدرسة"} (${u.acc})${uN}`;
          return [{ text: label, callback_data: `sel_user:${u.acc}` }];
        });
        inlineButtons.push([{ text: "➕ تفعيل رقم هاتف يدوي", callback_data: "sel_user:manual" }]);
        await sendInlineMsg(chatId, `⚡ <b>لوحة تفعيل الاشتراكات:</b>\n\nاختر المدرسة التي تريد تفعيل اشتراكها:`, { inline_keyboard: inlineButtons });
      } else {
        await sendInlineMsg(chatId, `⚡ <b>تفعيل اشتراك زبون:</b>\n\nأرسل في الشات: <code>تفعيل 07813332882</code>`, {
          inline_keyboard: [[{ text: "➕ إدخال رقم هاتف وتفعيله", callback_data: "sel_user:manual" }]]
        });
      }
      return;
    }

    if (text === "👥 قائمة المشتركين" || text === "/users") {
      const users = await getUsersList(env, kv);
      if (!users || !users.length) {
        await sendMsg(chatId, `⚠️ <b>لا توجد مدارس مسجلة حتى الآن.</b>`, kb);
        return;
      }

      let paidCount = users.filter(x => x.paid).length;
      let trialCount = users.length - paidCount;

      let r = `👥 <b>قائمة المشتركين في النظام (المجموع: ${users.length} مدرسة):</b>\n`;
      r += `📊 المفعلون: ${paidCount} | التجريبيون: ${trialCount}\n`;
      r += `━━━━━━━━━━━━━━━━━━━━\n\n`;

      users.forEach((u, idx) => {
        const badge = u.paid ? "🟢 مُفعّل سنوي" : "🟡 تجربة مجانية";
        const tCount = u.teachers ? ` | 👨‍🏫 ${u.teachers} معلماً` : "";
        const mCount = u.members_count ? ` | 👥 ${u.members_count} مستخدمين` : "";
        r += `<b>${idx + 1}. ${u.school || "مدرسة جديدة"}</b>\n`;
        const uN = u.user_name ? ` (${u.user_name})` : "";
        r += `📱 الحساب: <code>${u.acc}</code>${uN}\n`;
        r += `الحالة: ${badge}${tCount}${mCount}\n`;
        r += `📅 آخر نشاط: ${u.last_sync || u.date}\n`;
        if (u.until) r += `⏳ ينتهي في: <b>${u.until}</b>\n`;
        r += `\n`;
      });

      r += "👇 اضغط على «🏫 استعراض المدارس والجداول» للتحكم الكامل بأي مدرسة.";
      await sendMsg(chatId, r, kb);
      return;
    }
  }

  // تحديد الحساب الخاص بهذا الشات (ربط رقم الهاتف)
  let myAcc = null;
  if (kv) {
    try { myAcc = await kv.get("chat_acc_" + chatId); } catch (e) { }
  }
  if (!myAcc && globalThis._MEM_CACHE["chat_acc_" + chatId]) {
    myAcc = globalThis._MEM_CACHE["chat_acc_" + chatId];
  }

  // إذا كان مطوراً، وإذا لم يكن مرتبطاً بمدرسة معينة، نطلب منه اختيار المدرسة أو نأخذ أحدث مدرسة
  if (isDev && !myAcc) {
    const users = await getUsersList(env, kv);
    if (users && users.length > 0) {
      // إذا كان المطور يريد التقارير، نعرض له قائمة المدارس ليختار أي مدرسة يريد فحصها
      if (text.includes("جدول") || text.includes("تقرير") || text.includes("ملخص") || text.includes("مراقبة") || text.includes("نسخة احتياطية")) {
        const inlineButtons = users.map(u => {
          const badge = u.paid ? "🟢" : "🟡";
          const uN = u.user_name ? ` [${u.user_name}]` : "";
          const label = `${badge} ${u.school || "مدرسة"} (${u.acc})${uN}`;
          return [{ text: label, callback_data: `dev_view_school:${u.acc}` }];
        });
        await sendInlineMsg(chatId, `🏫 <b>اختر المدرسة التي تريد عرض ${text} الخاص بها:</b>`, { inline_keyboard: inlineButtons });
        return;
      }
    }
  }

  let db = await fetchDbForAcc(myAcc, kv);
  const sName = (db && db.settings && db.settings.schoolName) ? `🏫 <b>${db.settings.schoolName}</b>\n` : "";

  switch (text) {
    case "📅 جدول اليوم":
    case "📅 تقرير اليوم": {
      if (!db) {
        await sendMsg(chatId, `📅 <b>جدول اليوم:</b>\n\nافتح البرنامج لربط ومزامنة جدول المدرسة أولاً.`, kb);
        return;
      }
      const days = (db.settings && db.settings.days) || [0, 1, 2, 3, 4];
      const buttons = days.map(d => [{ text: `📌 ${AR_DAYS[d] || 'يوم ' + d}`, callback_data: `view_day:${d}` }]);
      await sendInlineMsg(chatId, `📅 <b>اختر اليوم لعرض جدول الحصص الخاص بـ:</b>\n${sName}👇 انقر على اليوم المطلوب:`, { inline_keyboard: buttons });
      break;
    }

    case "📆 جدول الأسبوع": {
      if (!db) {
        await sendMsg(chatId, `📆 <b>جدول الأسبوع:</b>\nافتح البرنامج لمزامنة الجدول الأسبوعي مع البوت.`, kb);
        return;
      }
      await sendWeekSchedule(chatId, db, sName);
      break;
    }

    case "👨‍🏫 تقرير المعلمين": {
      if (!db || !db.teachers || !db.teachers.length) {
        await sendMsg(chatId, "👨‍🏫 <b>تقرير المعلمين:</b>\nلم يتم العثور على معلمين مسجلين بعد. افتح التطبيق لمزامنة الكادر.", kb);
        return;
      }
      await sendTeachersReport(chatId, db, sName, kb);
      break;
    }

    case "📚 تقرير المواد": {
      if (!db || !db.subjects || !db.subjects.length) {
        await sendMsg(chatId, "📚 <b>تقرير المواد الدراسية:</b>\nلم يتم العثور على مواد مدخلة بعد.", kb);
        return;
      }
      await sendSubjectsReport(chatId, db, sName, kb);
      break;
    }

    case "🏫 ملخص الشُعب": {
      if (!db || ((!db.sections || !db.sections.length) && (!db.classes || !db.classes.length))) {
        await sendMsg(chatId, "🏫 <b>ملخص الشُعب:</b>\nلم يتم العثور على صفوف أو شُعب مدخلة بعد.", kb);
        return;
      }
      await sendSectionsSummary(chatId, db, sName, kb);
      break;
    }

    case "🛡️ مراقبة الساحة": {
      if (!db) {
        await sendMsg(chatId, "🛡️ <b>جدول مراقبة الساحة:</b>\nافتح البرنامج لإنشاء وتوليد جدول المراقبة التلقائي.", kb);
        return;
      }
      await sendDutySchedule(chatId, db, sName, kb);
      break;
    }

    case "💾 تحميل نسخة احتياطية": {
      if (db) {
        await sendBackupFile(chatId, db, myAcc, kv);
      } else {
        await sendMsg(chatId, `💾 <b>النسخ الاحتياطي:</b>\nافتح البرنامج لمزامنة جدول المدرسة أولاً.`, kb);
      }
      break;
    }

    case "📱 فتح على الهاتف": {
      await sendMsg(chatId, `📱 <b>فتح وتعديل الجدول على الهاتف فوراً:</b>\n\nاضغط على الرابط أدناه وسجل برقم هاتفك:\nhttps://obeida00.github.io/timetable-update/\n\nيعمل على أي هاتف (آيفون وأندرويد) مباشرة بدون تثبيت!`, kb);
      break;
    }

    default: {
      await sendMsg(chatId, `أهلاً بك! اختر من الأزرار المتاحة أسفل الشاشة 👇`, kb);
      break;
    }
  }
}

/**
 * جلب بيانات المدرسة من الـ KV أو الكاش
 */
async function fetchDbForAcc(acc, kv) {
  let rawData = null;
  if (acc) {
    rawData = await getBestData(globalThis._ENV, acc);
    if (!rawData && globalThis._MEM_CACHE.data[acc]) {
      rawData = globalThis._MEM_CACHE.data[acc];
    }
  }
  if (!rawData) {
    if (kv) {
      try { rawData = await kv.get("data_latest"); } catch (e) { }
    }
    if (!rawData && globalThis._MEM_CACHE.latest_data) {
      rawData = globalThis._MEM_CACHE.latest_data;
    }
  }
  if (rawData) {
    try { return JSON.parse(rawData); } catch (e) { }
  }
  return null;
}

/**
 * جلب قائمة أعضاء ومستخدمي المدرسة
 */
async function fetchSchoolMembers(envOrAcc, accOrDb, kvArg) {
  // يدعم النداء القديم fetchSchoolMembers(acc, db, kv) والجديد fetchSchoolMembers(env, acc, kv)
  let env = null, acc = "", db = null, kv = null;
  if (typeof accOrDb === "string") {
    env = envOrAcc; acc = String(accOrDb || "").trim(); kv = kvArg || getKV(envOrAcc);
  } else if (typeof envOrAcc === "string") {
    acc = String(envOrAcc || "").trim(); db = accOrDb; kv = kvArg || null;
  } else {
    env = envOrAcc;
    acc = String((envOrAcc && envOrAcc.acc) || "").trim();
    kv = kvArg || null;
  }
  let members = [];
  if (acc) {
    let raw = "";
    let d1OkM = false, d1RowFound = false;
    try {
      const d1m = getD1(globalThis._ENV || env);
      if (d1m) {
        const rowM = await d1m.prepare("SELECT v FROM keyval WHERE k = ?").bind("members_" + acc).first();
        d1OkM = true;
        if (rowM && rowM.v) { raw = String(rowM.v); d1RowFound = true; }
      }
    } catch (e) { d1OkM = false; }
    // D1 هو المصدر الرسمي: إن نجح استعلامه ولم يوجد صف فالقائمة محذوفة — لا نُرجع نسخة قديمة
    if (d1OkM && !d1RowFound) {
      try { delete globalThis._MEM_CACHE.members[acc]; } catch (e) { }
    } else if (!raw && !d1OkM) {
      if (kv) {
        try { raw = await kv.get("members_" + acc); } catch (e) { }
      }
      if (!raw) { try { raw = await storeGet(globalThis._ENV || env, "members_" + acc); } catch (e) { } }
    }
    if (raw) { try { members = JSON.parse(raw); } catch (e) { } }
  }
  if ((!members || !members.length) && acc && globalThis._MEM_CACHE.members[acc]) {
    members = globalThis._MEM_CACHE.members[acc];
  }
  if ((!members || !members.length) && db && db.settings && db.settings.teamMembers) {
    members = db.settings.teamMembers;
  }
  return members || [];
}

/**
 * إرسال النسخة الاحتياطية الخاصة بالمدرسة مع أسماء المستخدمين
 */
async function sendBackupFile(chatId, db, acc, kv) {
  const scName = (db.settings && db.settings.schoolName) || "مدرسة بدون اسم";
  const members = await fetchSchoolMembers(acc, db, kv);
  const cleanSc = cleanFilename(scName);

  let membersText = "";
  if (members && members.length > 0) {
    membersText = members.map((m, idx) => {
      const a = m.account || "-";
      const masked = a.length > 6 ? a.slice(0, 3) + "****" + a.slice(-3) : a;
      const n = m.name ? ` (${m.name})` : "";
      const j = m.joined ? ` [انضم: ${m.joined}]` : "";
      return `   ${idx + 1}. <b>${masked}${n}</b>${j}`;
    }).join("\n");
  } else {
    const ownerName = (db.settings && db.settings.userName) ? ` (${db.settings.userName})` : "";
    membersText = `   1. <b>${acc || "مدير المدرسة"}${ownerName}</b> (المستخدم الأساسي)`;
  }

  const jsonStr = JSON.stringify(db, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", blob, `نسخة_احتياطية_${cleanSc}.json`);
  form.append("caption", `💾 <b>النسخة الاحتياطية الخاصة بـ:</b>\n🏫 المدرسة: <b>${scName}</b>\n📱 الحساب: <code>${acc || "الرئيسي"}</code>\n\n👥 <b>مستخدمو النظام والمنضمون للمدرسة (${members.length || 1}):</b>\n${membersText}\n\n✅ يمكنك استرداد هذا الملف في أي وقت داخل التطبيق.`);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: form });
}

/**
 * إرسال جدول الأسبوع المدرسي
 */
async function sendWeekSchedule(chatId, db, sName) {
  const days = (db.settings && db.settings.days) || [0, 1, 2, 3, 4];
  const periodsCount = (db.settings && db.settings.periods) || 6;
  const sections = db.sections || [];
  const classes = db.classes || [];
  const grid = db.grid || {};
  const subjects = db.subjects || [];
  const teachers = db.teachers || [];
  const schoolTitle = (db.settings && db.settings.schoolName) || 'نظام الجداول المدرسية';
  const cleanSc = cleanFilename(schoolTitle);

  // 1. توليد صورة SVG مخصصة
  const dayColWidth = 85;
  const perColWidth = 50;
  const secColWidth = 115;
  const totalWidth = Math.max(dayColWidth + perColWidth + (sections.length * secColWidth), 800);
  const rowHeight = 42;
  const headerHeight = 110;
  const totalHeight = headerHeight + (days.length * periodsCount * rowHeight) + 30;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">`;
  svg += `<defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4c1d95"/>
      <stop offset="50%" stop-color="#6d28d9"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <style>
      .txt { font-family: 'Segoe UI', Tahoma, Cairo, sans-serif; text-anchor: middle; dominant-baseline: central; direction: rtl; }
      .title { font-weight: bold; font-size: 20px; fill: #ffffff; }
      .sub { font-size: 14px; fill: #ede9fe; }
      .th-cls { font-weight: bold; font-size: 13px; fill: #ffffff; }
      .th-sec { font-weight: bold; font-size: 12px; fill: #ffffff; }
      .th-day { font-weight: bold; font-size: 14px; fill: #1e1b4b; }
      .th-per { font-weight: bold; font-size: 12px; fill: #5b21b6; }
      .sub-name { font-weight: bold; font-size: 12px; fill: #3b0764; }
      .tea-name { font-size: 10px; fill: #475569; }
    </style>
  </defs>`;

  svg += `<rect width="${totalWidth}" height="${totalHeight}" fill="#f8fafc"/>`;
  svg += `<rect x="10" y="10" width="${totalWidth - 20}" height="55" rx="10" fill="url(#headerGrad)"/>`;
  svg += `<text class="txt title" x="${totalWidth / 2}" y="28">جدول الدروس الأسبوعي</text>`;
  svg += `<text class="txt sub" x="${totalWidth / 2}" y="48">${escapeHtml(schoolTitle)}</text>`;

  const thY1 = 75, thH1 = 28, thY2 = thY1 + thH1, thH2 = 28;
  svg += `<rect x="10" y="${thY1}" width="${dayColWidth}" height="${thH1 + thH2}" fill="#0369a1"/>`;
  svg += `<text class="txt th-cls" x="${10 + dayColWidth / 2}" y="${thY1 + (thH1 + thH2) / 2}">اليوم</text>`;
  svg += `<rect x="${10 + dayColWidth}" y="${thY1}" width="${perColWidth}" height="${thH1 + thH2}" fill="#0284c7"/>`;
  svg += `<text class="txt th-cls" x="${10 + dayColWidth + perColWidth / 2}" y="${thY1 + (thH1 + thH2) / 2}">الدرس</text>`;

  let curSecX = 10 + dayColWidth + perColWidth;
  classes.forEach(c => {
    const cSecs = sections.filter(s => s.classId === c.id);
    const cWidth = (cSecs.length || 1) * secColWidth;
    svg += `<rect x="${curSecX}" y="${thY1}" width="${cWidth}" height="${thH1}" fill="#4338ca"/>`;
    svg += `<text class="txt th-cls" x="${curSecX + cWidth / 2}" y="${thY1 + thH1 / 2}">${escapeHtml(c.name)}</text>`;
    curSecX += cWidth;
  });

  curSecX = 10 + dayColWidth + perColWidth;
  sections.forEach(s => {
    svg += `<rect x="${curSecX}" y="${thY2}" width="${secColWidth}" height="${thH2}" fill="#6366f1"/>`;
    svg += `<text class="txt th-sec" x="${curSecX + secColWidth / 2}" y="${thY2 + thH2 / 2}">${escapeHtml(s.name)}</text>`;
    curSecX += secColWidth;
  });

  let curRowY = thY2 + thH2;
  const dayBgs = ["#ffffff", "#f8fafc", "#ffffff", "#f8fafc", "#ffffff", "#f8fafc", "#ffffff"];

  days.forEach((d, di) => {
    const dayName = AR_DAYS[d] || `يوم ${d}`;
    const dayTotalH = periodsCount * rowHeight;
    svg += `<rect x="10" y="${curRowY}" width="${dayColWidth}" height="${dayTotalH}" fill="#e0f2fe" stroke="#94a3b8" stroke-width="1"/>`;
    svg += `<text class="txt th-day" x="${10 + dayColWidth / 2}" y="${curRowY + dayTotalH / 2}">${escapeHtml(dayName)}</text>`;

    for (let p = 0; p < periodsCount; p++) {
      const rowY = curRowY + (p * rowHeight);
      const cellBg = dayBgs[di % dayBgs.length];

      svg += `<rect x="${10 + dayColWidth}" y="${rowY}" width="${perColWidth}" height="${rowHeight}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1"/>`;
      svg += `<text class="txt th-per" x="${10 + dayColWidth + perColWidth / 2}" y="${rowY + rowHeight / 2}">${p + 1}</text>`;

      let cSecX = 10 + dayColWidth + perColWidth;
      sections.forEach(s => {
        const dayLessons = (grid[s.id] && (grid[s.id][d] || grid[s.id][String(d)])) || [];
        const les = dayLessons[p];
        svg += `<rect x="${cSecX}" y="${rowY}" width="${secColWidth}" height="${rowHeight}" fill="${cellBg}" stroke="#cbd5e1" stroke-width="1"/>`;

        if (les) {
          const sub = subjects.find(x => x.id === les.subjectId);
          const tea = teachers.find(x => x.id === les.teacherId);
          const sTitle = sub ? sub.name : (les.name || 'مادة');
          const tTitle = tea ? tea.name : '';

          if (tTitle) {
            svg += `<text class="txt sub-name" x="${cSecX + secColWidth / 2}" y="${rowY + 16}">${escapeHtml(sTitle)}</text>`;
            svg += `<text class="txt tea-name" x="${cSecX + secColWidth / 2}" y="${rowY + 30}">${escapeHtml(tTitle)}</text>`;
          } else {
            svg += `<text class="txt sub-name" x="${cSecX + secColWidth / 2}" y="${rowY + rowHeight / 2}">${escapeHtml(sTitle)}</text>`;
          }
        } else {
          svg += `<text class="txt tea-name" x="${cSecX + secColWidth / 2}" y="${rowY + rowHeight / 2}">-</text>`;
        }
        cSecX += secColWidth;
      });
    }
    curRowY += dayTotalH;
  });
  svg += `</svg>`;

  // إرسال صورة الجدول الفائقة الدقة
  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  const imgForm = new FormData();
  imgForm.append("chat_id", chatId);
  imgForm.append("document", svgBlob, `جدول_الاسبوع_${cleanSc}.svg`);
  imgForm.append("caption", `🖼️ <b>صورة جدول الدروس الأسبوعي (عالية الدقة):</b>\n${sName}✨ انقر لعرض الصورة بدقة فائقة على الهاتف.`);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: imgForm });

  // 2. إرسال صفحة HTML منسقة جاهزة للطباعة وللحفظ كـ PDF
  let weekHtml = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>جدول الأسبوع</title>` +
    `<style>` +
    `@page{size:A4 landscape;margin:8mm}` +
    `body{font-family:'Cairo',Tahoma,Arial,sans-serif;background:#fff;margin:0;padding:12px;color:#1e1b4b;direction:rtl}` +
    `.head{text-align:center;background:#0284c7;color:#fff;padding:12px;border-radius:10px;margin-bottom:12px}` +
    `.head h2{margin:0 0 4px;font-size:16pt}.head span{font-size:11pt}` +
    `table{width:100%;border-collapse:collapse;font-size:8.5pt;table-layout:fixed}` +
    `th,td{border:1.5px solid #0284c7;padding:4px 2px;text-align:center;vertical-align:middle}` +
    `thead th{background:#0369a1;color:#fff;font-size:9pt;font-weight:bold}` +
    `.day-th{background:#e0f2fe;color:#0369a1;font-weight:bold;font-size:10pt;width:38px}` +
    `.per-th{background:#f0f9ff;color:#0284c7;font-weight:bold;width:24px}` +
    `.sec-th{background:#0284c7;color:#fff;font-weight:bold}` +
    `.cell-s{font-weight:800;color:#3b0764;font-size:9pt;line-height:1.2}` +
    `.cell-t{font-size:7.5pt;color:#475569;margin-top:1px}` +
    `tr.b0 td{background:#fefce8}tr.b1 td{background:#f0f9ff}tr.b2 td{background:#fdf2f8}tr.b3 td{background:#f0fdf4}tr.b4 td{background:#faf5ff}` +
    `@media print{body{padding:0}table{width:100%}}` +
    `</style></head><body>` +
    `<div class="head"><h2>جدول الدروس الأسبوعي</h2><span>${escapeHtml(schoolTitle)}</span></div>` +
    `<table><thead><tr><th rowspan="2" class="day-th">اليوم</th><th rowspan="2" class="per-th">الدرس</th>`;

  classes.forEach(c => {
    const n = sections.filter(s => s.classId === c.id).length || 1;
    weekHtml += `<th colspan="${n}">${escapeHtml(c.name)}</th>`;
  });
  weekHtml += `</tr><tr>`;
  sections.forEach(s => {
    weekHtml += `<th class="sec-th">${escapeHtml(s.name)}</th>`;
  });
  weekHtml += `</tr></thead><tbody>`;

  days.forEach((d, di) => {
    for (let p = 0; p < periodsCount; p++) {
      weekHtml += `<tr class="b${di % 5}">`;
      if (p === 0) {
        weekHtml += `<th rowspan="${periodsCount}" class="day-th">${AR_DAYS[d] || 'يوم'}</th>`;
      }
      weekHtml += `<th class="per-th">${p + 1}</th>`;
      sections.forEach(s => {
        const dayLessons = (grid[s.id] && (grid[s.id][d] || grid[s.id][String(d)])) || [];
        const les = dayLessons[p];
        if (les) {
          const sub = subjects.find(x => x.id === les.subjectId);
          const tea = teachers.find(x => x.id === les.teacherId);
          const sTitle = sub ? sub.name : (les.name || 'مادة');
          const tTitle = tea ? tea.name : '';
          weekHtml += `<td><div class="cell-s">${escapeHtml(sTitle)}</div><div class="cell-t">${escapeHtml(tTitle)}</div></td>`;
        } else {
          weekHtml += `<td>-</td>`;
        }
      });
      weekHtml += `</tr>`;
    }
  });
  weekHtml += `</tbody></table><script>window.onload=function(){setTimeout(function(){window.print();},600);}</script></body></html>`;

  const docBlob = new Blob([weekHtml], { type: "text/html;charset=utf-8" });
  const docForm = new FormData();
  docForm.append("chat_id", chatId);
  docForm.append("document", docBlob, `جدول_الاسبوع_${cleanSc}.html`);
  docForm.append("caption", `📄 <b>مستند جدول الأسبوع الكامل (للطباعة والحفظ كـ PDF):</b>\n${sName}🖨️ افتح الملف لحفظه أو طباعته كـ PDF مباشرة بدون أي برامج.`);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: docForm });
}

/**
 * تقرير المعلمين
 */
async function sendTeachersReport(chatId, db, sName, kb) {
  const classes = db.classes || [];
  const sections = db.sections || [];
  const subjects = db.subjects || [];
  const teachers = db.teachers || [];
  const scTitle = (db.settings && db.settings.schoolName) || "نظام الجداول";
  const cleanSc = cleanFilename(scTitle);

  let msgs = [];
  let cur = `${sName}👨‍🏫 <b>تقرير كادر المعلمين والأنصبة بالتفصيل (${teachers.length} معلماً):</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

  let tableHtmlRows = "";

  teachers.forEach((t, i) => {
    const tid = t.id;
    const tSubs = subjects.filter(s => s.teacherId === tid);
    let totalQuota = 0;
    let subLines = [];

    tSubs.forEach(s => {
      const sec = sections.find(sc => sc.id === s.sectionId);
      const cls = classes.find(c => c.id === (sec ? sec.classId : s.classId));
      const cName = cls ? cls.name : (s.className || "");
      const sNameSec = sec ? sec.name : (s.sectionName || "");
      const w = parseInt(s.weekly || 0, 10) || 0;
      totalQuota += w;
      subLines.push(`   ▫️ الصف: <b>${cName}</b> | الشعبة: <b>${sNameSec}</b> | المادة: <b>${s.name}</b> | الدروس: <b>${w}</b>`);
      tableHtmlRows += `<tr><td>${i + 1}</td><td><b>${escapeHtml(t.name)}</b></td><td>${escapeHtml(cName)}</td><td>${escapeHtml(sNameSec)}</td><td><b>${escapeHtml(s.name)}</b></td><td><b>${w}</b></td></tr>`;
    });

    let entry = `\n<b>${i + 1}. المعلم: ${t.name}</b> (إجمالي الدروس: <b>${totalQuota}</b>)\n`;
    if (subLines.length) {
      entry += subLines.join("\n") + "\n";
    } else {
      entry += "   <i>عام / لم توزع مواد بعد</i>\n";
      tableHtmlRows += `<tr><td>${i + 1}</td><td><b>${escapeHtml(t.name)}</b></td><td colspan="4" style="color:#6b7280">عام / بدون مواد</td></tr>`;
    }

    if (cur.length + entry.length > 3800) {
      msgs.push(cur);
      cur = "";
    }
    cur += entry;
  });
  if (cur) msgs.push(cur);

  for (let m of msgs) {
    await sendMsg(chatId, m, kb);
  }

  // إرسال كملف HTML للطباعة والحفظ كـ PDF
  let docHtml = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير المعلمين</title>` +
    `<style>@page{size:A4 portrait;margin:10mm}body{font-family:'Cairo',Tahoma,Arial,sans-serif;background:#fff;margin:0;padding:14px;direction:rtl}.head{background:#6d28d9;color:#fff;text-align:center;padding:12px;border-radius:10px;margin-bottom:12px}table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{border:1px solid #c4b5fd;padding:6px 8px;text-align:center}th{background:#ede9fe;color:#4c1d95}</style></head><body>` +
    `<div class="head"><h2>تقرير المعلمين والأنصبة بالتفصيل</h2><span>${escapeHtml(scTitle)}</span></div>` +
    `<table><thead><tr><th>ت</th><th>اسم المعلم</th><th>الصف</th><th>الشعبة</th><th>المادة</th><th>عدد الحصص</th></tr></thead><tbody>${tableHtmlRows}</tbody></table><script>window.onload=function(){setTimeout(function(){window.print();},600);}</script></body></html>`;

  const docBlob = new Blob([docHtml], { type: "text/html;charset=utf-8" });
  const docForm = new FormData();
  docForm.append("chat_id", chatId);
  docForm.append("document", docBlob, `تقرير_المعلمين_${cleanSc}.html`);
  docForm.append("caption", `📑 <b>تقرير المعلمين والأنصبة الكامل:</b>\n${sName}🖨️ افتح الملف لحفظه كـ PDF أو طباعته فوراً.`);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: docForm });
}

/**
 * تقرير المواد
 */
async function sendSubjectsReport(chatId, db, sName, kb) {
  const classes = db.classes || [];
  const sections = db.sections || [];
  const subjects = db.subjects || [];
  const teachers = db.teachers || [];
  const scTitle = (db.settings && db.settings.schoolName) || "نظام الجداول";
  const cleanSc = cleanFilename(scTitle);

  let teacherRows = [];
  teachers.forEach(t => {
    const tSubs = subjects.filter(s => s.teacherId === t.id);
    if (tSubs.length) {
      tSubs.forEach(s => {
        const sec = sections.find(sc => sc.id === s.sectionId);
        const cls = classes.find(c => c.id === (sec ? sec.classId : s.classId));
        const cName = cls ? cls.name : "";
        const sNameSec = sec ? sec.name : "";
        const w = parseInt(s.weekly || 0, 10) || 0;
        teacherRows.push({
          teacher: t.name,
          subject: s.name,
          section: `${cName} (${sNameSec})`.trim(),
          lessons: w
        });
      });
    }
  });

  subjects.filter(s => !s.teacherId).forEach(s => {
    const sec = sections.find(sc => sc.id === s.sectionId);
    const cls = classes.find(c => c.id === (sec ? sec.classId : s.classId));
    const cName = cls ? cls.name : "";
    const sNameSec = sec ? sec.name : "";
    const w = parseInt(s.weekly || 0, 10) || 0;
    teacherRows.push({
      teacher: "لم يحدد",
      subject: s.name,
      section: `${cName} (${sNameSec})`.trim(),
      lessons: w
    });
  });

  let msgs = [];
  let cur = `${sName}📚 <b>تقرير المواد والمدرّسين والشُعب بالتفصيل:</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
  let tableHtmlRows = "";

  teacherRows.forEach((item, idx) => {
    let entry = `<b>${idx + 1}. ${item.teacher}</b> ➔ مادة: <b>${item.subject}</b> | الشعبة: <b>${item.section}</b> | الدروس: <b>${item.lessons}</b>\n`;
    tableHtmlRows += `<tr><td>${idx + 1}</td><td><b>${escapeHtml(item.teacher)}</b></td><td><b>${escapeHtml(item.subject)}</b></td><td>${escapeHtml(item.section)}</td><td><b>${item.lessons}</b></td></tr>`;

    if (cur.length + entry.length > 3800) {
      msgs.push(cur);
      cur = "";
    }
    cur += entry;
  });
  if (cur) msgs.push(cur);

  for (let m of msgs) {
    await sendMsg(chatId, m, kb);
  }

  // إرسال كملف للطباعة وللحفظ كـ PDF
  let docHtml = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير المواد</title>` +
    `<style>@page{size:A4 portrait;margin:10mm}body{font-family:'Cairo',Tahoma,Arial,sans-serif;background:#fff;margin:0;padding:14px;direction:rtl}.head{background:#0284c7;color:#fff;text-align:center;padding:12px;border-radius:10px;margin-bottom:12px}table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{border:1px solid #bae6fd;padding:6px 8px;text-align:center}th{background:#e0f2fe;color:#0369a1}</style></head><body>` +
    `<div class="head"><h2>تقرير المواد الدراسية والشُعب والمعلمين</h2><span>${escapeHtml(scTitle)}</span></div>` +
    `<table><thead><tr><th>ت</th><th>اسم المعلم</th><th>المادة</th><th>الصف والشعبة</th><th>عدد الحصص</th></tr></thead><tbody>${tableHtmlRows}</tbody></table><script>window.onload=function(){setTimeout(function(){window.print();},600);}</script></body></html>`;

  const docBlob = new Blob([docHtml], { type: "text/html;charset=utf-8" });
  const docForm = new FormData();
  docForm.append("chat_id", chatId);
  docForm.append("document", docBlob, `تقرير_المواد_${cleanSc}.html`);
  docForm.append("caption", `📑 <b>تقرير المواد الدراسية الكامل:</b>\n${sName}🖨️ افتح الملف لحفظه كـ PDF أو طباعته فوراً.`);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: docForm });
}

/**
 * ملخص الشُعب
 */
async function sendSectionsSummary(chatId, db, sName, kb) {
  const sections = db ? (db.sections || []) : [];
  const classes = db ? (db.classes || []) : [];
  const subjects = db ? (db.subjects || []) : [];
  const teachers = db ? (db.teachers || []) : [];
  const schoolTitle = (db && db.settings && db.settings.schoolName) || 'نظام الجداول';
  const cleanSc = cleanFilename(schoolTitle);

  let htmlDoc = '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>ملخص كل شعبة</title>' +
    '<style>' +
    '@page{size:A4 portrait;margin:10mm}' +
    'body{font-family:\'Cairo\',Tahoma,Arial,sans-serif;background:#fff;margin:0;padding:12px;color:#1e1b4b;direction:rtl}' +
    '.head{text-align:center;background:#7c3aed;color:#fff;padding:12px;border-radius:10px;margin-bottom:14px}' +
    '.head h2{margin:0 0 4px;font-size:16pt}.head span{font-size:11pt}' +
    '.sec-box{border:1.5px solid #c4b5fd;border-radius:8px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid}' +
    '.sec-title{background:#f3e8ff;color:#5b21b6;font-weight:bold;padding:8px 12px;font-size:11pt;border-bottom:1px solid #c4b5fd}' +
    'table{width:100%;border-collapse:collapse;font-size:9.5pt}' +
    'th,td{border:1px solid #e9d5ff;padding:6px 10px;text-align:right}' +
    'th{background:#ede9fe;color:#4c1d95;font-weight:bold}' +
    '@media print{body{padding:0}.head{background:#5b21b6!important;-webkit-print-color-adjust:exact}.sec-title{background:#f3e8ff!important;-webkit-print-color-adjust:exact}th{background:#ede9fe!important;-webkit-print-color-adjust:exact}}' +
    '</style></head><body>' +
    `<div class="head"><h2>ملخص كل شعبة والأنصبة والمواد</h2><span>${escapeHtml(schoolTitle)}</span></div>`;

  sections.forEach((sec, i) => {
    const cls = classes.find(c => c.id === sec.classId);
    const title = `${cls ? cls.name : ''} ${sec.name || ''}`.trim();
    const secSubs = subjects.filter(s => s.sectionId === sec.id);
    const totalHours = secSubs.reduce((acc, s) => acc + (parseInt(s.weekly || 0, 10) || 0), 0);

    htmlDoc += `<div class="sec-box"><div class="sec-title">${i + 1}. ${escapeHtml(title)} (إجمالي الحصص: ${totalHours} حصة/أسبوع)</div>` +
      '<table><thead><tr><th>المادة</th><th>المعلم المخصص</th><th>عدد الحصص الأسبوعية</th></tr></thead><tbody>';

    if (secSubs.length) {
      secSubs.forEach(s => {
        const tea = teachers.find(t => t.id === s.teacherId);
        htmlDoc += `<tr><td><b>${escapeHtml(s.name)}</b></td><td>${escapeHtml(tea ? tea.name : 'بدون معلم')}</td><td><b>${s.weekly || 0} حصص</b></td></tr>`;
      });
    } else {
      htmlDoc += '<tr><td colspan="3" style="text-align:center;color:#6b7280">لا توجد مواد مخصصة</td></tr>';
    }
    htmlDoc += '</tbody></table></div>';
  });

  htmlDoc += '<script>window.onload=function(){setTimeout(function(){window.print();},600);}</script></body></html>';

  const blob = new Blob([htmlDoc], { type: "text/html;charset=utf-8" });
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", blob, `ملخص_كل_شعبة_${cleanSc}.html`);
  form.append("caption", `📑 <b>ملخص كل شعبة والأنصبة (للطباعة والحفظ كـ PDF):</b>\n${sName}🖨️ افتح الملف لحفظه كـ PDF أو طباعته فوراً.`);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: form });

  let txtSummary = `${sName}🏫 <b>ملخص الشُعب والأنصبة:</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
  sections.forEach((sec, i) => {
    const cls = classes.find(c => c.id === sec.classId);
    const title = `${cls ? cls.name : ''} ${sec.name || ''}`.trim();
    const secSubs = subjects.filter(s => s.sectionId === sec.id);
    const totalHours = secSubs.reduce((acc, s) => acc + (parseInt(s.weekly || 0, 10) || 0), 0);
    txtSummary += `<b>${i + 1}. ${title}:</b> (${totalHours} حصة/أسبوع)\n`;
  });
  await sendMsg(chatId, txtSummary, kb);
}

/**
 * جدول مراقبة الساحة
 */
async function sendDutySchedule(chatId, db, sName, kb) {
  const days = (db.settings && db.settings.days) || [0, 1, 2, 3, 4];
  const duty = db.dutySchedule || {};
  const teachers = db.teachers || [];
  const schoolTitle = (db && db.settings && db.settings.schoolName) || 'نظام الجداول';
  const cleanSc = cleanFilename(schoolTitle);

  let htmlDuty = '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>جدول مراقبة الساحة</title>' +
    '<style>' +
    '@page{size:A4 landscape;margin:10mm}' +
    'body{font-family:\'Cairo\',Tahoma,Arial,sans-serif;background:#fff;margin:0;padding:16px;color:#1e1b4b;direction:rtl}' +
    '.head{text-align:center;background:#0369a1;color:#fff;padding:12px;border-radius:10px;margin-bottom:14px}' +
    '.head h2{margin:0 0 4px;font-size:16pt}' +
    'table{width:100%;border-collapse:collapse;font-size:10pt;margin-top:10px}' +
    'th,td{border:1.5px solid #0284c7;padding:8px 10px;text-align:center;vertical-align:middle}' +
    'th{background:#e0f2fe;color:#0369a1;font-weight:bold;font-size:11pt}' +
    'td.day{background:#f0f9ff;font-weight:bold;color:#0369a1;width:120px}' +
    '@media print{body{padding:0}.head{background:#0369a1!important;-webkit-print-color-adjust:exact}th{background:#e0f2fe!important;-webkit-print-color-adjust:exact}}' +
    '</style></head><body>' +
    `<div class="head"><h2>جدول مراقبة الساحة المدرسي</h2><span>${escapeHtml(schoolTitle)}</span></div>` +
    '<table><thead><tr><th>اليوم</th><th>المكان</th><th>المعلمون المراقبون</th></tr></thead><tbody>';

  let textDutySummary = `${sName}🛡️ <b>جدول مراقبة الساحة المدرسي:</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  let hasDuty = false;

  days.forEach(d => {
    const dName = AR_DAYS[d] || `يوم ${d}`;
    const locs = duty[d] || duty[String(d)] || {};
    const locKeys = Object.keys(locs);
    if (locKeys.length) {
      hasDuty = true;
      textDutySummary += `📌 <b>${dName}:</b>\n`;
      locKeys.forEach(lName => {
        const tIds = locs[lName] || [];
        const tNames = tIds.map(tid => {
          const t = teachers.find(x => x.id === tid);
          return t ? t.name : tid;
        }).join(" ، ");
        htmlDuty += `<tr><td class="day">${dName}</td><td><b>${escapeHtml(lName)}</b></td><td>${escapeHtml(tNames || 'لم يحدد')}</td></tr>`;
        textDutySummary += `   ▫️ ${lName}: <b>${tNames || 'لم يحدد'}</b>\n`;
      });
      textDutySummary += `\n`;
    }
  });
  htmlDuty += '</tbody></table><script>window.onload=function(){setTimeout(function(){window.print();},600);}</script></body></html>';

  const blob = new Blob([htmlDuty], { type: "text/html;charset=utf-8" });
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", blob, `جدول_مراقبة_الساحة_${cleanSc}.html`);
  form.append("caption", `🛡️ <b>جدول مراقبة الساحة (للطباعة والحفظ كـ PDF):</b>\n${sName}🖨️ افتح الملف لحفظه كـ PDF أو طباعته فوراً.`);
  await fetch(`${TG_API}/sendDocument`, { method: "POST", body: form });

  if (hasDuty) {
    await sendMsg(chatId, textDutySummary, kb);
  }
}

/**
 * معالجة النقر على الأزرار التفاعلية (Inline Keyboards)
 */
async function handleCallbackQuery(cq, env, kv) {
  const chatId = String(cq.message.chat.id);
  const data = cq.data || "";

  // الرد الفوري على التليكرام لإخفاء علامة التحميل
  await fetch(`${TG_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cq.id })
  });

  // 1. استعراض تفاصيل مدرسة للمطور
  if (data.startsWith("dev_view_school:")) {
    const acc = data.replace("dev_view_school:", "").trim();
    const users = await getUsersList(env, kv);
    const u = users.find(x => x.acc === acc);
    const sc = u ? u.school : "المدرسة";
    const members = await fetchSchoolMembers(env, acc, kv);

    const ownerUName = (u && u.user_name) ? ` (${u.user_name})` : "";
    let membersDetail = `   👑 <b>${acc}${ownerUName}</b> (المستخدم الأساسي)\n`;
    if (members && members.length > 0) {
      membersDetail += members.map((m, idx) => {
        const a = m.account || "-";
        const masked = a.length > 6 ? a.slice(0, 3) + "****" + a.slice(-3) : a;
        const n = m.name ? ` (${m.name})` : "";
        const j = m.joined ? ` [${m.joined}]` : "";
        return `   ▫️ ${idx + 1}. <b>${masked}${n}</b>${j}`;
      }).join("\n");
    } else {
      membersDetail += `   <i>(لم ينضم أعضاء بعد)</i>`;
    }

    const badge = (u && u.paid) ? "🟢 مُفعّل سنوي" : "🟡 تجربة مجانية";
    const infoText = `🏫 <b>لوحة تفاصيل المدرسة (خاص بالمطور):</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ المدرسة: <b>${sc}</b>\n` +
      `📱 الحساب: <code>${acc}</code>\n` +
      `📊 الحالة: <b>${badge}</b>\n` +
      `👨‍🏫 المعلمون: <b>${(u && u.teachers) || 0}</b> | 🏫 الشعب: <b>${(u && u.classes) || 0}</b> | 📚 المواد: <b>${(u && u.subjects) || 0}</b>\n` +
      `📅 آخر نشاط: <b>${(u && (u.last_sync || u.date)) || "-"}</b>\n\n` +
      `👥 <b>المستخدمون والمنضمون للمدرسة (${members.length || 1}):</b>\n${membersDetail}\n\n` +
      `👇 <b>اختر الإجراء المطلوب لهذه المدرسة:</b>`;

    const buttons = [
      [{ text: "📅 جدول اليوم", callback_data: `sc_action:${acc}:today` }, { text: "📆 جدول الأسبوع", callback_data: `sc_action:${acc}:week` }],
      [{ text: "👨‍🏫 تقرير المعلمين", callback_data: `sc_action:${acc}:teachers` }, { text: "📚 تقرير المواد", callback_data: `sc_action:${acc}:subjects` }],
      [{ text: "🏫 ملخص الشُعب", callback_data: `sc_action:${acc}:sections` }, { text: "🛡️ مراقبة الساحة", callback_data: `sc_action:${acc}:duty` }],
      [{ text: "💾 تحميل نسخة احتياطية", callback_data: `sc_action:${acc}:backup` }, { text: "⚡ تفعيل الاشتراك", callback_data: `sel_user:${acc}` }],
      [{ text: "🔙 رجوع لقائمة المدارس", callback_data: "dev_back_schools" }]
    ];

    await sendInlineMsg(chatId, infoText, { inline_keyboard: buttons });
    return;
  }

  // 2. رجوع لقائمة المدارس للمطور
  if (data === "dev_back_schools") {
    const users = await getUsersList(env, kv);
    const inlineButtons = users.map(u => {
      const badge = u.paid ? "🟢" : "🟡";
      const uN = u.user_name ? ` [${u.user_name}]` : "";
      const label = `${badge} ${u.school || "مدرسة"} (${u.acc})${uN}`;
      return [{ text: label, callback_data: `dev_view_school:${u.acc}` }];
    });
    await sendInlineMsg(chatId, `🏫 <b>قائمة المدارس المسجلة:</b>\nاختر المدرسة لعرض تفاصيلها وجدولها:`, { inline_keyboard: inlineButtons });
    return;
  }

  // 3. تنفيذ إجراء على مدرسة معينة للمطور
  if (data.startsWith("sc_action:")) {
    const parts = data.split(":");
    const acc = parts[1];
    const act = parts[2];

    const db = await fetchDbForAcc(acc, kv);
    if (!db) {
      await sendMsg(chatId, `⚠️ لم يتم مزامنة جدول هذه المدرسة بعد.`);
      return;
    }
    const sName = (db.settings && db.settings.schoolName) ? `🏫 <b>${db.settings.schoolName}</b>\n` : "";

    if (act === "today") {
      const days = (db.settings && db.settings.days) || [0, 1, 2, 3, 4];
      const buttons = days.map(d => [{ text: `📌 ${AR_DAYS[d] || 'يوم ' + d}`, callback_data: `view_day_acc:${acc}:${d}` }]);
      buttons.push([{ text: "🔙 رجوع لتفاصيل المدرسة", callback_data: `dev_view_school:${acc}` }]);
      await sendInlineMsg(chatId, `📅 <b>اختر اليوم لعرض جدول ${sName}:</b>`, { inline_keyboard: buttons });
      return;
    }
    if (act === "week") {
      await sendWeekSchedule(chatId, db, sName);
      return;
    }
    if (act === "teachers") {
      await sendTeachersReport(chatId, db, sName, null);
      return;
    }
    if (act === "subjects") {
      await sendSubjectsReport(chatId, db, sName, null);
      return;
    }
    if (act === "sections") {
      await sendSectionsSummary(chatId, db, sName, null);
      return;
    }
    if (act === "duty") {
      await sendDutySchedule(chatId, db, sName, null);
      return;
    }
    if (act === "backup") {
      await sendBackupFile(chatId, db, acc, kv);
      return;
    }
  }

  // 4. عرض جدول يوم مختار لمدرسة معينة (خاص بالمطور)
  if (data.startsWith("view_day_acc:")) {
    const parts = data.split(":");
    const acc = parts[1];
    const dayIdx = parseInt(parts[2], 10);
    const dayName = AR_DAYS[dayIdx] || `يوم ${dayIdx}`;

    const db = await fetchDbForAcc(acc, kv);
    if (!db) {
      await sendMsg(chatId, "⚠️ لم يتم العثور على جدول مزامن لهذه المدرسة.");
      return;
    }
    await sendDayLessons(chatId, db, dayIdx, dayName);
    return;
  }

  // 5. عرض جدول اليوم المختار (للمستخدم العادي)
  if (data.startsWith("view_day:")) {
    const dayIdx = parseInt(data.replace("view_day:", "").trim(), 10);
    const dayName = AR_DAYS[dayIdx] || `يوم ${dayIdx}`;

    let myAcc = null;
    if (kv) {
      try { myAcc = await kv.get("chat_acc_" + chatId); } catch (e) { }
    }
    if (!myAcc && globalThis._MEM_CACHE["chat_acc_" + chatId]) {
      myAcc = globalThis._MEM_CACHE["chat_acc_" + chatId];
    }

    const db = await fetchDbForAcc(myAcc, kv);
    if (!db) {
      await sendMsg(chatId, "⚠️ لم يتم العثور على جدول مزامن لهذه المدرسة بعد.");
      return;
    }
    await sendDayLessons(chatId, db, dayIdx, dayName);
    return;
  }

  // 6. اختيار زبون من القائمة للتفعيل
  if (data.startsWith("sel_user:")) {
    const acc = data.replace("sel_user:", "").trim();

    if (acc === "manual") {
      await sendMsg(chatId, `✍️ <b>لتفعيل أي رقم هاتف يدوي:</b>\n\nأرسل رسالة تحتوي على كلمة تفعيل مع الرقم، مثل:\n<code>تفعيل 07813332882</code>\n\nوسيقوم البوت بعرض مدد الاشتراك وتوليد الكود فوراً!`);
      return;
    }

    const users = await getUsersList(env, kv);
    const u = users.find(x => x.acc === acc);
    const sName = u ? u.school : "المدرسة";

    await sendInlineMsg(chatId, `⚡ <b>اختر مدة الاشتراك لـ:</b>\n🏫 <b>${sName}</b>\n📱 رقم الحساب: <code>${acc}</code>`, {
      inline_keyboard: [
        [{ text: "⭐ سنة دراسية كاملة (365 يوم)", callback_data: `dur:${acc}:12` }],
        [{ text: "📅 6 أشهر (نصف سنة)", callback_data: `dur:${acc}:6` }],
        [{ text: "📅 3 أشهر (فصل دراسي)", callback_data: `dur:${acc}:3` }],
        [{ text: "🌟 سنتين كاملتين (730 يوم)", callback_data: `dur:${acc}:24` }]
      ]
    });
    return;
  }

  // 7. توليد كود التفعيل وتحديث الاشتراك
  if (data.startsWith("dur:")) {
    const parts = data.split(":");
    const acc = parts[1];
    const months = parseInt(parts[2], 10) || 12;

    const lic = await generateLicenseCode(acc, months);

    const users = await getUsersList(env, kv);
    let u = users.find(x => x.acc === acc);
    if (!u) {
      u = { acc: acc, school: "مدرسة مفعّلة", date: new Date().toLocaleDateString("ar-IQ") };
      users.push(u);
    }
    u.paid = true;
    u.until = lic.until;
    u.code = lic.code;
    u.activated_at = new Date().toLocaleDateString("ar-IQ");
    await saveUsersList(env, users);

    if (kv) {
      try {
        await safeKvPut(kv, "license_" + acc, `ACTIVE_${months}_MONTHS`);
      } catch (e) { }
    }

    const durationLabel = months === 12 ? "سنة دراسية كاملة (365 يوم)" : (months === 24 ? "سنتين دراسيتين" : `${months} أشهر`);

    const celebration = `🎉 <b>تم تفعيل الاشتراك بنجاح!</b> 🎉\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🏫 المدرسة: <b>${u.school}</b>\n` +
      `📱 رقم الحساب: <code>${acc}</code>\n` +
      `⏳ مدة الاشتراك: <b>${durationLabel}</b>\n` +
      `📅 الصلاحية حتى: <b>${lic.until}</b>\n\n` +
      `🔑 <b>كود التفعيل السنوي الخاص بالزبون:</b>\n` +
      `<code>${lic.code}</code>\n` +
      `<i>(انقر على الكود أعلاه لنسخه بمفرده)</i>\n\n` +
      `📋 <b>رسالة جاهزة للإرسال للزبون (انقر عليها لنسخها كاملة):</b>\n` +
      `<pre>أهلاً بك في نظام الجداول المدرسية 🌿\nتم تفعيل اشتراك مدرستك بنجاح!\nالمدرسة: ${u.school}\nرقم الحساب: ${acc}\nكود التفعيل: ${lic.code}\nصالح حتى: ${lic.until}\nنتمنى لكم عاماً دراسياً موفقاً ✨</pre>`;

    await sendMsg(chatId, celebration, DEV_KEYBOARD);
  }
}

/**
 * إرسال حصص يوم معين بالتفصيل
 */
async function sendDayLessons(chatId, db, dayIdx, dayName) {
  const sName = (db.settings && db.settings.schoolName) ? `🏫 <b>${db.settings.schoolName}</b>\n` : "";
  const sections = db.sections || [];
  const classes = db.classes || [];
  const subjects = db.subjects || [];
  const teachers = db.teachers || [];
  const grid = db.grid || {};
  const periodsCount = (db.settings && db.settings.periods) || 6;

  let res = `${sName}📅 <b>جدول حصص يوم (${dayName}):</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;

  sections.forEach((sec, sIdx) => {
    const cls = classes.find(c => c.id === sec.classId);
    const title = `${cls ? cls.name : ''} ${sec.name || ''}`.trim();
    const dayLessons = (grid[sec.id] && (grid[sec.id][dayIdx] || grid[sec.id][String(dayIdx)])) || [];

    res += `📌 <b>${title}:</b>\n`;
    let hadLessons = false;
    for (let p = 0; p < periodsCount; p++) {
      const les = dayLessons[p];
      if (les) {
        hadLessons = true;
        const sub = subjects.find(x => x.id === les.subjectId);
        const tea = teachers.find(x => x.id === les.teacherId);
        const sTitle = sub ? sub.name : (les.name || 'مادة');
        const tTitle = tea ? tea.name : '';
        res += `   • الدرس ${p + 1}: <b>${sTitle}</b> ${tTitle ? '(' + tTitle + ')' : ''}\n`;
      }
    }
    if (!hadLessons) {
      res += "   <i>لا توجد حصص مسجلة لهذا اليوم</i>\n";
    }
    res += "\n";
  });

  await sendMsg(chatId, res);
}

// دالة إرسال رسالة عادية
async function sendMsg(chatId, text, keyboard = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML"
  };
  if (keyboard) payload.reply_markup = keyboard;
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) { }
}

// دالة إرسال رسالة مع أزرار مضمنة (Inline Keyboard)
async function sendInlineMsg(chatId, text, inlineMarkup) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    reply_markup: inlineMarkup
  };
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) { }
}
