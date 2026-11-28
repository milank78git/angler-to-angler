import { JWT, OAuth2Client } from 'npm:google-auth-library@9.15.1';
import { fulfill, deliverPush, IneligiblePurchase } from './verify.mjs';

/** Require the configured service value before issuing a provider or database request. */
function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw Error('Missing configuration');
  return value;
}

const root = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/app.anglers.journal/purchases';
const pushIdentity = new OAuth2Client();
let publisher: JWT;

/** Authorize the Android Publisher request with the configured service account. */
async function google(url: string, method: 'POST' | 'GET') {
  if (!publisher) {
    const {client_email, private_key} = JSON.parse(env('PLAY_SERVICE_ACCOUNT_JSON'));
    publisher = new JWT({email: client_email, key: private_key,
      scopes: ['https://www.googleapis.com/auth/androidpublisher']});
  }
  return (await publisher.request({url, method})).data;
}

/** Commit the receipt operation through the database RPC and propagate a terminal void explicitly. */
async function ledger(op: string, args: object) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const saved = await fetch(env('SUPABASE_URL') + '/rest/v1/rpc/angler_play_receipt', {
    method: 'POST', headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
    body: JSON.stringify({op, args})
  });
  if (!saved.ok) {
    if (op === 'credit' && saved.status === 410) throw new IneligiblePurchase('Voided receipt');
    throw Error('Ledger unavailable');
  }
  return await saved.json();
}

/** Assemble the provider and ledger operations used for one receipt delivery. */
function delivery() {
  return {
    mode: env('PLAY_PURCHASE_MODE'),
    lookup: (token: string) => google(root + '/productsv2/tokens/' + encodeURIComponent(token), 'GET'),
    credit: (args: object) => ledger('credit', args),
    consume: (sku: string, token: string) =>
      google(root + '/products/' + sku + '/tokens/' + encodeURIComponent(token) + ':consume', 'POST')
  };
}

/** Only Google's authenticated push service account may submit notifications for this subscription. */
async function notification(req: Request, jwt: string) {
  try {
    const ticket = await pushIdentity.verifyIdToken({idToken: jwt, audience: env('PLAY_PUSH_AUDIENCE')});
    const sender = ticket.getPayload();
    if (sender?.email !== env('PLAY_PUSH_EMAIL') || !sender?.email_verified) return new Response(null, {status: 403});
  } catch { return new Response(null, {status: 401}); }
  const status = await deliverPush(req, env('PLAY_PUSH_SUBSCRIPTION'), {
    ...delivery(),
    resolveHolder: async (binding: string) => (await ledger('holder', {binding})).holder,
    voidReceipt: (hash: string) => ledger('void', {hash})
  });
  return new Response(null, {status});
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response(null, {status: 405});
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return new Response(null, {status: 401});
  // Return a retryable error to Pub/Sub when Google or the database is temporarily unavailable.
  if (new URL(req.url).pathname.endsWith('/notifications')) {
    try { return await notification(req, auth.slice(7)); }
    catch { return new Response(null, {status: 503}); }
  }
  try {
    const user = await fetch(env('SUPABASE_URL') + '/auth/v1/user', {
      headers: {apikey: env('SUPABASE_ANON_KEY'), Authorization: auth}
    });
    if (!user.ok) return new Response(null, {status: 401});
    const profile = await user.json();
    if (!profile.id || !profile.email_confirmed_at || profile.is_anonymous) return new Response(null, {status: 403});
    const {token} = await req.json();
    await fulfill({...delivery(), token, holder: profile.id});
    return Response.json({verified: true});
  } catch {
    // Provider errors may contain purchase tokens. Never include them in responses or logs.
    return Response.json({verified: false}, {status: 409});
  }
});
