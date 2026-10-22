const nameKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const failure=code=>Object.assign(new Error(code),{code});

// This runs only on the Windows worker. Company names select within the
// channel's existing permissions; they never grant access to another workspace.
export async function resolveSavedCompany(query,{channelId,companyName}){
 const wanted=nameKey(companyName);
 if(wanted.length<3||wanted.length>160)throw failure('SAVED_COMPANY_NAME_REQUIRED');
 const result=await query(`SELECT c.id AS company_id,c.workspace_id,c.name,a.id AS credential_id,a.operator,a.credential_ref,
  a.metadata->>'portalLoginCode' AS portal_login_code
  FROM public.koa_whatsapp_channels k
  JOIN public.business_boards b ON b.id=k.board_id AND b.workspace_id=k.workspace_id AND NOT b.archived
  JOIN public.companies c ON c.workspace_id=k.workspace_id
  JOIN public.automation_credentials a ON a.company_id=c.id AND a.workspace_id=c.workspace_id
  WHERE k.id=$1 AND k.conversations_enabled AND a.status='active' AND a.last_verified_at IS NOT NULL
   AND a.operator IN ('hapvida','ndi') AND app_private.task_admin_actor(k.workspace_id,k.actor_id)
   AND public.business_worker_scope(c.workspace_id,c.id,k.actor_id)`,[channelId]);
 const matches=result.rows.filter(row=>nameKey(row.name)===wanted);
 if(!matches.length)throw failure('SAVED_COMPANY_NOT_AVAILABLE');
 if(new Set(matches.map(row=>row.company_id)).size!==1)throw failure('SAVED_COMPANY_AMBIGUOUS');
 if(matches.length!==1)throw failure('SAVED_COMPANY_ACCESS_AMBIGUOUS');
 const row=matches[0],code=String(row.portal_login_code??'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
 if(!code||row.credential_ref!==`${row.operator}:${row.company_id}:login:${code}`)throw failure('SAVED_COMPANY_ACCESS_INVALID');
 return {companyId:row.company_id,workspaceId:row.workspace_id,companyName:row.name,credentialId:row.credential_id,
  operator:row.operator,credentialRef:row.credential_ref,companyCode:code};
}

export async function loadSavedCompanyAccess(query,secretProvider,input){
 // Re-resolve immediately before opening the vault so a revoked binding cannot
 // reuse a previously selected reference, and callers cannot inject a reference.
 const company=await resolveSavedCompany(query,input),credential=await secretProvider.get(company.credentialRef);
 const username=String(credential.username??'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
 if(username!==company.companyCode||typeof credential.password!=='string'||!credential.password)throw failure('SAVED_COMPANY_ACCESS_INVALID');
 return {company,credential};
}
