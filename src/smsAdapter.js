// Minimal SMS adapter with mock + Twilio skeleton
const provider = process.env.SMS_PROVIDER || 'mock';

async function sendSMS(to, body, meta = {}) {
  if (provider === 'twilio') {
    return sendTwilio(to, body, meta);
  }
  // mock
  console.log('[SMS][mock] to=', to, 'body=', body);
  return { ok: true, provider: 'mock' };
}

async function sendTwilio(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!accountSid || !authToken || !from) throw new Error('Twilio not configured');
  const client = require('twilio')(accountSid, authToken);
  const msg = await client.messages.create({ body, from, to });
  return { ok: true, provider: 'twilio', sid: msg.sid };
}

module.exports = { sendSMS };
