// Vercel serverless function — POST /api/waitlist
// Variables d'environnement : RESEND_API_KEY, RESEND_SEGMENT_ID
// Aucune dépendance npm (fetch natif, Node 18+).

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(JSON.stringify(body));
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  // Honeypot : champ « website » rempli = bot → succès factice, rien n'est enregistré.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return send(res, 200, { ok: true });
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return send(res, 400, { error: 'invalid_email' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const segmentId = process.env.RESEND_SEGMENT_ID || process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !segmentId) {
    console.error('Config manquante : RESEND_API_KEY et/ou RESEND_SEGMENT_ID');
    return send(res, 500, { error: 'server_error' });
  }

  try {
    const r = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, unsubscribed: false, segments: [{ id: segmentId }] }),
    });
    if (r.ok) return send(res, 200, { ok: true });

    const d = await r.json().catch(() => ({}));
    const msg = String(d.message || '');
    // Contact déjà existant : pas d'erreur visible pour l'utilisateur.
    if (r.status === 409 || /already (exists|been added)/i.test(msg)) {
      return send(res, 200, { ok: true });
    }
    // On ne logue jamais l'email complet.
    console.error('Resend error', r.status, msg.split(email).join('[email]'));
    return send(res, 500, { error: 'server_error' });
  } catch (e) {
    console.error('Resend fetch failed', e && e.message);
    return send(res, 500, { error: 'server_error' });
  }
};
