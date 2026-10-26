const numeric=(value:unknown):number|null=>{
  if(typeof value!=="number"&&typeof value!=="string"||typeof value==="string"&&!value.trim())return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
};

/** Presentation only: quota availability is not an authentication or request gate. */
export function quotaView(key:string,value:unknown,usageBasedBilling=false){
  const q=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const creditCategory=usageBasedBilling&&key!=="completions";
  const total=numeric(q.entitlement),finite=total!==null&&total>0;
  // quota_remaining can be fractional. credits_used is an org aggregate and must
  // never be subtracted from an individual entitlement (VS Code #319589).
  const reportedRemaining=numeric(q.quota_remaining)??(creditCategory?null:numeric(q.remaining));
  const reportedPercent=numeric(q.percent_remaining);
  const percent=finite&&reportedRemaining!==null?Math.min(100,reportedRemaining/total*100):reportedPercent!==null?Math.min(100,reportedPercent):null;
  const remaining=reportedRemaining??(finite&&percent!==null?total*percent/100:null);
  const estimated=reportedRemaining===null&&remaining!==null;
  const creditsUsed=numeric(q.credits_used);
  const pooled=creditCategory&&!finite&&(q.unlimited===true||q.entitlement===-1||q.entitlement==="-1");
  const unlimited=!finite&&!pooled&&(q.unlimited===true||q.entitlement===-1||q.entitlement==="-1");
  const unavailable=!finite&&!pooled&&!unlimited&&q.has_quota===false&&!(creditCategory&&percent!==null);
  return {total:finite?total:null,remaining,percent:pooled||unlimited||unavailable?null:percent,estimated,creditsUsed,pooled,unlimited,unavailable,blocked:pooled&&q.has_quota===false,unit:creditCategory?"credits":"requests"};
}
