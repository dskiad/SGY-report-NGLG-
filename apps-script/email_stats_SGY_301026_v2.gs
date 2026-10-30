/**
 * ΣΓΥ – Στατιστικά Email Μεγάλης Γραμματείας
 * Ing. Dimitrios Skiadopoulos — v2 — 30/10/2026
 *
 * Τι κάνει:
 *  - Μετράει ΜΕΜΟΝΩΜΕΝΑ ΜΗΝΥΜΑΤΑ (όχι συνομιλίες) σε διάστημα Από–Έως,
 *    για τις διευθύνσεις του CONFIG.ADDRESSES (σύνολο και ανά διεύθυνση).
 *  - Εισερχόμενα / εξερχόμενα, διαφορετικοί αποστολείς που μας έστειλαν,
 *    διαφορετικοί παραλήπτες στους οποίους στείλαμε, και εισερχόμενες
 *    προσκλήσεις (θέμα με «πρόσκληση», «πρόσκλησης», «προσκλήσεις» κ.λπ.,
 *    με ή χωρίς τόνους, κεφαλαία ή πεζά· μόνο αρχικά μηνύματα, όχι Re:/Fwd:/ΑΠ:/ΠΡΘ:).
 *  - Web App (JSON) για τη σελίδα του ΣΓΥ:
 *      GET <url>?from=2026-09-14&to=2026-10-30   → στατιστικά διαστήματος
 *      GET <url>                                 → από START_DATE έως σήμερα
 *  - Γράφει επίσης Google Sheet (Σύνοψη / Ανά ημέρα / Ιστορικό) με την ωριαία ενημέρωση.
 *
 * Εγκατάσταση στον λογαριασμό Google του grandsecretary@nglgreece.gr:
 *   Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone
 * Η διεύθυνση …/exec μπαίνει στη σελίδα (EMAIL_API στο index.html).
 * Το Web App επιστρέφει μόνο αριθμούς — ποτέ διευθύνσεις, θέματα ή περιεχόμενο.
 */

const CONFIG = {
  ADDRESSES: ['grandsecretary@nglgreece.gr', 'info@nglgreece.gr'],
  START_DATE: '2026-09-14',     // προεπιλογή «Από» όταν δεν δίνεται ημερομηνία
  SPREADSHEET_ID: '',           // κενό = δημιουργείται αυτόματα με την πρώτη εκτέλεση
  TIMEZONE: 'Europe/Athens',
  BATCH: 100,                   // συνομιλίες ανά αναζήτηση
  MAX_RUNTIME_MS: 5 * 60 * 1000, // όριο ασφαλείας (το Apps Script κόβει στα 6 λεπτά)
  CACHE_SECONDS: 15 * 60,       // ίδιο διάστημα μέσα σε 15' → απάντηση από την προσωρινή μνήμη
  INVITATION: /προσκλ|invitation|invite/, // στο θέμα, μετά την αφαίρεση τόνων
  REPLY: /^\s*(re|fw|fwd|aw|wg|tr|απ|πρθ|σχετ)\s*(\[\d+\])?\s*:/ // απαντήσεις/προωθήσεις δεν μετρούν
};

/* ───────────────────────── Κύρια μέτρηση ───────────────────────── */

/** Στατιστικά για το διάστημα fromStr–toStr (yyyy-MM-dd, συμπεριλαμβάνονται και οι δύο). */
function computeStats(fromStr, toStr) {
  const t0 = Date.now();
  const start = dayStart_(fromStr);
  const end = dayStart_(nextDay_(toStr)); // αποκλειστικό όριο: μεσάνυχτα μετά το «Έως»
  const own = CONFIG.ADDRESSES.map(a => a.toLowerCase());
  const isOwn = a => own.includes(a);

  const byAddress = {};
  own.forEach(a => (byAddress[a] = { incoming: 0, outgoing: 0 }));
  const daily = {}; // "yyyy-MM-dd" -> {incoming, outgoing}
  const senders = new Set(), recipients = new Set();
  let incoming = 0, outgoing = 0, invitations = 0;
  const seen = new Set();

  const addrQuery = own
    .map(a => `from:${a} OR to:${a} OR cc:${a} OR bcc:${a} OR deliveredto:${a}`)
    .join(' OR ');
  const query = `after:${Math.floor(start.getTime() / 1000)} before:${Math.floor(end.getTime() / 1000)} (${addrQuery})`;

  let offset = 0;
  let complete = true;

  while (true) {
    if (Date.now() - t0 > CONFIG.MAX_RUNTIME_MS) { complete = false; break; }

    const threads = GmailApp.search(query, offset, CONFIG.BATCH);
    if (!threads.length) break;

    GmailApp.getMessagesForThreads(threads).forEach(msgs => msgs.forEach(m => {
      const id = m.getId();
      if (seen.has(id)) return;
      seen.add(id);

      if (m.isDraft() || m.isInTrash()) return;
      const date = m.getDate();
      if (date < start || date >= end) return;

      const from = emails_(m.getFrom());
      const rcpt = emails_([
        m.getTo(), m.getCc(), m.getBcc(),
        m.getHeader('Delivered-To'), m.getHeader('X-Original-To')
      ].join(','));
      const day = Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
      daily[day] = daily[day] || { incoming: 0, outgoing: 0 };

      // ανά διεύθυνση (όπως στο v1)
      own.forEach(a => {
        if (from.includes(a)) byAddress[a].outgoing++;
        else if (rcpt.includes(a)) byAddress[a].incoming++;
      });

      // σύνολο Γραμματείας: κάθε μήνυμα μετράει μία φορά
      if (from.some(isOwn)) {
        outgoing++;
        daily[day].outgoing++;
        emails_([m.getTo(), m.getCc(), m.getBcc()].join(','))
          .filter(a => !isOwn(a)).forEach(a => recipients.add(a));
      } else if (rcpt.some(isOwn)) {
        incoming++;
        daily[day].incoming++;
        from.filter(a => !isOwn(a)).forEach(a => senders.add(a));
        const subj = plain_(m.getSubject());
        if (CONFIG.INVITATION.test(subj) && !CONFIG.REPLY.test(subj)) invitations++;
      }
    }));

    offset += threads.length;
    if (threads.length < CONFIG.BATCH) break;
  }

  return {
    from: fromStr,
    to: toStr,
    updated: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    complete: complete,          // false = έληξε ο χρόνος, η μέτρηση είναι μερική
    messagesScanned: seen.size,
    incoming: incoming,
    outgoing: outgoing,
    uniqueSenders: senders.size,
    uniqueRecipients: recipients.size,
    invitations: invitations,
    byAddress: byAddress,
    daily: Object.keys(daily).sort().map(d => ({ date: d, incoming: daily[d].incoming, outgoing: daily[d].outgoing }))
  };
}

/** Ωριαία ενημέρωση: από START_DATE έως σήμερα, στο Sheet και στην αποθηκευμένη τελευταία τιμή. */
function updateEmailStats() {
  const result = computeStats(CONFIG.START_DATE, today_());
  writeSheet_(result);
  PropertiesService.getScriptProperties().setProperty('LAST_RESULT', JSON.stringify(result));
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/* ───────────────────────── Web App (JSON) ───────────────────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  let data;
  try {
    if (p.from || p.to) {
      const from = p.from || CONFIG.START_DATE, to = p.to || today_();
      if (!isDate_(from) || !isDate_(to)) throw new Error('Μη έγκυρη ημερομηνία (μορφή yyyy-MM-dd).');
      if (from > to) throw new Error('Η ημερομηνία «Από» είναι μετά την «Έως».');
      const key = 'R|' + from + '|' + to;
      const cache = CacheService.getScriptCache();
      const hit = p.refresh === '1' ? null : cache.get(key);
      if (hit) data = JSON.parse(hit);
      else {
        data = computeStats(from, to);
        if (data.complete) cache.put(key, JSON.stringify(data), CONFIG.CACHE_SECONDS);
      }
    } else if (p.refresh === '1') {
      data = updateEmailStats();
    } else {
      const raw = PropertiesService.getScriptProperties().getProperty('LAST_RESULT');
      data = raw ? JSON.parse(raw) : updateEmailStats();
    }
  } catch (err) {
    data = { error: String(err && err.message || err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────── Αυτόματη ενημέρωση ───────────────────────── */

function installHourlyTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('updateEmailStats').timeBased().everyHours(1).create();
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'updateEmailStats')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/* ───────────────────────── Google Sheet ───────────────────────── */

function writeSheet_(r) {
  const ss = getSpreadsheet_();

  const sum = sheet_(ss, 'Σύνοψη');
  sum.clear();
  const rows = [
    ['Μέγεθος', 'Τιμή'],
    ['Από', r.from], ['Έως', r.to],
    ['Εισερχόμενα', r.incoming], ['Εξερχόμενα', r.outgoing],
    ['Διαφορετικοί αποστολείς', r.uniqueSenders], ['Διαφορετικοί παραλήπτες', r.uniqueRecipients],
    ['Προσκλήσεις (εισερχόμενες)', r.invitations],
    ['Ενημέρωση', r.updated], ['Πλήρης μέτρηση', r.complete ? 'Ναι' : 'Όχι'], ['', '']
  ];
  rows.push(['Διεύθυνση', 'Εισερχόμενα / Εξερχόμενα']);
  Object.keys(r.byAddress).forEach(a => rows.push([a, r.byAddress[a].incoming + ' / ' + r.byAddress[a].outgoing]));
  sum.getRange(1, 1, rows.length, 2).setValues(rows);
  sum.getRange(1, 1, 1, 2).setFontWeight('bold');
  sum.autoResizeColumns(1, 2);

  const day = sheet_(ss, 'Ανά ημέρα');
  day.clear();
  const drows = [['Ημερομηνία', 'Εισερχόμενα', 'Εξερχόμενα']]
    .concat(r.daily.map(d => [d.date, d.incoming, d.outgoing]));
  day.getRange(1, 1, drows.length, 3).setValues(drows);
  day.getRange(1, 1, 1, 3).setFontWeight('bold');

  const hist = sheet_(ss, 'Ιστορικό');
  if (hist.getLastRow() === 0) {
    hist.appendRow(['Ενημέρωση', 'Εισερχόμενα', 'Εξερχόμενα', 'Αποστολείς', 'Παραλήπτες', 'Προσκλήσεις']);
    hist.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  hist.appendRow([r.updated, r.incoming, r.outgoing, r.uniqueSenders, r.uniqueRecipients, r.invitations]);
}

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (err) { /* διαγράφηκε → νέο */ }
  }
  const ss = SpreadsheetApp.create('ΣΓΥ – Στατιστικά Email');
  props.setProperty('SHEET_ID', ss.getId());
  Logger.log('Δημιουργήθηκε Sheet: ' + ss.getUrl());
  return ss;
}

function sheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/* ───────────────────────── Βοηθητικά ───────────────────────── */

function dayStart_(s) {
  const [y, m, d] = s.split('-').map(Number);
  // μεσάνυχτα ώρας Ελλάδος (σωστή μετατόπιση θερινής/χειμερινής ώρας)
  const offset = Utilities.formatDate(new Date(Date.UTC(y, m - 1, d, 12)), CONFIG.TIMEZONE, 'XXX');
  return new Date(`${s}T00:00:00${offset}`);
}

function nextDay_(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(y, m - 1, d + 1, 12)), 'UTC', 'yyyy-MM-dd');
}

function today_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function isDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s));
}

/** Πεζά χωρίς τόνους/διαλυτικά, ώστε «ΠΡΌΣΚΛΗΣΗ», «Πρόσκλησης», «προσκληση» να ταιριάζουν όλα. */
function plain_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function emails_(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) || []);
}
