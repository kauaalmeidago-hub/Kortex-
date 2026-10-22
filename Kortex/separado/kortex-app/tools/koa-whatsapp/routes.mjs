// Explicitly authorized group routes inherit the existing channel's workspace,
// task destinations and revocation switches. No second task board is created.
export function parseGroupRoutes(value='[]'){
 const routes=JSON.parse(value);
 if(!Array.isArray(routes)||routes.length>20)throw Error('GROUP_ROUTES_INVALID');
 for(const r of routes)if(!r||typeof r.channel_id!=='string'||!r.channel_id
  ||typeof r.group_jid!=='string'||!/^\d+(?:-\d+)?@g\.us$/.test(r.group_jid)
  ||typeof r.group_name!=='string'||!r.group_name.trim()||r.group_name.length>180
  ||typeof r.activated_at!=='string'||!Number.isFinite(Date.parse(r.activated_at))
  ||Object.keys(r).some(k=>!['channel_id','group_jid','group_name','activated_at'].includes(k)))throw Error('GROUP_ROUTES_INVALID');
 return routes;
}
export function expandGroupRoutes(channels,routes){
 const result=[...channels];
 for(const route of routes){
  const parent=channels.find(c=>c.id===route.channel_id);
  if(!parent)continue; // A revoked parent cannot be restored by local settings.
  if(result.some(c=>c.instance===parent.instance&&c.group_jid===route.group_jid))throw Error('CHANNEL_ROUTE_CONFLICT');
  result.push({...parent,group_jid:route.group_jid,group_name:route.group_name,
   activated_at:new Date(Math.max(Date.parse(parent.activated_at),Date.parse(route.activated_at))).toISOString(),
   tasks_activated_at:parent.tasks_activated_at?new Date(Math.max(Date.parse(parent.tasks_activated_at),Date.parse(route.activated_at))).toISOString():null});
 }
 return result;
}
