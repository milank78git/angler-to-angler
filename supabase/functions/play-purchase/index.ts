import { JWT } from 'npm:google-auth-library@9.15.1';
import { fulfill } from './verify.mjs';

const env=(name:string)=>{const value=Deno.env.get(name);if (!value) throw Error('Missing configuration');return value;};
const root='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/app.anglers.journal/purchases';
let client:JWT;
async function google(url:string, method:'POST'|'GET') {
  if (!client) {
    const {client_email,private_key}=JSON.parse(env('PLAY_SERVICE_ACCOUNT_JSON'));
    client=new JWT({email:client_email,key:private_key,scopes:['https://www.googleapis.com/auth/androidpublisher']});
  }
  const result=await client.request({url,method});
  return result.data;
}

Deno.serve(async req=>{
  if (req.method!=='POST') return new Response(null,{status:405});
  const auth=req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return new Response(null,{status:401});
  try {
    const url=env('SUPABASE_URL');
    const user=await fetch(url+'/auth/v1/user',{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:auth}});
    if (!user.ok) return new Response(null,{status:401});
    const profile=await user.json();
    if (!profile.id || !profile.email_confirmed_at || profile.is_anonymous) return new Response(null,{status:403});
    const {token}=await req.json();
    await fulfill({token,holder:profile.id,mode:env('PLAY_PURCHASE_MODE'),
      lookup:(t:string)=>google(root+'/productsv2/tokens/'+encodeURIComponent(t),'GET'),
      credit:async(args:object)=>{
        const secret=env('SUPABASE_SERVICE_ROLE_KEY');
        const saved=await fetch(url+'/rest/v1/rpc/angler_play_receipt',{method:'POST',
          headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},
          body:JSON.stringify({op:'credit',args})});
        if (!saved.ok) throw Error('Receipt unavailable');
      },
      consume:(sku:string,t:string)=>google(root+'/products/'+sku+'/tokens/'+encodeURIComponent(t)+':consume','POST')});
    return Response.json({verified:true});
  } catch {
    // Do not log provider responses, tokens, or bank details.
    return Response.json({verified:false},{status:409});
  }
});
